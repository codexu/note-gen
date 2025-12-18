"use client"

import { ChatLink } from "./chat-link"
import { FileLink } from "./file-link"
import { McpButton } from "./mcp-button"
import { RagSwitch } from "./rag-switch"
import { ClipboardMonitor } from "./clipboard-monitor"
import ChatPlaceholder from "./chat-placeholder"
import { ClearContext } from "./clear-context"
import { ClearChat } from "./clear-chat"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import { useState } from "react"
import { MarkdownFile } from "@/lib/files"
import { FileSelector } from "./file-selector"
import emitter from "@/lib/emitter"

// 工具栏分组定义
const TOOLBAR_GROUPS = {
  topLeft: ['chatLink', 'fileLink', 'mcpButton', 'ragSwitch', 'chatPlaceholder', 'clipboardMonitor'],
  topRight: ['clearContext', 'clearChat'],
}

export function ChatHeader() {
  const { primaryModel, chatToolbarConfigPc } = useSettingStore()
  const { loading } = useChatStore()
  const [showFileSelector, setShowFileSelector] = useState(false)

  // 打开文件选择器
  function openFileSelector() {
    setShowFileSelector(true)
  }

  // 处理文件选择
  function handleFileSelect(file: MarkdownFile) {
    // 通过 emitter 将文件选择事件传递给 ChatInput
    emitter.emit('fileSelected', file)
    setShowFileSelector(false)
  }

  // 渲染工具栏项
  const renderToolbarItem = (id: string) => {
    switch (id) {
      case 'chatLink':
        return <ChatLink key={id} />
      case 'fileLink':
        return <FileLink key={id} onFileLinkClick={openFileSelector} disabled={!primaryModel || loading} />
      case 'mcpButton':
        return <McpButton key={id} />
      case 'ragSwitch':
        return <RagSwitch key={id} />
      case 'chatPlaceholder':
        return <ChatPlaceholder key={id} />
      case 'clipboardMonitor':
        return <ClipboardMonitor key={id} />
      case 'clearContext':
        return <ClearContext key={id} />
      case 'clearChat':
        return <ClearChat key={id} />
      default:
        return null
    }
  }

  // 获取指定分组的工具栏项
  const getToolbarItems = (group: 'topLeft' | 'topRight') => {
    return chatToolbarConfigPc
      .filter(item => TOOLBAR_GROUPS[group].includes(item.id) && item.enabled)
      .sort((a, b) => a.order - b.order)
      .map(item => renderToolbarItem(item.id))
  }

  return (
    <>
      <header className="h-12 w-full flex items-center justify-between border-b px-2 gap-2">
        {/* 左侧：关联记录、关联文件、MCP、知识库检索 */}
        <div className="flex items-center gap-1">
          {getToolbarItems('topLeft')}
        </div>

        {/* 右侧：剪贴板监听、AI建议、清除上下文、清空对话 */}
        <div className="flex items-center gap-1">
          {getToolbarItems('topRight')}
        </div>
      </header>

      {/* 文件选择器 */}
      <FileSelector
        isOpen={showFileSelector}
        onFileSelect={handleFileSelect}
        onClose={() => setShowFileSelector(false)}
      />
    </>
  )
}
