"use client"
import * as React from "react"
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import useSettingStore from "@/stores/setting"
import { Textarea } from "@/components/ui/textarea"
import useChatStore from "@/stores/chat"
import useMarkStore from "@/stores/mark"
import useArticleStore from "@/stores/article"
import { fetchAiQuickPrompts } from "@/lib/ai/placeholder"
import { useTranslations } from 'next-intl'
import { useLocalStorage } from 'react-use';
import { ModelSelect } from "./model-select"
import { getWorkspacePath } from "@/lib/workspace"
import { PromptSelect } from "./prompt-select"
import { ChatSend } from "./chat-send"
import { LinkedFileDisplay } from "./file-link"
import { LinkedResource, MarkdownFile, LinkedFolder } from "@/lib/files"
import { McpButton } from "./mcp-button"
import { RagSwitch } from "./rag-switch"
import { ClipboardMonitor } from "./clipboard-monitor"
import emitter from "@/lib/emitter"
import { ChatToolsDrawer } from "@/app/mobile/chat/components/chat-tools-drawer"
import { useIsMobile } from '@/hooks/use-mobile'
import { ImageAttachments, ImageAttachment } from "./image-attachments"
import { ImageIcon } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import { isMobileDevice } from '@/lib/check'
import { QuoteDisplay } from "./quote-display"
import type { PendingQuote } from "@/stores/chat"
import { convertFileSrc } from "@tauri-apps/api/core"
import { readTextFile, writeFile, BaseDirectory, exists } from "@tauri-apps/plugin-fs"
import { ShineBorder } from "@/components/ui/shine-border"
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
import { buildTypingFrames } from './onboarding-typing'

// 可排序的工具栏项组件 - 定义在外部以避免每次 ChatInput re-render 时重新创建
interface SortableToolbarItemProps {
  id: string
}

const SortableToolbarItem = React.memo(function SortableToolbarItem({ id }: SortableToolbarItemProps) {
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
      case 'mcpButton':
        return <McpButton />
      case 'ragSwitch':
        return <RagSwitch />
      case 'clipboardMonitor':
        return <ClipboardMonitor />
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
})
SortableToolbarItem.displayName = 'SortableToolbarItem'


