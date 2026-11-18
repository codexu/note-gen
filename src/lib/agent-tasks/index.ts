// Fork（#30）：任務中心的單一實例與 UI 用的 store。
import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { AgentRuntime } from '@/lib/agent/runtime'
import { agentToolRegistry } from '@/lib/agent/tool-registry'
import { readNote } from '@/lib/daily/note-io'
import { deleteAgentTask, listAgentTasks, saveAgentTask } from '@/db/agent-tasks'
import { AgentTaskCenter, DEFAULT_CONCURRENCY, type TaskEvent } from './task-center'
import { applyBulk, applyDraft, discardDraft, inspectDrafts, type DraftReviewView, type ReviewDeps } from './review'
import { isAgentRunnerKind, type AgentTask } from './types'
import { createAgentRunner } from '@/lib/agents/runner'

export const AGENT_TASK_CONCURRENCY_KEY = 'agentTaskConcurrency'

let notifier: (event: TaskEvent, task: AgentTask) => void = () => {}

/** 由掛在畫面上的元件註冊，才能用目前語系的文字發通知。 */
export function setAgentTaskNotifier(next: typeof notifier) {
  notifier = next
}

export const agentTaskCenter = new AgentTaskCenter({
  createRuntime: () => new AgentRuntime(),
  persist: saveAgentTask,
  load: async () => {
    const tasks = await listAgentTasks()
    const kinds = new Set(tasks.map(task => task.kind).filter(isAgentRunnerKind))
    for (const kind of kinds) agentTaskCenter.registerRunner(kind, createAgentRunner(kind))
    return tasks
  },
  remove: deleteAgentTask,
  concurrency: async () => {
    try {
      const store = await Store.load('store.json')
      const value = await store.get<number>(AGENT_TASK_CONCURRENCY_KEY)
      return typeof value === 'number' && value >= 1 ? Math.floor(value) : DEFAULT_CONCURRENCY
    } catch {
      return DEFAULT_CONCURRENCY
    }
  },
  notify: (event, task) => notifier(event, task),
  now: () => Date.now(),
})

const reviewDeps: ReviewDeps = {
  readFile: readNote,
  getTool: name => agentToolRegistry.getTool(name),
}

export async function inspectTaskDrafts(task: AgentTask): Promise<DraftReviewView[]> {
  return inspectDrafts(task.drafts, reviewDeps)
}

function replaceDraft(task: AgentTask, next: AgentTask['drafts'][number]) {
  return task.drafts.map(draft => (draft.id === next.id ? next : draft))
}

/**
 * 檔案正開在編輯器時，修改工具改的是編輯器內容，磁碟要等編輯器的延遲存檔。
 * 等到磁碟與草稿一致（最多 3 秒），之後的衝突比對才不會讀到舊內容。
 */
async function waitForDisk(draft: AgentTask['drafts'][number]) {
  if (draft.state !== 'applied' || (draft.kind !== 'create' && draft.kind !== 'update') || draft.content === undefined) return
  for (let waited = 0; waited < 3000; waited += 150) {
    if (await readNote(draft.path) === draft.content) return
    await new Promise(resolve => setTimeout(resolve, 150))
  }
}

export async function applyTaskDraft(taskId: string, draftId: string, confirmedConflict = false) {
  const task = agentTaskCenter.get(taskId)
  const draft = task?.drafts.find(item => item.id === draftId)
  if (!task || !draft) return
  const next = await applyDraft(draft, reviewDeps, confirmedConflict, task.drafts)
  await waitForDisk(next)
  await agentTaskCenter.updateDrafts(taskId, replaceDraft(agentTaskCenter.get(taskId) ?? task, next))
}

export async function applyTaskDraftsInBulk(taskId: string) {
  const task = agentTaskCenter.get(taskId)
  if (!task) return
  const results = await applyBulk(await inspectTaskDrafts(task), reviewDeps)
  for (const draft of results) await waitForDisk(draft)
  await agentTaskCenter.updateDrafts(taskId, results)
}

export async function discardTaskDrafts(taskId: string, draftIds?: string[]) {
  const task = agentTaskCenter.get(taskId)
  if (!task) return
  const drafts = task.drafts.map(draft => (!draftIds || draftIds.includes(draft.id) ? discardDraft(draft) : draft))
  await agentTaskCenter.updateDrafts(taskId, drafts)
}

interface AgentTaskUiState {
  tasks: AgentTask[]
  sheetOpen: boolean
  reviewTaskId: string | null
  openSheet: (reviewTaskId?: string | null) => void
  closeSheet: () => void
  setReviewTask: (id: string | null) => void
}

export const useAgentTaskStore = create<AgentTaskUiState>(set => ({
  tasks: [],
  sheetOpen: false,
  reviewTaskId: null,
  openSheet: (reviewTaskId = null) => set({ sheetOpen: true, reviewTaskId }),
  closeSheet: () => set({ sheetOpen: false, reviewTaskId: null }),
  setReviewTask: id => set({ reviewTaskId: id }),
}))

let startup: Promise<void> | undefined

/** 主視窗啟動時呼叫一次：載入任務、把中斷的標成「沒做完」，並讓 store 跟著更新。 */
export function startAgentTaskCenter(): Promise<void> {
  if (!startup) {
    const unsubscribe = agentTaskCenter.subscribe(tasks => useAgentTaskStore.setState({ tasks }))
    startup = agentTaskCenter.init().catch(error => {
      unsubscribe()
      startup = undefined
      throw error
    })
  }
  return startup
}
