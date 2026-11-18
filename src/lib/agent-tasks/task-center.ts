// Fork（#30）：Agent 任務中心。重用 AgentRuntime，每個任務各自一份狀態與草稿；
// 不經過 chat-send.tsx／useChatStore（docs/adr/0001）。
import type OpenAI from 'openai'
import { isJobTaskId } from '@/lib/jobs/task-id'
import type { AgentRuntimeCallbacks, AgentRuntimeInput, AgentRuntimeResult, AgentTool } from '@/lib/agent/types'
import { buildBackgroundTools, type DraftSink } from './draft-tools'
import {
  DRAFT_TOOL_KINDS,
  buildResumeNote,
  markInterrupted,
  mergeDraft,
  pickRunnable,
  statusAfterReview,
  statusAfterRun,
} from './draft'
import { isAgentRunnerKind, type AgentTask, type AgentTaskKind, type DraftChange } from './types'

export interface RuntimeLike {
  run: (input: AgentRuntimeInput, callbacks?: AgentRuntimeCallbacks) => Promise<AgentRuntimeResult>
  stop: () => void
}

export type TaskEvent = 'awaiting_review' | 'completed' | 'failed'

/**
 * Fork（#35、ALMNC-12）：註冊的執行流程由任務中心排隊、取消及續跑。
 * Runner 可提交草稿，工作結束後由任務中心送審。
 */
export interface TaskRunnerContext {
  signal: AbortSignal
  setTokens: (tokens: number) => void
  draftSink: DraftSink
}

export type TaskRunner = (task: AgentTask, context: TaskRunnerContext) => Promise<{ result: string }>

export interface TaskCenterDeps {
  createRuntime: () => RuntimeLike
  persist: (task: AgentTask) => Promise<void>
  load: () => Promise<AgentTask[]>
  remove: (id: string) => Promise<void>
  concurrency: () => Promise<number>
  notify: (event: TaskEvent, task: AgentTask) => void
  now: () => number
  buildTools?: (tools: AgentTool[], sink: DraftSink) => AgentTool[]
}

export const DEFAULT_CONCURRENCY = 2

/** 只能用固定流程執行的任務類型。 */
function needsRunner(kind: AgentTaskKind): boolean {
  return kind === 'report' || isAgentRunnerKind(kind)
}

const BACKGROUND_SYSTEM_NOTE = [
  '你正在背景執行一個 Agent 任務，使用者不在對話視窗前，無法即時回答問題。',
  '所有新增、修改、搬移、刪除檔案的操作都只會存成草稿，任務結束後由使用者審核才寫入 vault。',
  '請直接把任務做完；資訊不足時做合理假設，並在最後的回覆裡說明你做了哪些假設與草稿。',
].join('\n')

function createTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function titleFromPrompt(prompt: string) {
  const line = prompt.trim().split('\n')[0] || ''
  return line.length > 40 ? `${line.slice(0, 40)}…` : line
}

export class AgentTaskCenter {
  private tasks = new Map<string, AgentTask>()
  private runtimes = new Map<string, RuntimeLike>()
  private cancelled = new Set<string>()
  private listeners = new Set<(tasks: AgentTask[]) => void>()
  private pumping: Promise<void> | null = null
  private runners = new Map<AgentTaskKind, TaskRunner>()
  private aborts = new Map<string, AbortController>()

  constructor(private readonly deps: TaskCenterDeps) {}

  subscribe(listener: (tasks: AgentTask[]) => void) {
    this.listeners.add(listener)
    listener(this.list())
    return () => { this.listeners.delete(listener) }
  }

