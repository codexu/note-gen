import { TooltipButton } from "@/components/tooltip-button"
import { Chat } from "@/db/chats"
import { Volume2, VolumeX, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { textToSpeechAndPlay, stopCurrentAudio } from "@/lib/audio"
import useSettingStore from "@/stores/setting"

interface ReadAloudControlProps {
  chat: Chat
  translatedContent?: string
}

export function ReadAloudControl({ chat, translatedContent }: ReadAloudControlProps) {
  const t = useTranslations()
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  // 处理朗读/停止
  async function handleTextToSpeech() {
    // 如果正在播放，则停止播放
    if (isPlaying) {
      stopCurrentAudio()
      setIsPlaying(false)
      setIsLoading(false)
      return
    }
    
    // 如果正在加载或没有内容，则返回
    if (!chat.content || isLoading) return
    
    setIsLoading(true)
    
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
      
      // 获取当前音频模型的speed配置
      const { aiModelList, audioModel } = useSettingStore.getState()
      const audioConfig = aiModelList.find(config => config.key === audioModel)
      const speed = audioConfig?.speed
      
      // 调用新的音频API，传入voice、speed和状态回调
      await textToSpeechAndPlay(textToRead, undefined, speed, (playing: boolean) => {
        setIsPlaying(playing)
        if (playing) {
          setIsLoading(false) // 开始播放时清除loading状态
        }
      })
    } catch (error) {
      console.error('朗读失败:', error)
      // 可以在这里添加错误提示
    } finally {
      setIsLoading(false)
      setIsPlaying(false)
    }
  }

  if (chat.type !== 'chat') {
    return null
  }

  return (
    <>
      <TooltipButton
        icon={
          isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )
        }
        tooltipText={
          isLoading ? t('record.chat.messageControl.loading') : 
          isPlaying ? t('record.chat.messageControl.stop') : 
          t('record.chat.messageControl.readAloud')
        }
        onClick={handleTextToSpeech}
        variant="ghost"
        size="sm"
        disabled={isLoading}
      />
    </>
  )
}