export const ChatInput = React.memo(function ChatInput() {
  const [text, setText] = useState("")
  const { primaryModel, chatToolbarConfigPc, setChatToolbarConfigPc } = useSettingStore()
  const {
    chats,
    loading,
    setLinkedResource: setChatLinkedResource,
    setLinkedResourcePreview,
    onboardingPromptDraft,
    setOnboardingPromptDraft,
    pendingQuote,
    setPendingQuote,
    clearPendingQuote,
  } = useChatStore()
  const { marks, trashState } = useMarkStore()
  const { activeFilePath } = useArticleStore()
  const [isComposing, setIsComposing] = useState(false)
  const [placeholder, setPlaceholder] = useState('')
  const t = useTranslations()
  const [inputHistory, setInputHistory] = useLocalStorage<string[]>('chat-input-history', [])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [tempInput, setTempInput] = useState('')
  const [linkedResource, setLinkedResource] = useState<LinkedResource | null>(null)
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([])
  const chatSendRef = useRef<any>(null)
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const isMobileDevice_ = isMobileDevice()
  const onboardingAgentPromptArmedRef = useRef(false)
  const onboardingTypingTimerRefs = useRef<number[]>([])

  const applyTypedText = useCallback((value: string) => {
    setText(value)

    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    window.requestAnimationFrame(() => {
      textarea.style.height = 'auto'
      const newHeight = Math.min(textarea.scrollHeight, 240)
      textarea.style.height = `${newHeight}px`
    })
  }, [])

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
  function navigateHistory(direction: 'up' | 'down', currentText: string) {
    if (!inputHistory || inputHistory.length === 0) return

    let newIndex: number
    if (direction === 'up') {
      // 保存当前输入内容（第一次向上时）
      if (historyIndex === -1) {
        setTempInput(currentText)
      }
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
      // 恢复到原本输入的内容
      setText(tempInput)
    } else {
      setText(inputHistory[newIndex])
    }
  }

  // 移除关联文件
  function removeLinkedFile() {
    setLinkedResource(null)
    setChatLinkedResource(null)
  }

  function removeImage(id: string) {
    setAttachedImages(prev => prev.filter(img => img.id !== id))
  }

  function removeQuote() {
    clearPendingQuote()
  }

  async function handleSelectLocalImages() {
    try {
      // 移动端使用 HTML5 file input
      if (isMobileDevice_) {
        imageInputRef.current?.click()
        return
      }

      // PC端使用 Tauri dialog
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
        }]
      })

      if (selected && Array.isArray(selected)) {
        const newImages: ImageAttachment[] = selected.map((path) => ({
          id: `local-${Date.now()}-${Math.random()}`,
          url: convertFileSrc(path),
          name: path.split('/').pop() || path,
          source: 'file' as const
        }))
        
        setAttachedImages(prev => [...prev, ...newImages])
      }
    } catch (error) {
      console.error('Failed to select files:', error)
    }
  }

  // 移动端图片选择，交给系统决定从相册还是相机获取
  async function handleSelectFromGallery() {
    if (isMobileDevice_) {
      if (imageInputRef.current) {
        imageInputRef.current.removeAttribute('capture')
        imageInputRef.current.click()
      }
    }
  }

  // 处理移动端文件选择
  async function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      const files = event.target.files
      if (!files || files.length === 0) return

      const newImages: ImageAttachment[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const url = URL.createObjectURL(file)
        newImages.push({
          id: `local-${Date.now()}-${Math.random()}`,
          url,
          name: file.name,
          source: 'file' as const
        })
      }

      setAttachedImages(prev => [...prev, ...newImages])
      
      // 重置 input
      event.target.value = ''
    } catch (error) {
      console.error('Error in handleImageInputChange:', error)
    }
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    e.preventDefault()

    const newImages: ImageAttachment[] = []
    for (const item of imageItems) {
      const blob = item.getAsFile()
      if (!blob) continue

      try {
        const arrayBuffer = await blob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        const fileName = `paste-${Date.now()}-${Math.random().toString(36).substring(7)}.png`
        const filePath = `screenshot/${fileName}`
        
        await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })
        
        const fullPath = await (async () => {
          const { appDataDir, join } = await import('@tauri-apps/api/path')
          const appData = await appDataDir()
          return await join(appData, filePath)
        })()

        newImages.push({
          id: `paste-${Date.now()}-${Math.random()}`,
          url: convertFileSrc(fullPath),
          name: fileName,
          source: 'paste'
        })
      } catch (error) {
        console.error('Failed to save pasted image:', error)
      }
    }

    if (newImages.length > 0) {
      setAttachedImages(prev => [...prev, ...newImages])
    }
  }

  // 处理发送后的清理工作
  function handleSent() {
    if (onboardingAgentPromptArmedRef.current) {
      onboardingAgentPromptArmedRef.current = false
      emitter.emit('onboarding-step-complete', { step: 'ai-polish' })
    }
    addToHistory(text)
    setText('')
    setHistoryIndex(-1)
    setAttachedImages([])
    clearPendingQuote()
    const textarea = document.querySelector('textarea')
    if (textarea) {
      textarea.style.height = 'auto'
    }
  }

  // 获取输入框占位符
  async function genInputPlaceholder() {
    if (!primaryModel) return
    if (trashState) return
    const lastClearIndex = chats.findLastIndex(item => item.type === 'clear')
    const chatsAfterClear = chats.slice(lastClearIndex + 1)
    const request_content = `
      ${chatsAfterClear.slice(0, 5).map(item => item.content?.slice(0, 60)).join(';\n\n')}
    `.trim()
    // 使用 fetchAiQuickPrompts 获取4条提示词
    const prompts = await fetchAiQuickPrompts(request_content)
    // 发送事件给 chat-empty 组件，显示前3条
    if (prompts.length >= 3) {
      emitter.emit('ai-prompts-generated', prompts)
    }
    // 取第4条作为 placeholder
    if (prompts.length >= 4 && prompts[3]?.text) {
      setPlaceholder(prompts[3].text + ' [Tab]')
    }
  }

  // 防抖的 placeholder 生成函数，延迟 1.5 秒执行，只执行最后一次
  const debouncedGenPlaceholder = useCallback(() => {
    // 清除之前的定时器
    if (placeholderTimerRef.current) {
      clearTimeout(placeholderTimerRef.current)
    }
    
    // 设置新的定时器
    placeholderTimerRef.current = setTimeout(() => {
      genInputPlaceholder()
    }, 1500) // 1.5秒延迟
  }, [primaryModel, marks, chats, trashState, t])


  // 插入占位符
  function insertPlaceholder() {
    if (placeholder.includes('[Tab]')) {
      setText(placeholder.replace('[Tab]', ''))
      setPlaceholder('')
    }
  }

  // 处理拖拽结束（底部工具栏）
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const enabledItems = chatToolbarConfigPc.filter(item => item.enabled)
      const oldIndex = enabledItems.findIndex((item) => item.id === active.id)
      const newIndex = enabledItems.findIndex((item) => item.id === over.id)

      const reorderedItems = arrayMove(enabledItems, oldIndex, newIndex)
      const allItems = [...chatToolbarConfigPc]

      reorderedItems.forEach((item, index) => {
        const globalIndex = allItems.findIndex(i => i.id === item.id)
        if (globalIndex !== -1) {
          allItems[globalIndex] = { ...item, order: enabledItems[0].order + index }
        }
      })

      setChatToolbarConfigPc(allItems)
    }
  }, [chatToolbarConfigPc, setChatToolbarConfigPc])

  // 使用 useMemo 优化工具栏项过滤 - 显示底部工具栏（排除 newChat）
  const bottomToolbarItems = useMemo(() => {
    return chatToolbarConfigPc
      .filter(item => item.enabled && item.id !== 'newChat')
      .sort((a, b) => a.order - b.order)
  }, [chatToolbarConfigPc])

  useEffect(() => {
    // 如果有 marks，生成 AI 提示词作为 placeholder
    if (marks.length > 0) {
      genInputPlaceholder()
    } else {
      setPlaceholder(t('record.chat.input.placeholder.default'))
    }
  }, [primaryModel, marks, t])

  useEffect(() => {
    emitter.on('revertChat', (event: unknown) => {
      setText(event as string)
    })
    emitter.on('fileSelected', (event: unknown) => {
      setLinkedResource(event as MarkdownFile)
      setChatLinkedResource(event as MarkdownFile)
    })
    emitter.on('folderSelected', (event: unknown) => {
      setLinkedResource(event as LinkedFolder)
      setChatLinkedResource(event as LinkedFolder)
    })
    emitter.on('insert-quote', (event: unknown) => {
      const data = event as PendingQuote
      setPendingQuote(data)
      // 延迟聚焦到输入框
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
      // 触发防抖的 placeholder 重新生成
      debouncedGenPlaceholder()
    })
    emitter.on('quick-prompt-insert', (prompt: string) => {
      setText(prompt)
      textareaRef.current?.focus()
    })
    emitter.on('ai-placeholder-generated', (event: unknown) => {
      const promptText = event as string
      if (promptText) {
        setPlaceholder(promptText)
      }
    })
    return () => {
      onboardingTypingTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId))
      onboardingTypingTimerRefs.current = []
      emitter.off('revertChat')
      emitter.off('fileSelected')
      emitter.off('folderSelected')
      emitter.off('insert-quote')
      emitter.off('quick-prompt-insert')
      emitter.off('ai-placeholder-generated')
    }
  }, [debouncedGenPlaceholder, setPendingQuote])

  useEffect(() => {
    if (!onboardingPromptDraft) {
      return
    }

    onboardingAgentPromptArmedRef.current = true
    onboardingTypingTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId))
    onboardingTypingTimerRefs.current = []
    setText('')
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)

    const frames = buildTypingFrames(onboardingPromptDraft, 2)
    frames.forEach((frame, index) => {
      const timerId = window.setTimeout(() => {
        applyTypedText(frame)
        if (index === frames.length - 1) {
          onboardingTypingTimerRefs.current = []
          setOnboardingPromptDraft(null)
        }
      }, 160 + index * 42)
      onboardingTypingTimerRefs.current.push(timerId)
    })
  }, [applyTypedText, onboardingPromptDraft, setOnboardingPromptDraft])

  // 生成文件的行号预览（用于 AI 对话）
  async function generateFilePreview(filePath: string, isCustom: boolean, preferEditorContent: boolean = false): Promise<string> {
    try {
      if (preferEditorContent) {
        const editorContent = await new Promise<{
          markdown: string
          totalLines?: number
          numberedLines?: string
          version: number
        } | null>((resolve) => {
          emitter.emit('editor-get-content', {
            resolve: (data: { markdown: string; totalLines?: number; numberedLines?: string; version: number }) => {
              resolve(data)
            },
          })

          window.setTimeout(() => resolve(null), 300)
        })

        if (editorContent?.numberedLines) {
          const numberedLines = editorContent.numberedLines.split('\n')
          const previewLines = numberedLines.slice(0, 100)
          const totalLines = editorContent.totalLines || numberedLines.length
          const truncatedNote = totalLines > 100 ? `\n... (共 ${totalLines} 行，后 ${totalLines - 100} 行省略)` : ''

          return `已关联当前编辑器文件：${filePath.split('/').pop() || filePath}
你可以直接基于下面的行号和版本使用 replace_editor_content。

编辑器版本：v${editorContent.version}
行号预览：
\`\`\`
${previewLines.join('\n')}
\`\`\`${truncatedNote}

优先使用：
- 修改某个区块/列表：replace_editor_content({startLine: 4, endLine: 5, replaceContent: "新内容", version: ${editorContent.version}})
- 仅在有精确选区位置时才使用 from/to
`
        }
      }

      // 检查文件是否存在
      const fileExists = isCustom
        ? await exists(filePath)
        : await exists(filePath, { baseDir: BaseDirectory.AppData })

      if (!fileExists) {
        return `文件 ${filePath.split('/').pop() || filePath} 不存在或已被删除`
      }

      let content: string
      if (isCustom) {
        content = await readTextFile(filePath)
      } else {
        content = await readTextFile(filePath, { baseDir: BaseDirectory.AppData })
      }

      const lines = content.split('\n')
      const previewLines = lines.slice(0, 100).map((line, index) => {
        const lineNum = index + 1
        const preview = line.length > 60 ? line.slice(0, 60) + '...' : line
        return `${String(lineNum).padStart(4)} | ${preview}`
      })

      const totalLines = lines.length
      const truncatedNote = totalLines > 100 ? `\n... (共 ${totalLines} 行，后 ${totalLines - 100} 行省略)` : ''

      return `已关联文件：${filePath.split('/').pop() || filePath}
你可以使用 replace_editor_content 工具通过行号修改内容。

行号预览：
\`\`\`
${previewLines.join('\n')}
\`\`\`${truncatedNote}

使用示例：
- 修改第 4-5 行：replace_editor_content({startLine: 4, endLine: 5, replaceContent: "新内容"})
- 替换第 10 行的特定内容：replace_editor_content({startLine: 10, endLine: 10, replaceContent: "新内容"})
`
    } catch (error) {
      console.error('生成文件预览失败:', error)
      return `已关联文件：${filePath.split('/').pop() || filePath}
（无法读取文件内容）`
    }
  }

  // 自动关联当前打开的 markdown 文件或文件夹
  useEffect(() => {
    async function linkCurrentResource() {
      if (!activeFilePath) {
        setLinkedResource(null)
        setChatLinkedResource(null)
        setLinkedResourcePreview(null)
        return
      }

      const workspace = await getWorkspacePath()

      // 检查是否是支持的文件类型（包括 markdown、代码文件等）
      if (activeFilePath.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i)) {
        // 文件关联逻辑
        const fileName = activeFilePath.split('/').pop() || activeFilePath

        // 构建完整路径
        let fullPath: string
        if (workspace.isCustom) {
          const pathParts = activeFilePath.split('/')
          fullPath = workspace.path + '/' + pathParts.join('/')
        } else {
          fullPath = activeFilePath
        }

        const resource = {
          name: fileName,
          path: fullPath,
          relativePath: activeFilePath
        }
        setLinkedResource(resource)
        setChatLinkedResource(resource)

        // 生成并设置文件预览
        const preview = await generateFilePreview(fullPath, workspace.isCustom, activeFilePath === resource.relativePath)
        setLinkedResourcePreview(preview)
      } else if (!activeFilePath.includes('.')) {
        // 文件夹关联逻辑 - 只有当路径不包含 . 时才可能是文件夹
        const folderName = activeFilePath.split('/').pop() || activeFilePath

        // 构建完整路径
        let fullPath: string
        if (workspace.isCustom) {
          const pathParts = activeFilePath.split('/')
          fullPath = workspace.path + '/' + pathParts.join('/')
        } else {
          fullPath = activeFilePath
        }

        // 计算文件夹中的文件数量和索引状态
        const { collectMarkdownFiles } = await import('@/lib/files')
        const files = await collectMarkdownFiles(activeFilePath)
        const { vectorIndexedFiles } = useArticleStore.getState()
        const indexedCount = files.filter(f =>
          vectorIndexedFiles.has(f.path)
        ).length

        // 只有在有索引文件时才关联文件夹
        if (indexedCount > 0) {
          const resource = {
            name: folderName,
            path: fullPath,
            relativePath: activeFilePath,
            fileCount: files.length,
            indexedCount: indexedCount
          }
          setLinkedResource(resource)
          setChatLinkedResource(resource)
          // 文件夹不生成行号预览
          setLinkedResourcePreview(null)
        } else {
          // 没有索引文件，清除关联
          setLinkedResource(null)
          setChatLinkedResource(null)
          setLinkedResourcePreview(null)
        }
      } else {
        // 不支持的文件类型（如 .docx, .pdf 等），不进行关联
        setLinkedResource(null)
        setChatLinkedResource(null)
        setLinkedResourcePreview(null)
      }
    }

    linkCurrentResource()
  }, [activeFilePath])

  // 当关联文件变化时，触发防抖的 placeholder 重新生成
  useEffect(() => {
    if (linkedResource) {
      debouncedGenPlaceholder()
    }
  }, [linkedResource, debouncedGenPlaceholder])

  return (
    <footer id="onboarding-target-chat-input" className="flex flex-col w-full p-1 justify-between items-center">
      {/* 移动端图片选择 */}
      {isMobileDevice_ && (
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageInputChange}
          className="hidden"
        />
      )}
      <LinkedFileDisplay
        linkedResource={linkedResource}
        onFileRemove={removeLinkedFile}
      />
      <div className="group relative flex flex-col border rounded-xl z-10 gap-1 p-1 w-full bg-background focus-within:border-primary transition-colors overflow-hidden">
        {loading && (
          <ShineBorder
            borderWidth={1}
            duration={5}
            shineColor={["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A"]}
          />
        )}
        {pendingQuote && (
          <QuoteDisplay quoteData={pendingQuote} onRemove={removeQuote} />
        )}
        <ImageAttachments images={attachedImages} onRemove={removeImage} />
        <div className="relative w-full flex items-start">
          <Textarea
            ref={textareaRef}
            className="flex-1 p-2 relative border-none text-xs placeholder:text-sm md:placeholder:text-sm md:text-sm focus-visible:ring-0 shadow-none min-h-[36px] max-h-[240px] resize-none overflow-y-auto"
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
              const textarea = e.target as HTMLTextAreaElement
              const cursorPosition = textarea.selectionStart
              const isAtStart = cursorPosition === 0
              const isAtEnd = cursorPosition === text.length

              if (e.key === "Enter" && !isComposing && !e.shiftKey && e.keyCode === 13) {
                e.preventDefault()
                chatSendRef.current?.sendChat()
              }
              if (e.key === "Tab") {
                e.preventDefault()
                insertPlaceholder()
              }
              if (e.key === "ArrowUp" && !isComposing) {
                if (isAtStart) {
                  e.preventDefault()
                  navigateHistory('up', text)
                } else if (isAtEnd) {
                  e.preventDefault()
                  // 移动光标到开头
                  textarea.setSelectionRange(0, 0)
                }
              }
              if (e.key === "ArrowDown" && !isComposing) {
                if (isAtStart) {
                  e.preventDefault()
                  navigateHistory('down', text)
                } else if (isAtEnd) {
                  e.preventDefault()
                  // 移动光标到开头
                  textarea.setSelectionRange(0, 0)
                }
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
            onPaste={handlePaste}
          />
        </div>
        
        <div className="flex justify-between items-center w-full">
          <div className="flex-1">
            {/* 可拖拽排序的按钮容器（桌面端）或普通容器（移动端） */}
            {!isMobile ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={bottomToolbarItems.map(item => item.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  <div className="flex overflow-x-auto scrollbar-hide md:overflow-visible">
                    {bottomToolbarItems.map(item => (
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
                <ChatToolsDrawer />
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 pr-1">
            <TooltipButton
              variant="link"
              size="sm"
              icon={<ImageIcon className="size-4" />}
              tooltipText={t('record.chat.input.attachImage')}
              onClick={isMobile ? handleSelectFromGallery : handleSelectLocalImages}
              disabled={!primaryModel || loading}
            />
            <ChatSend inputValue={text} onSent={handleSent} linkedResource={linkedResource} attachedImages={attachedImages} quoteData={pendingQuote} ref={chatSendRef} />
          </div>
        </div>

      </div>
    </footer>
  )
})
ChatInput.displayName = 'ChatInput'
