// Fork（#30）：Agent 任務中心的資料型別。術語見 GLOSSARY.md「Agent 任務」，架構見 docs/adr/0001。

export type AgentRunnerKind = `agent:${string}`
export type AgentTaskKind = 'chat' | 'report' | 'suggestion' | 'signal' | 'organize' | AgentRunnerKind

export function isAgentRunnerKind(kind: AgentTaskKind): kind is AgentRunnerKind {
  return kind.startsWith('agent:')
}

/**
 * queued／running 對應「進行中」；awaiting_review 對應「等你回應」；
 * interrupted／failed 對應「沒做完」；completed 對應「已完成」。
 */
export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'interrupted'
  | 'failed'
  | 'completed'
  | 'cancelled'

export type DraftKind = 'create' | 'update' | 'delete' | 'move' | 'copy' | 'folder'

export type DraftState = 'pending' | 'applied' | 'discarded' | 'failed'

export interface DraftChange {
  id: string
  /** 原本要執行的工具名稱與參數；收下時用同一個工具真正寫入。 */
  toolName: string
  args: Record<string, unknown>
  kind: DraftKind
  /** 受影響的 vault 相對路徑（搬移時是原路徑）。 */
  path: string
  /** 搬移、改名、複製的目的地。 */
  targetPath?: string
  /** 新增或修改後的完整內容，供任務後續讀取與審核預覽。 */
  content?: string
  /** 建立草稿當下的原內容；null 表示當時檔案不存在。用來判斷衝突。 */
  baseContent: string | null
  summary: string
  state: DraftState
  error?: string
}

export interface AgentTask {
  id: string
  kind: AgentTaskKind
  title: string
  prompt: string
  status: AgentTaskStatus
  drafts: DraftChange[]
  result?: string
  error?: string
  tokens: number
  createdAt: number
  updatedAt: number
  finishedAt?: number
}
