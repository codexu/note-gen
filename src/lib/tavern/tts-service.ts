/**
 * Tavern TTS 服务
 * 封装 NoteGen 的 TTS 功能用于角色对话朗读
 */

import { useTavernTTSStore, TavernTTSConfig } from '@/stores/tavern-tts'
import {
  textToSpeechAndPlay,
  stopCurrentAudio,
  getCurrentAudioPlayingState,
  speakWithSystemVoice,
  stopSystemVoice,
} from '@/lib/audio'

// 预处理文本，移除不需要朗读的内容
export function preprocessTextForTTS(
  text: string,
  config: TavernTTSConfig
): string {
  let processed = text

  // 移除代码块
  if (config.skipCodeBlocks) {
    // 移除多行代码块
    processed = processed.replace(/```[\s\S]*?```/g, '')
    // 移除单行代码
    processed = processed.replace(/`[^`]+`/g, '')
  }

  // 移除表情符号
  if (config.skipEmoji) {
    processed = processed.replace(
      /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
      ''
    )
  }

  // 移除 Markdown 格式
  processed = processed
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 粗体
    .replace(/\*([^*]+)\*/g, '$1')     // 斜体
    .replace(/__([^_]+)__/g, '$1')     // 粗体
    .replace(/_([^_]+)_/g, '$1')       // 斜体
    .replace(/~~([^~]+)~~/g, '$1')     // 删除线
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
    .replace(/^#+\s*/gm, '')           // 标题
    .replace(/^[-*]\s+/gm, '')         // 列表
    .replace(/^\d+\.\s+/gm, '')        // 有序列表

  // 清理多余空白
  processed = processed
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return processed
}

// 分段文本
export function splitTextIntoChunks(
  text: string,
  chunkSize: number
): string[] {
  if (chunkSize <= 0) {
    return [text]
  }

  const chunks: string[] = []
  const sentences = text.split(/(?<=[。！？.!?])\s*/)

  let currentChunk = ''

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim())
      currentChunk = sentence
    } else {
      currentChunk += sentence
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks.length > 0 ? chunks : [text]
}

// 播放消息
export async function playMessage(
  text: string,
  config: TavernTTSConfig,
  messageId?: number,
  onPlayingChange?: (playing: boolean) => void
): Promise<void> {
  const { setPlaying } = useTavernTTSStore.getState()

  // 预处理文本
  const processedText = preprocessTextForTTS(text, config)

  if (!processedText.trim()) {
    throw new Error('没有可朗读的内容')
  }

  // 设置播放状态
  setPlaying(true, messageId)
  onPlayingChange?.(true)

  try {
    if (config.useSystemVoice) {
      // 使用系统语音
      await new Promise<void>((resolve, reject) => {
        try {
          speakWithSystemVoice(
            processedText,
            config.speed,
            () => {
              // 开始播放
            },
            () => {
              // 结束播放
              resolve()
            }
          )
        } catch (error) {
          reject(error)
        }
      })
    } else {
      // 使用 AI TTS
      const chunks = splitTextIntoChunks(processedText, config.chunkSize)

      for (const chunk of chunks) {
        // 检查是否被停止
        if (!useTavernTTSStore.getState().isPlaying) {
          break
        }

        await textToSpeechAndPlay(
          chunk,
          config.voice,
          config.speed,
          (playing) => {
            if (!playing && chunks.indexOf(chunk) === chunks.length - 1) {
              // 最后一段播放完成
              setPlaying(false)
              onPlayingChange?.(false)
            }
          }
        )
      }
    }
  } catch (error) {
    console.error('TTS 播放失败:', error)
    throw error
  } finally {
    setPlaying(false)
    onPlayingChange?.(false)
  }
}

// 停止播放
export function stopPlayback(): void {
  const { setPlaying } = useTavernTTSStore.getState()
  
  stopCurrentAudio()
  stopSystemVoice()
  setPlaying(false)
}

// 检查是否正在播放
export function isCurrentlyPlaying(): boolean {
  return useTavernTTSStore.getState().isPlaying || getCurrentAudioPlayingState()
}

// 检查特定消息是否正在播放
export function isMessagePlaying(messageId: number): boolean {
  const { isPlaying, currentMessageId } = useTavernTTSStore.getState()
  return isPlaying && currentMessageId === messageId
}
