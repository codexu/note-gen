"use client"
import * as React from "react"
import { useEffect, useRef, useState, useCallback } from "react"
import useSettingStore from "@/stores/setting"
import { Textarea } from "@/components/ui/textarea"
import useChatStore from "@/stores/chat"
import useMarkStore from "@/stores/mark"
import useArticleStore from "@/stores/article"
import { fetchAiPlaceholder } from "@/lib/ai/placeholder"
import { useTranslations } from 'next-intl'
import { useLocalStorage } from 'react-use';
import { ModelSelect } from "./model-select"
import { getWorkspacePath } from "@/lib/workspace"
import { PromptSelect } from "./prompt-select"
import { ChatLanguage } from "./chat-language"
import { ChatSend } from "./chat-send"
import { LinkedFileDisplay } from "./file-link"
import { FileSelector } from "./file-selector"
import { ChatModeSelect } from "./chat-mode-select"
import { MarkdownFile } from "@/lib/files"
import emitter from "@/lib/emitter"
import { ChatSettingsDrawer } from "@/app/mobile/chat/components/chat-settings-drawer"
import { ChatToolsDrawer } from "@/app/mobile/chat/components/chat-tools-drawer"
import { ChatAttachmentsDrawer } from "@/app/mobile/chat/components/chat-attachments-drawer"
import { useIsMobile } from '@/hooks/use-mobile'
import { ImageAttachments, ImageAttachment } from "./image-attachments"
import { ImageIcon } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import { isMobileDevice } from '@/lib/check'
import { QuoteDisplay } from "./quote-display"
import { convertFileSrc } from "@tauri-apps/api/core"
import { writeFile } from "@tauri-apps/plugin-fs"
import { BaseDirectory } from "@tauri-apps/plugin-fs"
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


