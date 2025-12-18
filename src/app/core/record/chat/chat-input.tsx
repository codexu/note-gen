"use client"
import * as React from "react"
import { useEffect, useRef, useState } from "react"
import useSettingStore from "@/stores/setting"
import { Textarea } from "@/components/ui/textarea"
import useChatStore from "@/stores/chat"
import useMarkStore from "@/stores/mark"
import { fetchAiPlaceholder } from "@/lib/ai"
import { useTranslations } from 'next-intl'
import { useLocalStorage } from 'react-use';
import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"
import { ChatLanguage } from "./chat-language"
import { ChatSend } from "./chat-send"
import { LinkedFileDisplay, FileLink } from "./file-link"
import { FileSelector } from "./file-selector"
import { ChatLink } from "./chat-link"
import { McpButton } from "./mcp-button"
import { RagSwitch } from "./rag-switch"
import ChatPlaceholder from "./chat-placeholder"
import { ClipboardMonitor } from "./clipboard-monitor"
import { ClearContext } from "./clear-context"
import { ClearChat } from "./clear-chat"
import { ChatModeSelect } from "./chat-mode-select"
import { MarkdownFile } from "@/lib/files"
import emitter from "@/lib/emitter"
import { useIsMobile } from '@/hooks/use-mobile'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'


