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
import { transcribeRecording } from '@/lib/audio'
import { useRouter } from 'next/navigation'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile, BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs'
import { useRef } from 'react'
import { isMobileDevice } from '@/lib/check'
import { convertToWav } from '@/lib/audio-converter'
import { useEffect } from 'react'
import emitter from '@/lib/emitter'
import { handleRecordComplete } from '@/lib/record-navigation'
import { getTranscriptionFallbackMessage } from '@/lib/speech/transcription-fallback.ts'

export function ControlRecording() {
  const t = useTranslations();
  const router = useRouter();
  const { sttModel } = useSettingStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileDevice();
  const lastClickTime = useRef<number>(0);
  const clickTimer = useRef<NodeJS.Timeout | null>(null);

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, removeQueue } = useMarkStore()
  
  // 大模型录音
  const {
    isRecording,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useRecordingStore()
  
  // 监听快捷键
  useEffect(() => {
    const handleToggleRecording = () => {
      if (isRecording) {
        handleStop()
      } else {
        handleStart()
      }
    }
    
    emitter.on('toolbar-shortcut-recording', handleToggleRecording)
    return () => {
      emitter.off('toolbar-shortcut-recording', handleToggleRecording)
    }
  }, [isRecording])

  // 格式化录音时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // 开始录音
  const handleStart = async () => {
    try {
      await startRecording()
      
      // 记录完成后的导航处理（桌面端切换tab，移动端跳转页面）
      handleRecordComplete(router)
    } catch (error) {
      cancelRecording()
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
      const audioBlob = await stopRecording()
      if (!audioBlob) {
        throw new Error(t('recording.noAudioData'))
      }
      
      // 转换为 WAV 格式
      const wavBlob = await convertToWav(audioBlob)
      
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
      
      // 后台异步识别（使用转换后的 WAV）
      processTranscription(wavBlob, queueId)
      
    } catch (error) {
      console.error('停止录音失败:', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.startError'),
        variant: 'destructive'
      })
    }
  }
  
  // 保存音频文件到本地
  const saveAudioFile = async (audioBlob: Blob): Promise<string> => {
    const timestamp = Date.now()
    // 根据 MIME 类型确定文件扩展名
    const extension = audioBlob.type.includes('wav') ? 'wav' :
                      audioBlob.type.includes('mpeg') || audioBlob.type.includes('mp3') ? 'mp3' :
                      audioBlob.type.includes('mp4') || audioBlob.type.includes('m4a') ? 'mp4' : 
                      audioBlob.type.includes('webm') ? 'webm' : 
                      audioBlob.type.includes('ogg') ? 'ogg' :
                      audioBlob.type.includes('flac') ? 'flac' :
                      audioBlob.type.includes('aac') ? 'aac' : 'webm'
    const filename = `recording_${timestamp}.${extension}`
    const audioDir = 'recordings'
    
    // 确保目录存在
    const dirExists = await exists(audioDir, { baseDir: BaseDirectory.AppData })
    if (!dirExists) {
      await mkdir(audioDir, { baseDir: BaseDirectory.AppData, recursive: true })
    }
    
    // 将 Blob 转换为 ArrayBuffer
    const arrayBuffer = await audioBlob.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // 保存文件
    const filePath = `${audioDir}/${filename}`
    await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })
    
    return filePath
  }
  
  // 后台处理识别
  const processTranscription = async (
    audioBlob: Blob,
    queueId: string,
  ) => {
    let audioPath = ''
    try {
      // 先验证 Blob 是否有效
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('音频数据为空')
      }
      
      // 保存音频文件
      audioPath = await saveAudioFile(audioBlob)
      
      // 调用STT API识别
      let transcription = ''
      try {
        transcription = await transcribeRecording(audioBlob)
      } catch (error) {
        console.error('STT识别出错:', error)
      }
      
      // 无论是否识别成功，都保存记录
      const noContent = !transcription || !transcription.trim()
      const fallbackMessage = getTranscriptionFallbackMessage(sttModel)
      const displayContent = noContent ? (fallbackMessage || t('recording.noContentDetected')) : transcription
      
      await insertMark({
        tagId: currentTagId,
        type: 'recording',
        desc: displayContent.substring(0, 100),
        content: displayContent,
        url: audioPath  // 保存音频文件路径
      })
      
      // 移除队列
      removeQueue(queueId)
      
      // 刷新列表
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
      
      // 录制结束后不再显示提示
    } catch (error) {
      console.error('识别失败:', error)
      
      // 移除队列
      removeQueue(queueId)
      
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.transcriptionError'),
        variant: 'destructive'
      })
    } finally {
    }
  }
  
  // 选择音频文件并识别
  const handleFileSelect = async () => {
    try {
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
      const filePath = selected as string
      const fileData = await readFile(filePath)
      
      // 根据文件扩展名确定 MIME 类型
      const extension = filePath.split('.').pop()?.toLowerCase()
      const mimeType = extension === 'wav' ? 'audio/wav' :
                      extension === 'mp3' ? 'audio/mpeg' :
                      extension === 'm4a' ? 'audio/mp4' :
                      extension === 'mp4' ? 'audio/mp4' :
                      extension === 'ogg' ? 'audio/ogg' :
                      extension === 'webm' ? 'audio/webm' :
                      'audio/mpeg'
      
      // 将 Uint8Array 转换为 ArrayBuffer
      const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
      const audioBlob = new Blob([buffer], { type: mimeType })

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
      
      // 后台异步识别（File 对象就是 Blob，直接传递）
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

  // 处理点击事件（单击录音，双击选择文件）
  const handleClick = () => {
    const now = Date.now()
    const timeSinceLastClick = now - lastClickTime.current
    
    // 双击判定：300ms内的第二次点击
    if (timeSinceLastClick < 300 && timeSinceLastClick > 0) {
      // 双击：取消单击的延迟执行，直接选择文件
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
        clickTimer.current = null
      }
      lastClickTime.current = 0 // 重置，避免三连击
      handleFileSelect()
    } else {
      // 单击：延迟执行，等待可能的第二次点击
      lastClickTime.current = now
      
      // 清除之前的定时器
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
      }
      
      // 延迟300ms执行单击操作，如果期间有第二次点击则会被取消
      clickTimer.current = setTimeout(() => {
        if (isRecording) {
          handleStop()
        } else {
          handleStart()
        }
        clickTimer.current = null
      }, 300)
    }
  }
  
  // 生成tooltip文本
  const getTooltipText = () => {
    if (isRecording) {
      return `${t('recording.recording')} ${formatDuration(recordingDuration)}`
    }
    return `${t('record.mark.type.recording')} (${t('recording.doubleClickToSelectFile')})`
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
          onClick={handleClick}
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
