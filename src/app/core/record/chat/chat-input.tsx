"use client"
import * as React from "react"
import { useEffect, useState } from "react"
import { Send } from "lucide-react"
import useSettingStore from "@/stores/setting"
import { Input } from "@/components/ui/input"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import { fetchAi } from "@/lib/ai"
import { TooltipButton } from "@/components/tooltip-button"
import { MarkGen } from "./mark-gen"
import { _t } from '@/locales/index';

export function ChatInput() {
  const [text, setText] = useState("")
  const { apiKey } = useSettingStore()
  const { currentTagId } = useTagStore()
  const { insert, loading, setLoading, saveChat, locale, chats } = useChatStore()
  const { fetchMarks, marks, trashState } = useMarkStore()
  const [isComposing, setIsComposing] = useState(false)
  const [placeholder, setPlaceholder] = useState(_t('chat_input_placeholder_default'))

  async function handleSubmit() {
    if (text === '') return
    setText('')
    setLoading(true)
    await insert({
      tagId: currentTagId,
      role: 'user',
      content: text,
      type: 'chat',
      inserted: false,
      image: undefined,
    })

    const message = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
      image: undefined,
    })
    if (!message) return

    await fetchMarks()

    const scanMarks = marks.filter(item => item.type === 'scan')
    const textMarks = marks.filter(item => item.type === 'text')
    const imageMarks = marks.filter(item => item.type === 'image')
    const chatHistory = chats.filter((item) => item.tagId === currentTagId && item.type === "chat").map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n')

    const request_content = _t(
      'chat_input_submit_chat_request',
      scanMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n'),
      textMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n'),
      imageMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n'),
      chatHistory,
      locale,
      text
    );
    const content = await fetchAi(request_content)
    await saveChat({
      ...message,
      content,
    })
    setLoading(false)
  }

  async function genInputPlaceholder() {
    if (!apiKey) return
    if (trashState) return
    const scanMarks = marks.filter(item => item.type === 'scan')
    const textMarks = marks.filter(item => item.type === 'text')
    const imageMarks = marks.filter(item => item.type === 'image')
    const userQuestionHistorys = chats.filter((item) => item.tagId === currentTagId && item.type === "chat" && item.role === 'user').map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n')
    const chatHistory = chats.filter((item) => item.tagId === currentTagId && item.type === "chat").map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n')

    const request_content = _t(
      'chat_input_gen_placeholder_request',
      scanMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n'),
      textMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n'),
      imageMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n'),
      chatHistory,
      userQuestionHistorys,
      locale,
    )
    const content = await fetchAi(request_content)
    if (content.length < 30 && content.length > 10) {
      setPlaceholder(content + '[Tab]')
    }
  }

  useEffect(() => {
    if (marks.length === 0) {
      setPlaceholder(_t('chat_input_placeholder_default'))
    } else {
      genInputPlaceholder()
    }
  }, [marks])

  useEffect(() => {
    if (!apiKey) {
      setPlaceholder(_t('chat_input_placeholder_no_api_key'))
    } else {
      setPlaceholder(_t('chat_input_placeholder_default'))
    }
  }, [apiKey])

  return (
    <footer className="my-4 border px-4 py-4 shadow-lg rounded-xl min-w-[500px] w-2/3 max-w-[800px] flex bg-primary-foreground h-14 items-center">
      <Input
        className="flex-1 border-none focus-visible:ring-0 shadow-none"
        disabled={!apiKey}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isComposing) {
            e.preventDefault()
            handleSubmit()
          }
          if (e.key === "Tab") {
            e.preventDefault()
            setText(placeholder.replace('[Tab]', ''))
          }
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setTimeout(() => {
          setIsComposing(false)
        }, 0)}
      />
      <TooltipButton icon={<Send />} disabled={loading || !apiKey} tooltipText={_t('send')} onClick={handleSubmit} />
    </footer>
  )
}