  list(): AgentTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string) {
    return this.tasks.get(id)
  }

  /** 讓某一類任務改用固定流程執行；回傳解除註冊的函式。 */
  registerRunner(kind: AgentTaskKind, runner: TaskRunner) {
    this.runners.set(kind, runner)
    void this.pump()
    return () => { if (this.runners.get(kind) === runner) this.runners.delete(kind) }
  }

  /** 啟動時載入；上次還在跑或排隊的任務標成「沒做完」，草稿保留。 */
  async init() {
    const loaded = await this.deps.load()
    const now = this.deps.now()
    for (const task of loaded) {
      const next = markInterrupted(task, now)
      this.tasks.set(next.id, next)
      if (next !== task) await this.deps.persist(next)
    }
    this.emit()
  }

  async enqueue(input: { prompt: string; kind?: AgentTaskKind; title?: string; id?: string }): Promise<AgentTask> {
    const now = this.deps.now()
    const task: AgentTask = {
      id: input.id ?? createTaskId(),
      kind: input.kind ?? 'chat',
      title: input.title?.trim() || titleFromPrompt(input.prompt),
      prompt: input.prompt,
      status: 'queued',
      drafts: [],
      tokens: 0,
      createdAt: now,
      updatedAt: now,
    }
    await this.save(task, isJobTaskId(task.id))
    void this.pump()
    return task
  }

  /** Persist deterministic drafts directly for review without launching a model. */
  async submitDrafts(input: { kind: 'organize'; title: string; drafts: DraftChange[] }): Promise<void> {
    if (!input.drafts.length) return
    const now = this.deps.now()
    await this.save({
      ...input, id: createTaskId(), prompt: '', status: 'awaiting_review', tokens: 0, createdAt: now, updatedAt: now,
    }, true)
  }

  /** 取消：排隊中的直接取消；執行中的請 runtime 停下，已做的草稿留給你審。 */
  async cancel(id: string) {
    if (isJobTaskId(id)) return
    const task = this.tasks.get(id)
    if (!task) return
    if (task.status === 'queued') {
      await this.save({ ...task, status: 'cancelled', updatedAt: this.deps.now(), finishedAt: this.deps.now() })
      return
    }
    if (task.status === 'running') {
      this.cancelled.add(id)
      this.runtimes.get(id)?.stop()
      this.aborts.get(id)?.abort()
    }
  }

  /** 「繼續」：沒做完或失敗的任務帶著既有草稿重新排隊。 */
  async resume(id: string) {
    if (isJobTaskId(id)) return
    const task = this.tasks.get(id)
    if (!task || (task.status !== 'interrupted' && task.status !== 'failed')) return
    await this.save({ ...task, status: 'queued', error: undefined, updatedAt: this.deps.now() })
    void this.pump()
  }

  async remove(id: string) {
    if (isJobTaskId(id)) return
    const task = this.tasks.get(id)
    if (!task || task.status === 'running') return
    this.tasks.delete(id)
    await this.deps.remove(id)
    this.emit()
  }

  /** 審核後寫回草稿狀態；全部處理完就算完成。 */
  async updateDrafts(id: string, drafts: DraftChange[]) {
    const task = this.tasks.get(id)
    if (!task) return
    const next = { ...task, drafts, updatedAt: this.deps.now() }
    const status = statusAfterReview(next)
    await this.save({ ...next, status, finishedAt: status === 'completed' ? this.deps.now() : task.finishedAt })
  }

  private async save(task: AgentTask, persistBeforePublish = false) {
    if (persistBeforePublish) await this.deps.persist(task)
    this.tasks.set(task.id, task)
    this.emit()
    if (!persistBeforePublish) await this.deps.persist(task)
  }

  private emit() {
    const tasks = this.list()
    for (const listener of this.listeners) listener(tasks)
  }

  private repump = false

  private pump(): Promise<void> {
    if (this.pumping) {
      this.repump = true
      return this.pumping
    }
    this.pumping = (async () => {
      const limit = Math.max(1, await this.deps.concurrency())
      // 固定流程的任務要等它的執行器註冊好才開始（例如畫面還沒掛上）
      const waiting = [...this.tasks.values()].filter(task => needsRunner(task.kind) && !this.runners.has(task.kind) && task.status === 'queued')
      const candidates = [...this.tasks.values()].filter(task => !waiting.includes(task))
      for (const task of pickRunnable(candidates, limit)) {
        this.tasks.set(task.id, { ...task, status: 'running' })
        if (isJobTaskId(task.id)) void this.runJobAttempt(task.id)
        else void this.run(task.id)
      }
    })().finally(() => {
      this.pumping = null
      if (this.repump) {
        this.repump = false
        void this.pump()
      }
    })
    return this.pumping
  }

  private async runJobAttempt(id: string) {
    try {
      await this.run(id)
    } catch (error) {
      // A storage error must release the reservation without unlocking dependent steps.
      this.aborts.delete(id)
      const task = this.tasks.get(id)
      if (!task) return
      const status = statusAfterRun(task.drafts) === 'awaiting_review' ? 'awaiting_review' : 'failed'
      const detail = error instanceof Error ? error.message : String(error)
      const failed = { ...task, status, error: detail, updatedAt: this.deps.now() } as const
      await this.save(failed).catch(caught => console.error('[jobs] could not save failed attempt:', caught))
      this.deps.notify(status, failed)
      void this.pump()
    }
  }

  private async runFixed(id: string, runner: TaskRunner) {
    const initial = this.tasks.get(id)
    if (!initial) return
    const controller = new AbortController()
    this.aborts.set(id, controller)
    await this.save({ ...initial, status: 'running', error: undefined, updatedAt: this.deps.now() })
    let result: string | undefined
    let error: string | undefined
    try {
      result = (await runner(initial, {
        signal: controller.signal,
        draftSink: {
          drafts: () => this.tasks.get(id)?.drafts ?? initial.drafts,
          add: async draft => {
            controller.signal.throwIfAborted()
            const current = this.tasks.get(id)
            if (current) await this.save({ ...current, drafts: mergeDraft(current.drafts, draft), updatedAt: this.deps.now() })
          },
        },
        setTokens: tokens => {
          const current = this.tasks.get(id)
          if (current && current.tokens !== tokens) {
            this.tasks.set(id, { ...current, tokens })
            this.emit()
          }
        },
      })).result
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    } finally {
      this.aborts.delete(id)
    }
    const current = this.tasks.get(id) ?? initial
    const now = this.deps.now()
    let next: AgentTask
    const cancelled = this.cancelled.delete(id)
    const runStatus = statusAfterRun(current.drafts)
    if (runStatus === 'awaiting_review') next = { ...current, status: runStatus, result, error, updatedAt: now, finishedAt: now }
    else if (cancelled) next = { ...current, status: 'cancelled', updatedAt: now, finishedAt: now }
    else if (error !== undefined) next = { ...current, status: 'failed', error, updatedAt: now }
    else next = { ...current, status: runStatus, result, updatedAt: now, finishedAt: now }
    // P6 can dispatch dependents immediately after observing a successful run.
    await this.save(next, isJobTaskId(id))
    if (next.status === 'awaiting_review' || next.status === 'completed' || next.status === 'failed') {
      this.deps.notify(next.status, next)
    }
    void this.pump()
  }

  private async run(id: string) {
    const initial = this.tasks.get(id)
    if (!initial) return
    const runner = this.runners.get(initial.kind)
    if (runner) return this.runFixed(id, runner)
    if (isAgentRunnerKind(initial.kind)) {
      await this.save({ ...initial, status: 'queued', updatedAt: this.deps.now() })
      void this.pump()
      return
    }
    let drafts = initial.drafts
    const sink: DraftSink = {
      drafts: () => drafts,
      add: draft => {
        drafts = mergeDraft(drafts, draft)
        const current = this.tasks.get(id)
        if (current) void this.save({ ...current, drafts, updatedAt: this.deps.now() })
      },
    }
    const tokenByEvent = new Map<string, number>()
    const runtime = this.deps.createRuntime()
    this.runtimes.set(id, runtime)
    await this.save({ ...initial, status: 'running', updatedAt: this.deps.now() })

    const resumeNote = buildResumeNote(drafts)
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: resumeNote ? `${BACKGROUND_SYSTEM_NOTE}\n\n${resumeNote}` : BACKGROUND_SYSTEM_NOTE },
    ]
    const buildTools = this.deps.buildTools ?? buildBackgroundTools

    let result: AgentRuntimeResult | null = null
    let error: string | undefined
    try {
      result = await runtime.run({
        userInput: initial.prompt,
        messages,
        permissionMode: 'auto-edit',
        selectedMcpServerIds: [],
        selectedSkills: [],
        transformTools: tools => buildTools(tools, sink),
      }, {
        // 草稿工具只記錄、不寫入，所以直接放行；其他會改東西的工具根本不在清單裡。
        requestConfirmation: async toolName => (DRAFT_TOOL_KINDS[toolName] ? 'approved' : 'denied'),
        onTrace: event => {
          if (typeof event.streamedTokenCount !== 'number') return
          tokenByEvent.set(event.id, event.streamedTokenCount)
          const current = this.tasks.get(id)
          const tokens = [...tokenByEvent.values()].reduce((sum, value) => sum + value, 0)
          if (current && current.tokens !== tokens) {
            this.tasks.set(id, { ...current, tokens })
            this.emit()
          }
        },
      })
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    } finally {
      this.runtimes.delete(id)
    }

    const current = this.tasks.get(id) ?? initial
    const now = this.deps.now()
    const wasCancelled = this.cancelled.delete(id)
    let next: AgentTask
    if (wasCancelled) {
      const status = statusAfterRun(drafts) === 'awaiting_review' ? 'awaiting_review' : 'cancelled'
      next = { ...current, drafts, status, result: result?.content, updatedAt: now, finishedAt: now }
    } else if (error && !result) {
      next = { ...current, drafts, status: 'failed', error, updatedAt: now }
    } else {
      next = { ...current, drafts, status: statusAfterRun(drafts), result: result?.content, updatedAt: now, finishedAt: now }
    }
    await this.save(next)
    if (next.status === 'awaiting_review' || next.status === 'completed' || next.status === 'failed') {
      this.deps.notify(next.status, next)
    }
    void this.pump()
  }
}
