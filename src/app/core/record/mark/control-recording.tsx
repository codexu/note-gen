import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import useSettingStore from "@/stores/setting"
import useRecordingStore from "@/stores/recording"
import { Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { fetchAudioTranscription } from '@/lib/audio'
import { useRouter } from 'next/navigation'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { useRef } from 'react'
import { isMobileDevice } from '@/lib/check'

export function ControlRecording() {
  const t = useTranslations();
  const router = useRouter();
  const { sttModel } = useSettingStore();
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileDevice();

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, removeQueue } = useMarkStore()
  
  // 大模型录音
  const {
    isRecording,
    recordingDuration,
    startRecording,
    stopRecording
  } = useRecordingStore()

  // 格式化录音时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // 开始录音
  const handleStart = async () => {
    // 检查是否配置了STT模型
    if (!sttModel) {
      toast({
        title: t('recording.error'),
        description: t('recording.noModelConfigured'),
        variant: 'destructive'
      })
      // 根据平台跳转到对应的设置页面
      const settingPath = isMobile ? '/mobile/setting/pages/audio' : '/core/setting/audio'
      router.push(settingPath)
      return
    }
    
    try {
      await startRecording()
    } catch (error) {
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.startError'),
        variant: 'destructive'
      })
    }
  }
  
  // 停止录音
  const handleStop = async () => {
    try {
      // 停止录音
      const audioBlob = await stopRecording()
      
      if (!audioBlob) {
        throw new Error(t('recording.noAudioData'))
      }
      
      // 创建队列ID
      const queueId = `recording-${Date.now()}`
      
      // 添加到队列中显示识别中的状态
      addQueue({
        queueId,
        tagId: currentTagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })
      
      // 后台异步识别
      processTranscription(audioBlob, queueId)
      
    } catch (error) {
      console.error('停止录音失败:', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.startError'),
        variant: 'destructive'
      })
    }
  }
  
  // 后台处理识别
  const processTranscription = async (audioBlob: Blob, queueId: string) => {
    try {
      // 调用STT API识别
      const transcription = await fetchAudioTranscription(audioBlob)
      
      if (!transcription || !transcription.trim()) {
        throw new Error(t('recording.transcriptionEmpty'))
      }
      
      // 保存识别结果
      await insertMark({
        tagId: currentTagId,
        type: 'recording',
        desc: transcription.substring(0, 100),
        content: transcription
      })
      
      // 移除队列
      removeQueue(queueId)
      
      // 刷新列表
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
      
      toast({
        title: t('recording.success'),
        description: t('recording.transcriptionSuccess')
      })
    } catch (error) {
      console.error('识别失败:', error)
      
      // 移除队列
      removeQueue(queueId)
      
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.transcriptionError'),
        variant: 'destructive'
      })
    }
  }
  
  // 选择音频文件并识别
  const handleFileSelect = async () => {
    try {
      // 检查是否配置了STT模型
      if (!sttModel) {
        toast({
          title: t('recording.error'),
          description: t('recording.noModelConfigured'),
          variant: 'destructive'
        })
        // 根据平台跳转到对应的设置页面
        const settingPath = isMobile ? '/mobile/setting/pages/audio' : '/core/setting/audio'
        router.push(settingPath)
        return
      }

      // 移动端使用 HTML5 file input
      if (isMobile) {
        fileInputRef.current?.click()
        return
      }

      // PC端使用 Tauri dialog
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Audio',
          extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma', 'webm']
        }]
      })

      if (!selected) return

      // 读取文件
      const fileData = await readFile(selected as string)
      // 将 Uint8Array 转换为 ArrayBuffer
      const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
      const audioBlob = new Blob([buffer], { type: 'audio/mpeg' })

      // 创建队列ID
      const queueId = `recording-${Date.now()}`
      
      // 添加到队列中显示识别中的状态
      addQueue({
        queueId,
        tagId: currentTagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })
      
      // 后台异步识别
      processTranscription(audioBlob, queueId)
      
    } catch (error) {
      console.error('文件选择失败:', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : '文件选择失败',
        variant: 'destructive'
      })
    }
  }
  
  // 处理移动端文件选择
  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      // 创建队列ID
      const queueId = `recording-${Date.now()}`
      
      // 添加到队列中显示识别中的状态
      addQueue({
        queueId,
        tagId: currentTagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })
      
      // 后台异步识别
      processTranscription(file, queueId)
      
      // 重置 input
      event.target.value = ''
    } catch (error) {
      console.error('文件处理失败:', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : '文件处理失败',
        variant: 'destructive'
      })
    }
  }

  // 长按开始
  const handleMouseDown = () => {
    if (isRecording) return
    
    isLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true
      handleFileSelect()
    }, 500) // 500ms 判定为长按
  }

  // 长按结束
  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    // 如果不是长按，执行正常点击
    if (!isLongPress.current) {
      handleClick()
    }
  }

  // 点击按钮处理
  const handleClick = () => {
    if (isRecording) {
      handleStop()
    } else {
      handleStart()
    }
  }
  
  // 生成tooltip文本
  const getTooltipText = () => {
    if (isRecording) {
      return `${t('recording.recording')} ${formatDuration(recordingDuration)}`
    }
    return t('record.mark.type.recording')
  }

  return (
    <>
      {/* 移动端文件选择 */}
      {isMobile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.wma,.webm"
          onChange={handleFileInputChange}
          className="hidden"
        />
      )}
      
      <Tooltip>
        <TooltipTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current)
              longPressTimer.current = null
            }
          }}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          className={`relative ${isRecording ? 'text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950' : ''}`}
        >
          <Mic className="size-4" />
          {isRecording && (
            <span className="absolute top-1 right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{getTooltipText()}</p>
      </TooltipContent>
      </Tooltip>
    </>
  )
}
