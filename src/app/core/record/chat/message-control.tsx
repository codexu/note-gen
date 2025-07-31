import { Separator } from "@/components/ui/separator"
import { Chat } from "@/db/chats"
import useChatStore from "@/stores/chat"
import dayjs from "dayjs"
import { Clock, GlobeIcon, TypeIcon, XIcon, Volume2, VolumeX } from "lucide-react"
import relativeTime from "dayjs/plugin/relativeTime";
import wordsCount from 'words-count';
import { Button } from "@/components/ui/button"
import { clear, hasText, readText } from "tauri-plugin-clipboard-api"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { fetchAiTranslate } from "@/lib/ai"
import { textToSpeechAndPlay } from "@/lib/audio"
import useSettingStore from "@/stores/setting"
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
  const { audioModel } = useSettingStore()
  const t = useTranslations()
  const [translatedContent, setTranslatedContent] = useState<string>('')
  const [isTranslating, setIsTranslating] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')
  const [isPlaying, setIsPlaying] = useState(false)
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
  
  // 处理朗读
  async function handleTextToSpeech() {
    if (!chat.content || isPlaying || !audioModel) return
    
    setIsPlaying(true)
    
    try {
      // 使用翻译后的内容或原始内容
      let textToRead = translatedContent || chat.content
      
      // 移除 <thinking> 标签及其内容
      textToRead = textToRead.replace(/<thinking[^>]*>[\s\S]*?<thinking>/gi, '')
      
      // 清理多余的空白字符
      textToRead = textToRead.trim()
      
      if (!textToRead) {
        console.warn('朗读内容为空')
        return
      }
      
      await textToSpeechAndPlay(textToRead)
    } catch (error) {
      console.error('朗读失败:', error)
      // 可以在这里添加错误提示
    } finally {
      setIsPlaying(false)
    }
  }

  if (!loading) {
    return (
      <>
        <div className='flex items-center gap-1 -translate-x-3'>
          <Button variant={"ghost"} size="sm" disabled>
            <Clock className="size-4 hidden lg:inline" />
            { dayjs(chat.createdAt).fromNow() }
          </Button>
          <Separator orientation="vertical" className="h-4" />
          {
            count ? <>
              <Button variant={"ghost"} size="sm" disabled>
                <TypeIcon className="size-4 hidden lg:inline" />
                <span>{ count } {t('record.chat.messageControl.words')}</span>
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
                    <span className="hidden lg:inline">
                      {
                        isTranslating ? 
                        translateT('translating') : 
                        (selectedLanguage ? `${translateT('alreadyTranslated')} ${languageOptions
                          .find(l => l === selectedLanguage)}` : translateT('tooltip'))
                      }
                    </span>
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
          
          {/* 朗读功能 */}
          {chat.content && chat.type === 'chat' && audioModel && (
            <>
              <Button 
                variant={"ghost"} 
                size="sm" 
                onClick={handleTextToSpeech}
                disabled={isPlaying || !audioModel}
                className={isPlaying ? "bg-muted" : ""}
              >
                {isPlaying ? (
                  <VolumeX className="size-4 mr-1" />
                ) : (
                  <Volume2 className="size-4 mr-1" />
                )}
                <span className="hidden lg:inline">
                  {isPlaying ? t('record.chat.messageControl.playing') : t('record.chat.messageControl.readAloud')}
                </span>
              </Button>
              <Separator orientation="vertical" className="h-4" />
            </>
          )}
          
          {children}
          <Separator orientation="vertical" className="h-4" />
          <Button variant={"ghost"} size={"icon"} onClick={deleteHandler}>
            <XIcon className='size-4' />
          </Button>
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
