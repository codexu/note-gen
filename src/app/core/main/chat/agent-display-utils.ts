import type { AgentRunStatus, AgentTraceEvent } from "@/lib/agent/types"
import {
  BookOpen, Brain, CheckCircle2, Copy, FileEdit, FilePlus, Files, FileText,
  FolderOpen, FolderPlus, Globe, Image, LayoutPanelTop, Link2, MessageSquare,
  Network, PackagePlus, Pencil, Puzzle, Search, Tag, Terminal, TextSelect,
  Trash2, Wrench, ArrowRightLeft, type LucideIcon,
} from "lucide-react"

const toolIcons: Record<string, LucideIcon> = {
  web_search: Search,
  web_read_page: Globe,
  editor_get_state: FileText,
  editor_get_selection: TextSelect,
  editor_insert_at_cursor: Pencil,
  editor_replace_range: FileEdit,
  editor_replace_lines: FileEdit,
  editor_apply_transaction: FileEdit,
  note_list_files: Files,
  note_list_files_by_date: Files,
  note_read_file: FileText,
  note_read_files_batch: BookOpen,
  note_open_file: FolderOpen,
  note_create_file: FilePlus,
  note_update_file: FileEdit,
  note_delete_file: Trash2,
  note_rename_file: Pencil,
  note_move_file: ArrowRightLeft,
  note_copy_file: Copy,
  folder_create: FolderPlus,
  folder_delete: Trash2,
  attachment_list: FolderOpen,
  attachment_read: FileText,
  knowledge_search: Search,
  knowledge_read_sources: BookOpen,
  knowledge_cite_sources: Link2,
  skill_search_remote: Search,
  skill_run_code: Terminal,
  skill_execute_script: Terminal,
  skill_install_package: PackagePlus,
  skill_install_source: PackagePlus,
  skill_install_python_dependencies: PackagePlus,
  skill_install_node_dependencies: PackagePlus,
  skill_validate_package: CheckCircle2,
  skill_uninstall: Trash2,
  skill_read_resource: BookOpen,
  ask_user_question: MessageSquare,
  show_ui: LayoutPanelTop,
  render_response: LayoutPanelTop,
}

const toolCategoryIcons: [string, LucideIcon][] = [
  ['folder_', FolderOpen], ['tag_', Tag], ['mark_', Pencil],
  ['memory_', Brain], ['skill_', Puzzle], ['mcp_', Network],
  ['canvas_', LayoutPanelTop], ['image_', Image], ['system_', Terminal],
  ['knowledge_', BookOpen], ['note_', FileText], ['editor_', FileEdit],
]

export function getAgentToolIcon(name = ''): LucideIcon {
  return toolIcons[name] ?? toolCategoryIcons.find(([prefix]) => name.startsWith(prefix))?.[1] ?? Wrench
}

export const agentStatusText: Record<AgentRunStatus, string> = {
  idle: "空闲",
  analyzing_images: "正在识别图片",
  preparing_context: "准备上下文",
  thinking: "思考中",
  calling_tool: "执行工具",
  waiting_approval: "等待确认",
  waiting_answer: "等待回答",
  applying_change: "应用修改",
  recovering: "恢复中",
  steering: "应用追加信息",
  completed: "已完成",
  stopped: "已停止",
  failed: "失败",
}

export function formatAgentToolName(name: string) {
  const attachmentToolNames: Record<string, string> = {
    web_search: "搜索互联网",
    web_read_page: "读取网页",
    attachment_list: "附件 · 查看文件夹",
    attachment_read: "附件 · 读取文件",
  }

  if (attachmentToolNames[name]) {
    return attachmentToolNames[name]
  }

  return name
    .replace(/^editor_/, "编辑器 · ")
    .replace(/^note_/, "笔记 · ")
    .replace(/^folder_/, "文件夹 · ")
    .replace(/^tag_/, "标签 · ")
    .replace(/^mark_/, "记录 · ")
    .replace(/^memory_/, "记忆 · ")
    .replace(/^skill_/, "Skill · ")
    .replace(/^mcp_/, "MCP · ")
    .replace(/^system_/, "系统 · ")
    .replace(/_/g, " ")
}

function truncateActivityTarget(value: string, maxLength = 48) {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1)}…`
}

function getStringInput(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getToolActivityTarget(event: AgentTraceEvent) {
  const input = event.input
  const query = getStringInput(input, "query")
  if (query) {
    return `“${truncateActivityTarget(query)}”`
  }

  if (event.toolName === "mcp_call_tool") {
    const mcpToolName = getStringInput(input, "toolName")
    if (mcpToolName) {
      return truncateActivityTarget(mcpToolName)
    }
  }

  const skillId = getStringInput(input, "skill_id")
  if (skillId) {
    return truncateActivityTarget(skillId)
  }

  const url = getStringInput(input, "url")
  if (url) {
    try {
      return new URL(url).hostname
    } catch {
      return truncateActivityTarget(url)
    }
  }

  for (const key of ["filePath", "fileName", "relativePath", "folderPath", "path"]) {
    const value = getStringInput(input, key)
    if (value) {
      return truncateActivityTarget(formatAgentTarget(value))
    }
  }

  for (const key of ["filePaths", "relativePaths", "folderPaths", "ids"]) {
    const value = input?.[key]
    if (Array.isArray(value) && value.length > 0) {
      return `${value.length} 项`
    }
  }

  return undefined
}

export function formatAgentToolActivity(event: AgentTraceEvent) {
  const action = event.displayTitle || event.title || (event.toolName ? formatAgentToolName(event.toolName) : "执行操作")
  const target = event.displayTitle ? undefined : getToolActivityTarget(event)
  const description = target ? `${action} · ${target}` : action

  if (event.status === "running") {
    return `正在${description}`
  }

  if (event.status === "error") {
    return `${description}失败`
  }

  return description
}

export function formatAgentDuration(duration?: number) {
  if (duration === undefined) return ""
  if (duration < 1000) return `${duration}ms`
  return `${(duration / 1000).toFixed(1)}s`
}

export function formatAgentTarget(target: string) {
  const normalized = target.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() || target
}
