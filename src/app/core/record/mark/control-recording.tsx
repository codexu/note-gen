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
import { readFile, writeFile, BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs'
import { useRef } from 'react'
import { isMobileDevice } from '@/lib/check'
import { convertToWav } from '@/lib/audio-converter'

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
      const audioBlob = await stopRecording()
      if (!audioBlob) {
        throw new Error(t('recording.noAudioData'))
      }
      
      console.log('原始录音格式:', audioBlob.type, '大小:', audioBlob.size)
      
      // 转换为 WAV 格式
      const wavBlob = await convertToWav(audioBlob)
      console.log('转换后格式:', wavBlob.type, '大小:', wavBlob.size)
      
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
    
    console.log('保存音频文件:', filename, 'Blob类型:', audioBlob.type, 'Blob大小:', audioBlob.size)
    
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
  const processTranscription = async (audioBlob: Blob, queueId: string) => {
    let audioPath = ''
    try {
      // 先验证 Blob 是否有效
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('音频数据为空')
      }
      
      console.log('音频 Blob 大小:', audioBlob.size, '类型:', audioBlob.type)
      
      // 保存音频文件
      audioPath = await saveAudioFile(audioBlob)
      console.log('音频文件已保存:', audioPath)
      
      // 调用STT API识别
      let transcription = ''
      try {
        transcription = await fetchAudioTranscription(audioBlob)
      } catch (error) {
        console.error('STT识别出错:', error)
      }
      
      // 无论是否识别成功，都保存记录
      const noContent = !transcription || !transcription.trim()
      const displayContent = noContent ? t('recording.noContentDetected') : transcription
      
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
      
      // 显示提示
      if (noContent) {
        toast({
          title: t('recording.success'),
          description: t('recording.noContentDetected'),
          variant: 'default'
        })
      } else {
        toast({
          title: t('recording.success'),
          description: t('recording.transcriptionSuccess')
        })
      }
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
      
      console.log('选择的文件:', filePath, 'MIME类型:', mimeType)

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
      console.log('移动端选择的文件:', file.name, 'MIME类型:', file.type, '大小:', file.size)
      
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
