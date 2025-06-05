import { Separator } from "@/components/ui/separator"
import { Chat } from "@/db/chats"
import useChatStore from "@/stores/chat"
import dayjs from "dayjs"
import { Clock, GlobeIcon, TypeIcon, XIcon } from "lucide-react"
import relativeTime from "dayjs/plugin/relativeTime";
import wordsCount from 'words-count';
import { Button } from "@/components/ui/button"
import { clear, hasText, readText } from "tauri-plugin-clipboard-api"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { fetchAiTranslate } from "@/lib/ai"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { scrollToBottom } from '@/lib/utils'

dayjs.extend(relativeTime)

export default function MessageControl({chat, children}: {chat: Chat, children: React.ReactNode}) {
  const { loading } = useChatStore()
  const count = wordsCount(chat.content || '')
  const { deleteChat } = useChatStore()
  const t = useTranslations()
  const [translatedContent, setTranslatedContent] = useState<string>('')
  const [isTranslating, setIsTranslating] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')
  const translateT = useTranslations('record.chat.input.translate')
  
  // 可翻译的语言列表
  const languageOptions = [
    "English",
    "中文",
    "日本語",
    "한국어",
    "Français",
    "Deutsch",
    "Español",
    "Русский",
  ]
  
  async function deleteHandler() {
    if (chat.type === "clipboard" && !chat.image) {
      const hasTextRes = await hasText()
      if (hasTextRes) {
        try {
          const text = await readText()
          if (text === chat.content) {
            await clear()
          }
        } catch {}
      }
    }
    deleteChat(chat.id)
  }
  
  // 处理翻译
  async function handleTranslate(language: string) {
    if (!chat.content || isTranslating) return
    
    setIsTranslating(true)
    setSelectedLanguage(language)
    
    try {
      const translatedText = await fetchAiTranslate(chat.content, language)
      setTranslatedContent(translatedText)
    } catch (error) {
      console.error('Translation error:', error)
    } finally {
      setIsTranslating(false)
      setTimeout(() => {
        scrollToBottom()
      }, 100);
    }
  }
  
  // 重置翻译
  function resetTranslation() {
    setTranslatedContent('')
    setSelectedLanguage('')
  }

  if (!loading) {
    return (
      <>
        <div className='flex items-center gap-1 -translate-x-3'>
          <Button variant={"ghost"} size="sm" disabled>
            <Clock className="size-4" />
            { dayjs(chat.createdAt).fromNow() }
          </Button>
          <Separator orientation="vertical" className="h-4" />
          {
            count ? <>
              <Button variant={"ghost"} size="sm" disabled>
                <TypeIcon className="size-4" />
                { count } {t('record.chat.messageControl.words')}
              </Button>
              <Separator orientation="vertical" className="h-4" /> 
            </> : null
          }
          
          {/* 翻译功能 */}
          {chat.content && chat.type === 'chat' && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant={"ghost"} 
                    size="sm" 
                    className={selectedLanguage ? "bg-muted" : ""}
                    disabled={isTranslating}
                  >
                    <GlobeIcon className="size-4 mr-1" />
                    {
                      isTranslating ? 
                      translateT('translating') : 
                      (selectedLanguage ? `${translateT('alreadyTranslated')} ${languageOptions
                        .find(l => l === selectedLanguage)}` : translateT('tooltip'))}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {selectedLanguage ? (
                    <DropdownMenuItem onClick={resetTranslation}>
                      {translateT('showOriginal')}
                    </DropdownMenuItem>
                  ) : (
                    languageOptions.map((language) => (
                      <DropdownMenuItem 
                        key={language}
                        onClick={() => handleTranslate(language)}
                      >
                        {language}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Separator orientation="vertical" className="h-4" />
            </>
          )}
          
          {children}
          {
            chat.type !== "chat" && 
            <>
              <Separator orientation="vertical" className="h-4" />
              <Button variant={"ghost"} size={"icon"} onClick={deleteHandler}>
                <XIcon className='size-4' />
              </Button>
            </>
          }
        </div>
        
        {/* 显示翻译结果 */}
        {translatedContent && (
          <div className="mt-2 pt-2 border-t border-border">
            <div className="whitespace-pre-wrap">{translatedContent}</div>
          </div>
        )}
      </>
    );
  }
}
