"use client"
import * as React from "react"
import { useEffect, useRef, useState } from "react"
import useSettingStore from "@/stores/setting"
import { Textarea } from "@/components/ui/textarea"
import useChatStore from "@/stores/chat"
import useMarkStore from "@/stores/mark"
import { fetchAiPlaceholder } from "@/lib/ai"
import { MarkGen } from "./mark-gen"
import { useTranslations } from 'next-intl'
import { ChatLink } from "./chat-link"
import { useLocalStorage } from 'react-use';
import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"
import { ClearChat } from "./clear-chat"
import { ClearContext } from "./clear-context"
import { ChatLanguage } from "./chat-language"
import { InputModeSelect } from "./input-mode-select"
import { ChatSend } from "./chat-send"
import { TranslateSend } from "./translate-send"
import ChatPlaceholder from "./chat-placeholder"
import { ClipboardMonitor } from "./clipboard-monitor"
import { RagSwitch } from "./rag-switch"
import emitter from "@/lib/emitter"


export function ChatInput() {
  const [text, setText] = useState("")
  const { primaryModel } = useSettingStore()
  const { chats, loading, locale, isLinkMark, isPlaceholderEnabled } = useChatStore()
  const { marks, trashState } = useMarkStore()
  const [isComposing, setIsComposing] = useState(false)
  const [placeholder, setPlaceholder] = useState('')
  const t = useTranslations()
  const [inputType, setInputType] = useLocalStorage('chat-input-type', 'chat')
  const markGenRef = useRef<any>(null)
  const chatSendRef = useRef<any>(null)
  const translateSendRef = useRef<any>(null)


  // 处理发送后的清理工作
  function handleSent() {
    setText('')
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

  // 切换输入类型
  function inputTypeChangeHandler(value: string) {
    setInputType(value)
  }

  // 插入占位符
  function insertPlaceholder() {
    if (placeholder.includes('[Tab]')) {
      setText(placeholder.replace('[Tab]', ''))
      setPlaceholder('')
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
    return () => {
      emitter.off('revertChat')
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
              if (inputType === "gen") {
                markGenRef.current?.openGen()
              } else if (inputType === "chat") {
                chatSendRef.current?.sendChat()
              } else if (inputType === "translate") {
                translateSendRef.current?.sendTranslate()
              }
            }
            if (e.key === "Tab") {
              e.preventDefault()
              insertPlaceholder()
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
      <div className="flex justify-between items-center w-full">
        <div className="flex">
          <ModelSelect />
          <PromptSelect />
          <ChatLanguage />
          <ChatLink inputType={inputType} />
          <RagSwitch />
          <ChatPlaceholder />
          <ClipboardMonitor />
          <ClearContext />
          <ClearChat />
        </div>
        <div className="flex items-center justify-end gap-2 pr-1">
          <InputModeSelect value={inputType || 'chat'} onChange={inputTypeChangeHandler} />
          {
            inputType === 'gen' ? (
              <MarkGen inputValue={text} ref={markGenRef} />
            ) : inputType === 'chat' ? (
              <ChatSend inputValue={text} onSent={handleSent} ref={chatSendRef} />
            ) : inputType === 'translate' ? (
              <TranslateSend inputValue={text} onSent={handleSent} ref={translateSendRef} />
            ) : null
          }
        </div>
      </div>
    </footer>
  )
}