export function ChatInput() {
  const [text, setText] = useState("")
  const { primaryModel, chatToolbarConfigPc, setChatToolbarConfigPc, chatToolbarConfigMobile } = useSettingStore()
  const { chats, loading, locale, isLinkMark, isPlaceholderEnabled } = useChatStore()
  const [showFileSelector, setShowFileSelector] = useState(false)
  const { marks, trashState } = useMarkStore()
  const [isComposing, setIsComposing] = useState(false)
  const [placeholder, setPlaceholder] = useState('')
  const t = useTranslations()
  const [inputHistory, setInputHistory] = useLocalStorage<string[]>('chat-input-history', [])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [linkedFile, setLinkedFile] = useState<MarkdownFile | null>(null)
  const chatSendRef = useRef<any>(null)
  const isMobile = useIsMobile()

  // 拖拽传感器配置（仅桌面端）
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 移动8px后才开始拖拽，避免误触
      },
    })
  )


  // 添加输入到历史记录
  function addToHistory(input: string) {
    if (!input.trim()) return
    
    const newHistory = [input, ...(inputHistory || []).filter(item => item !== input)]
    // 限制历史记录数量为50条
    const limitedHistory = newHistory.slice(0, 50)
    setInputHistory(limitedHistory)
  }

  // 处理历史记录导航
  function navigateHistory(direction: 'up' | 'down') {
    if (!inputHistory || inputHistory.length === 0) return

    let newIndex: number
    if (direction === 'up') {
      newIndex = historyIndex + 1
      if (newIndex >= inputHistory.length) {
        newIndex = inputHistory.length - 1
      }
    } else {
      newIndex = historyIndex - 1
      if (newIndex < -1) {
        newIndex = -1
      }
    }

    setHistoryIndex(newIndex)
    
    if (newIndex === -1) {
      setText('')
    } else {
      setText(inputHistory[newIndex])
    }
  }

  // 移除关联文件
  function removeLinkedFile() {
    setLinkedFile(null)
  }

  // 处理发送后的清理工作
  function handleSent() {
    // 添加到历史记录
    addToHistory(text)
    setText('')
    setHistoryIndex(-1)
    // 重置 textarea 的高度为默认值
    const textarea = document.querySelector('textarea')
    if (textarea) {
      textarea.style.height = 'auto'
    }
  }

  // 获取输入框占位符
  async function genInputPlaceholder() {
    setPlaceholder(t('record.chat.input.placeholder.default'))
    if (!primaryModel) return
    if (trashState) return
    // 检查是否启用了AI占位符功能
    if (!isPlaceholderEnabled) {
      setPlaceholder(t('record.chat.input.placeholder.default'))
      return
    }
    const scanMarks = isLinkMark ? marks.filter(item => item.type === 'scan') : []
    const textMarks = isLinkMark ? marks.filter(item => item.type === 'text') : []
    const imageMarks = isLinkMark ? marks.filter(item => item.type === 'image') : []
    const fileMarks = isLinkMark ? marks.filter(item => item.type === 'file') : []
    const linkMarks = isLinkMark ? marks.filter(item => item.type === 'link') : []
    const lastClearIndex = chats.findLastIndex(item => item.type === 'clear')
    const chatsAfterClear = chats.slice(lastClearIndex + 1)
    const request_content = `
      Use ${locale} language, don't use any other language.
      ${[...scanMarks, ...textMarks, ...imageMarks, ...fileMarks, ...linkMarks]
        .slice(0, 5)
        .map(item => item.content?.replace(/<thinking>[\s\S]*?<thinking>/g, '').slice(0, 60))
        .join(';\n\n')}
      ${chatsAfterClear.slice(0, 5).map(item => item.content?.replace(/<thinking>[\s\S]*?<thinking>/g, '').slice(0, 60)).join(';\n\n')}
    `.trim()
    // 使用非流式请求获取placeholder内容
    const content = await fetchAiPlaceholder(request_content)
    if (content) {
      setPlaceholder(content + ' [Tab]')
    }
  }


  // 插入占位符
  function insertPlaceholder() {
    if (placeholder.includes('[Tab]')) {
      setText(placeholder.replace('[Tab]', ''))
      setPlaceholder('')
    }
  }

  // 处理拖拽结束（仅 PC 端底部工具栏）
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const bottomTools = ['modelSelect', 'promptSelect', 'chatLanguage']
      const bottomItems = chatToolbarConfigPc.filter(item => bottomTools.includes(item.id))
      const oldIndex = bottomItems.findIndex((item) => item.id === active.id)
      const newIndex = bottomItems.findIndex((item) => item.id === over.id)
      
      const reorderedItems = arrayMove(bottomItems, oldIndex, newIndex)
      const allItems = [...chatToolbarConfigPc]
      
      reorderedItems.forEach((item, index) => {
        const globalIndex = allItems.findIndex(i => i.id === item.id)
        if (globalIndex !== -1) {
          allItems[globalIndex] = { ...item, order: bottomItems[0].order + index }
        }
      })
      
      setChatToolbarConfigPc(allItems)
    }
  }

  useEffect(() => {
    if (!primaryModel) {
      setPlaceholder(t('record.chat.input.placeholder.noPrimaryModel'))
      return
    }
    if (marks.length === 0) {
      setPlaceholder(t('record.chat.input.placeholder.default'))
      return
    }
    if (!isPlaceholderEnabled) {
      setPlaceholder(t('record.chat.input.placeholder.default'))
      return
    }
    genInputPlaceholder()
  }, [primaryModel, marks, isLinkMark, isPlaceholderEnabled, t])

  useEffect(() => {
    if (!isPlaceholderEnabled) {
      setPlaceholder(t('record.chat.input.placeholder.default'))
    }
  }, [placeholder, isPlaceholderEnabled])

  useEffect(() => {
    emitter.on('revertChat', (event: unknown) => {
      setText(event as string)
    })
    emitter.on('fileSelected', (event: unknown) => {
      setLinkedFile(event as MarkdownFile)
    })
    return () => {
      emitter.off('revertChat')
      emitter.off('fileSelected')
    }
  }, [])

  return (
    <footer className="relative flex flex-col border rounded-xl p-2 gap-2 mb-2 md:w-[calc(100%-1rem)] w-full">
      <div className="relative w-full flex items-start">
        <Textarea
          className="flex-1 p-2 relative border-none text-xs placeholder:text-xs md:placeholder:text-sm md:text-sm focus-visible:ring-0 shadow-none min-h-[36px] max-h-[240px] resize-none overflow-y-auto"
          rows={1}
          disabled={!primaryModel || loading}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const textarea = e.target
            textarea.style.height = 'auto'
            const newHeight = Math.min(textarea.scrollHeight, 240)
            textarea.style.height = `${newHeight}px`
          }}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isComposing && !e.shiftKey && e.keyCode === 13) {
              e.preventDefault()
              chatSendRef.current?.sendChat()
            }
            if (e.key === "Tab") {
              e.preventDefault()
              insertPlaceholder()
            }
            if (e.key === "ArrowUp" && !isComposing) {
              e.preventDefault()
              navigateHistory('up')
            }
            if (e.key === "ArrowDown" && !isComposing) {
              e.preventDefault()
              navigateHistory('down')
            }
            if (e.key === "Backspace") {
              if (text === '') {
                setPlaceholder(t('record.chat.input.placeholder.default'))
              }
            }
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setTimeout(() => {
            setIsComposing(false)
          }, 0)}
        />
      </div>

      <LinkedFileDisplay
        linkedFile={linkedFile}
        onFileRemove={removeLinkedFile}
      />
      
      <div className="flex justify-between items-center w-full">
        <div className="relative flex-1 overflow-x-auto mr-6 px-2 -translate-x-2">
          {/* 左侧渐变遮罩 */}
          <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none md:hidden" />
          
          {/* 右侧渐变遮罩 */}
          <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none md:hidden" />
          
          {/* 可拖拽排序的按钮容器（桌面端）或普通容器（移动端） */}
          {!isMobile ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={chatToolbarConfigPc.filter(item => ['modelSelect', 'promptSelect', 'chatLanguage'].includes(item.id) && item.enabled).map(item => item.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex overflow-x-auto scrollbar-hide md:overflow-visible">
                  {chatToolbarConfigPc
                    .filter(item => ['modelSelect', 'promptSelect', 'chatLanguage'].includes(item.id) && item.enabled)
                    .sort((a, b) => a.order - b.order)
                    .map(item => (
                      <SortableToolbarItem
                        key={item.id}
                        id={item.id}
                      />
                    ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="flex overflow-x-auto scrollbar-hide md:overflow-visible gap-1">
              {chatToolbarConfigMobile
                .filter(item => item.enabled)
                .sort((a, b) => a.order - b.order)
                .map(item => {
                  switch (item.id) {
                    case 'modelSelect':
                      return <ModelSelect key={item.id} />
                    case 'promptSelect':
                      return <PromptSelect key={item.id} />
                    case 'chatLanguage':
                      return <ChatLanguage key={item.id} />
                    case 'chatLink':
                      return <ChatLink key={item.id} />
                    case 'fileLink':
                      return <FileLink key={item.id} onFileLinkClick={() => setShowFileSelector(true)} disabled={!primaryModel || loading} />
                    case 'mcpButton':
                      return <McpButton key={item.id} />
                    case 'ragSwitch':
                      return <RagSwitch key={item.id} />
                    case 'chatPlaceholder':
                      return <ChatPlaceholder key={item.id} />
                    case 'clipboardMonitor':
                      return <ClipboardMonitor key={item.id} />
                    case 'clearContext':
                      return <ClearContext key={item.id} />
                    case 'clearChat':
                      return <ClearChat key={item.id} />
                    default:
                      return null
                  }
                })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 pr-1">
          <ChatModeSelect />
          <ChatSend inputValue={text} onSent={handleSent} linkedFile={linkedFile} ref={chatSendRef} />
        </div>
      </div>

      {/* 文件选择器（移动端） */}
      {showFileSelector && (
        <FileSelector
          isOpen={showFileSelector}
          onClose={() => setShowFileSelector(false)}
          onFileSelect={(file) => {
            setLinkedFile(file)
            setShowFileSelector(false)
          }}
        />
      )}
    </footer>
  )
}

// 可排序的工具栏项组件
interface SortableToolbarItemProps {
  id: string
}

function SortableToolbarItem({ id }: SortableToolbarItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // 渲染对应的工具栏组件
  const renderToolbarItem = () => {
    switch (id) {
      case 'modelSelect':
        return <ModelSelect />
      case 'promptSelect':
        return <PromptSelect />
      case 'chatLanguage':
        return <ChatLanguage />
      default:
        return null
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      {renderToolbarItem()}
    </div>
  )
}
