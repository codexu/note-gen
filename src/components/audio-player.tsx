'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs'

interface AudioPlayerProps {
  audioPath: string
}

export function AudioPlayer({ audioPath }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioSrc, setAudioSrc] = useState<string>('')
  const [isReady, setIsReady] = useState(false)

  // 加载音频文件
  useEffect(() => {
    let blobUrl: string | null = null
    
    const loadAudio = async () => {
      try {
        // 读取音频文件
        const fileData = await readFile(audioPath, { baseDir: BaseDirectory.AppData })
        
        // 根据文件扩展名确定 MIME 类型
        const extension = audioPath.split('.').pop()?.toLowerCase()
        const mimeType = extension === 'mp4' ? 'audio/mp4' :
                        extension === 'webm' ? 'audio/webm' :
                        extension === 'ogg' ? 'audio/ogg' :
                        extension === 'wav' ? 'audio/wav' :
                        extension === 'm4a' ? 'audio/mp4' :
                        extension === 'mp3' ? 'audio/mpeg' :
                        'audio/webm'
        
        console.log('加载音频:', audioPath, '类型:', mimeType)
        
        // 创建 Blob URL
        const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
        const blob = new Blob([buffer], { type: mimeType })
        blobUrl = URL.createObjectURL(blob)
        
        setAudioSrc(blobUrl)
      } catch (error) {
        console.error('加载音频失败:', error, '路径:', audioPath)
      }
    }
    
    loadAudio()
    
    // 清理函数
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [audioPath])


  // 播放/暂停
  const togglePlay = async () => {
    if (!audioRef.current || !isReady) return
    
    try {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        await audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    } catch (error) {
      console.error('播放失败:', error)
      setIsPlaying(false)
    }
  }

  // 进度调整
  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return
    const newTime = value[0]
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  // 格式化时间
  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) {
      return '0:00'
    }
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // 如果音频源未加载，显示加载提示
  if (!audioSrc) {
    return (
      <div className="w-full py-1 px-2 bg-muted/30 rounded text-center text-xs text-muted-foreground">
        加载音频中...
      </div>
    )
  }

  return (
    <div className="w-full flex items-center gap-1.5 py-1 pl-2 bg-muted/30 rounded">
      {/* 音频元素 */}
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const duration = e.currentTarget.duration
          console.log('音频元数据已加载, 时长:', duration)
          setDuration(duration)
          setIsReady(true)
        }}
        onCanPlay={() => {
          console.log('音频可以播放了')
          setIsReady(true)
        }}
        onEnded={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={(e) => {
          console.error('音频加载错误:', e.currentTarget.error)
          setIsReady(false)
        }}
        onLoadStart={() => console.log('开始加载音频')}
        onLoadedData={() => console.log('音频数据已加载')}
      />

      {/* 播放/暂停按钮 */}
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlay}
        disabled={!isReady}
        className="size-3 shrink-0"
      >
        {isPlaying ? (
          <Pause className="size-3" />
        ) : (
          <Play className="size-3" />
        )}
      </Button>

      {/* 当前时间 */}
      <span className="text-xs text-muted-foreground shrink-0 w-9 text-right">
        {formatTime(currentTime)}
      </span>

      {/* 进度条 */}
      <Slider
        value={[currentTime]}
        max={duration || 100}
        step={0.1}
        onValueChange={handleSeek}
        className="flex-1 cursor-pointer"
      />

      {/* 总时长 */}
      <span className="text-xs text-muted-foreground shrink-0 w-9">
        {formatTime(duration)}
      </span>
    </div>
  )
}
