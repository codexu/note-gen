// Fork（#30）：把背景任務的工具換成「寫進草稿」的版本。
// 傳給 AgentRuntime 的 transformTools 使用；原本的工具留給審核時真正寫入。
import type { AgentTool, AgentToolResult } from '@/lib/agent/types'
import { readNote } from '@/lib/daily/note-io'
import {
  BACKGROUND_EXCLUDED_CATEGORIES,
  BACKGROUND_EXCLUDED_TOOLS,
  DRAFT_TOOL_KINDS,
  describeDraftTarget,
  readThroughDrafts,
  summarizeDraft,
} from './draft'
import type { DraftChange } from './types'

export interface DraftSink {
  drafts: () => DraftChange[]
  add: (draft: DraftChange) => void | Promise<void>
}

function createDraftId() {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function wrapAsDraft(tool: AgentTool, sink: DraftSink, readFile: (path: string) => Promise<string | null>): AgentTool {
  const kind = DRAFT_TOOL_KINDS[tool.name]
  return {
    ...tool,
    description: `${tool.description}\n（背景任務：這個操作只會存成草稿，任務結束後由使用者審核才寫入。）`,
    execute: async (input): Promise<AgentToolResult> => {
      const { path, targetPath, content } = describeDraftTarget(tool.name, input)
      if (!path) return { ok: false, message: '缺少檔案路徑', error: 'MISSING_PATH' }
      const onDisk = kind === 'folder' ? null : await readFile(path)
      const inDrafts = readThroughDrafts(sink.drafts(), path)
      const visible = inDrafts.found ? inDrafts.content : onDisk
      if (kind !== 'create' && kind !== 'folder' && visible === null) {
        return { ok: false, message: `找不到 ${path}`, error: 'NOT_FOUND' }
      }
      const summary = summarizeDraft(kind, path, targetPath, content, onDisk)
      await sink.add({
        id: createDraftId(),
        toolName: tool.name,
        args: input,
        kind,
        path,
        targetPath,
        // 搬移、複製記下來源內容，之後任務讀目的地時才看得到。
        content: kind === 'move' || kind === 'copy' ? visible ?? undefined : content,
        baseContent: onDisk,
        summary,
        state: 'pending',
      })
      return { ok: true, message: `已存成草稿：${summary}。任務結束後由使用者審核，審核前 vault 不會改變。` }
    },
  }
}

function wrapReadThroughDrafts(tool: AgentTool, sink: DraftSink): AgentTool {
  return {
    ...tool,
    execute: async (input, context) => {
      const path = typeof input.filePath === 'string' ? input.filePath.trim() : ''
      const hit = path ? readThroughDrafts(sink.drafts(), path) : { found: false, content: null }
      if (!hit.found) return tool.execute(input, context)
      if (hit.content === null) return { ok: false, message: `${path} 已在草稿中被刪除或搬走`, error: 'NOT_FOUND' }
      return { ok: true, message: `（草稿內容，尚未寫入 vault）\n${hit.content}`, data: { filePath: path, content: hit.content } }
    },
  }
}

/** 背景任務可用的工具：唯讀工具（排除依賴畫面的）＋包成草稿的檔案操作。 */
export function buildBackgroundTools(
  tools: AgentTool[],
  sink: DraftSink,
  readFile: (path: string) => Promise<string | null> = readNote
): AgentTool[] {
  const result: AgentTool[] = []
  for (const tool of tools) {
    if (BACKGROUND_EXCLUDED_TOOLS.has(tool.name) || BACKGROUND_EXCLUDED_CATEGORIES.has(tool.category)) continue
    if (DRAFT_TOOL_KINDS[tool.name]) result.push(wrapAsDraft(tool, sink, readFile))
    else if (tool.name === 'note_read_file') result.push(wrapReadThroughDrafts(tool, sink))
    else if (tool.risk === 'read') result.push(tool)
  }
  return result
}