export function ChatInput() {
  const [text, setText] = useState("")
  const { primaryModel, chatToolbarConfigPc, setChatToolbarConfigPc } = useSettingStore()
  const { chats, loading, isLinkMark } = useChatStore()
  const [showFileSelector, setShowFileSelector] = useState(false)
  const { marks, trashState } = useMarkStore()
  const { activeFilePath } = useArticleStore()
  const [isComposing, setIsComposing] = useState(false)
  const [placeholder, setPlaceholder] = useState('')
  const t = useTranslations()
  const [inputHistory, setInputHistory] = useLocalStorage<string[]>('chat-input-history', [])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [tempInput, setTempInput] = useState('')
  const [linkedFile, setLinkedFile] = useState<MarkdownFile | null>(null)
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([])
  const [quoteData, setQuoteData] = useState<{
    quote: string
    fullContent: string
    fileName: string
    startLine: number
    endLine: number
    articlePath: string
  } | null>(null)
  const chatSendRef = useRef<any>(null)
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const isMobileDevice_ = isMobileDevice()

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
    setLinkedFile(null)
  }

  function removeImage(id: string) {
    setAttachedImages(prev => prev.filter(img => img.id !== id))
  }

  function removeQuote() {
    setQuoteData(null)
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

  // 移动端相册选择
  async function handleSelectFromGallery() {
    if (isMobileDevice_) {
      // 在移动端，我们暂时只能使用通用的图片选择
      // 用户可以从相册或相机中选择
      if (imageInputRef.current) {
        // 移除 capture 属性，让系统自己决定
        imageInputRef.current.removeAttribute('capture')
        imageInputRef.current.click()
      }
    }
  }

  // 移动端相机拍照
  async function handleTakePhoto() {
    if (isMobileDevice_) {
      // 创建相机输入
      const cameraInput = document.createElement('input')
      cameraInput.type = 'file'
      cameraInput.accept = 'image/*'
      cameraInput.capture = 'environment' // 使用后置摄像头
      cameraInput.style.display = 'none'
      
      cameraInput.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          const url = URL.createObjectURL(file)
          const newImage: ImageAttachment = {
            id: `camera-${Date.now()}-${Math.random()}`,
            url,
            name: file.name,
            source: 'file' as const
          }
          setAttachedImages(prev => [...prev, newImage])
        }
        document.body.removeChild(cameraInput)
      }
      
      document.body.appendChild(cameraInput)
      cameraInput.click()
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
    addToHistory(text)
    setText('')
    setHistoryIndex(-1)
    setAttachedImages([])
    setQuoteData(null)
    const textarea = document.querySelector('textarea')
    if (textarea) {
      textarea.style.height = 'auto'
    }
  }

  // 获取输入框占位符
  async function genInputPlaceholder() {
    if (!primaryModel) return
    if (trashState) return
    const scanMarks = isLinkMark ? marks.filter(item => item.type === 'scan') : []
    const textMarks = isLinkMark ? marks.filter(item => item.type === 'text') : []
    const imageMarks = isLinkMark ? marks.filter(item => item.type === 'image') : []
    const fileMarks = isLinkMark ? marks.filter(item => item.type === 'file') : []
    const linkMarks = isLinkMark ? marks.filter(item => item.type === 'link') : []
    const lastClearIndex = chats.findLastIndex(item => item.type === 'clear')
    const chatsAfterClear = chats.slice(lastClearIndex + 1)
    const request_content = `
      ${[...scanMarks, ...textMarks, ...imageMarks, ...fileMarks, ...linkMarks]
        .slice(0, 5)
        .map(item => item.content?.slice(0, 60))
        .join(';\n\n')}
      ${chatsAfterClear.slice(0, 5).map(item => item.content?.slice(0, 60)).join(';\n\n')}
    `.trim()
    // 使用非流式请求获取placeholder内容
    const content = await fetchAiPlaceholder(request_content)
    if (content) {
      setPlaceholder(content + ' [Tab]')
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
  }, [primaryModel, marks, isLinkMark, chats, trashState, t])


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
    genInputPlaceholder()
  }, [primaryModel, marks, isLinkMark, t])

  useEffect(() => {
    emitter.on('revertChat', (event: unknown) => {
      setText(event as string)
    })
    emitter.on('fileSelected', (event: unknown) => {
      setLinkedFile(event as MarkdownFile)
    })
    emitter.on('insert-quote', (event: unknown) => {
      const data = event as {
        quote: string
        fullContent: string
        fileName: string
        startLine: number
        endLine: number
        articlePath: string
      }
      // 设置引用数据
      setQuoteData(data)
      // 聚焦到输入框
      textareaRef.current?.focus()
      // 触发防抖的 placeholder 重新生成
      debouncedGenPlaceholder()
    })
    return () => {
      emitter.off('revertChat')
      emitter.off('fileSelected')
      emitter.off('insert-quote')
    }
  }, [debouncedGenPlaceholder])

  // 自动关联当前打开的 markdown 文件
  useEffect(() => {
    async function linkCurrentFile() {
      if (activeFilePath && activeFilePath.endsWith('.md')) {
        const workspace = await getWorkspacePath()
        const fileName = activeFilePath.split('/').pop() || activeFilePath
        
        // 构建完整路径
        let fullPath: string
        if (workspace.isCustom) {
          const pathParts = activeFilePath.split('/')
          fullPath = workspace.path + '/' + pathParts.join('/')
        } else {
          fullPath = activeFilePath
        }
        
        setLinkedFile({
          name: fileName,
          path: fullPath,
          relativePath: activeFilePath
        })
      } else {
        // 如果没有打开的文件，清除关联
        setLinkedFile(null)
      }
    }
    
    linkCurrentFile()
  }, [activeFilePath])

  // 当关联文件变化时，触发防抖的 placeholder 重新生成
  useEffect(() => {
    if (linkedFile) {
      debouncedGenPlaceholder()
    }
  }, [linkedFile, debouncedGenPlaceholder])

  return (
    <footer className="flex flex-col w-full p-1 justify-between items-center">
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
        linkedFile={linkedFile}
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
        {quoteData && (
          <QuoteDisplay quoteData={quoteData} onRemove={removeQuote} />
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
                <ChatAttachmentsDrawer
                  onImageSelect={handleSelectFromGallery}
                  onCameraOpen={handleTakePhoto}
                  onFileLink={setLinkedFile}
                />
                <ChatSettingsDrawer />
                <ChatToolsDrawer />
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 pr-1">
            {!isMobile && (
              <TooltipButton
                variant="link"
                size="sm"
                icon={<ImageIcon className="size-4" />}
                tooltipText={t('record.chat.input.attachImage')}
                onClick={handleSelectLocalImages}
                disabled={!primaryModel || loading}
              />
            )}
            <ChatModeSelect />
            <ChatSend inputValue={text} onSent={handleSent} linkedFile={linkedFile} attachedImages={attachedImages} quoteData={quoteData} ref={chatSendRef} />
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
        
      </div>
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
