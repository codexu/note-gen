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

export function ChatHeader() {
  const { primaryModel } = useSettingStore()
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

  return (
    <>
      <header className="h-12 w-full flex items-center justify-between border-b px-2 gap-2">
        {/* 左侧：关联记录、关联文件、MCP、知识库检索 */}
        <div className="flex items-center gap-1">
          <ChatLink inputType="chat" />
          <FileLink onFileLinkClick={openFileSelector} disabled={!primaryModel || loading} />
          <McpButton />
          <RagSwitch />
          <ChatPlaceholder />
          <ClipboardMonitor />
        </div>

        {/* 右侧：剪贴板监听、AI建议、清除上下文、清空对话 */}
        <div className="flex items-center gap-1">
          <ClearContext />
          <ClearChat />
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
