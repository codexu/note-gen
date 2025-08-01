import useSettingStore from '@/stores/setting'

export interface AudioSpeechRequest {
  model: string
  input: string
  voice?: string
  speed?: number
}

export interface AudioSpeechResponse {
  audio: ArrayBuffer
}

/**
 * 调用音频AI模型接口生成语音
 */
export async function fetchAudioSpeech(text: string, customVoice?: string, customSpeed?: number): Promise<ArrayBuffer> {
  const { aiModelList, audioModel } = useSettingStore.getState()
  
  if (!audioModel) {
    throw new Error('未配置音频模型')
  }

  // 查找音频模型配置
  const audioConfig = aiModelList.find(config => config.key === audioModel)
  if (!audioConfig) {
    throw new Error('未找到音频模型配置')
  }

  if (!audioConfig.baseURL || !audioConfig.apiKey) {
    throw new Error('音频模型配置不完整')
  }

  // 使用自定义voice或配置的voice，默认为alloy
  const voice = customVoice || audioConfig.voice || 'alloy'
  // 使用自定义speed或配置的speed，默认为1
  const speed = customSpeed !== undefined ? customSpeed : (audioConfig.speed !== undefined ? audioConfig.speed : 1)

  const requestBody: AudioSpeechRequest = {
    model: audioConfig.model || 'tts-1',
    input: text,
    voice: voice,
    speed: speed
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${audioConfig.apiKey}`
  }

  // 添加自定义头部
  if (audioConfig.customHeaders) {
    Object.assign(headers, audioConfig.customHeaders)
  }

  try {
    const response = await fetch(`${audioConfig.baseURL}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`音频生成失败: ${response.status} ${errorText}`)
    }

    return await response.arrayBuffer()
  } catch (error) {
    console.error('音频生成错误:', error)
    throw error
  }
}

// 全局音频控制器
let currentAudioController: AudioController | null = null

/**
 * 音频控制器类，支持播放和停止
 */
class AudioController {
  private audioContext: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private isPlaying = false
  private onPlayingChange?: (playing: boolean) => void

  constructor(onPlayingChange?: (playing: boolean) => void) {
    this.onPlayingChange = onPlayingChange
  }

  /**
   * 播放音频数据
   */
  async playAudioBuffer(audioBuffer: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 如果已经在播放，先停止
        this.stop()

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        
        this.audioContext.decodeAudioData(
          audioBuffer.slice(0), // 创建副本避免detached buffer问题
          (decodedData) => {
            if (!this.audioContext) {
              reject(new Error('音频上下文已被销毁'))
              return
            }

            this.source = this.audioContext.createBufferSource()
            this.source.buffer = decodedData
            this.source.connect(this.audioContext.destination)
            
            this.source.onended = () => {
              this.cleanup()
              this.onPlayingChange?.(false)
              resolve()
            }
            
            this.isPlaying = true
            this.onPlayingChange?.(true)
            this.source.start(0)
          },
          (error) => {
            this.cleanup()
            reject(new Error(`音频解码失败: ${error}`))
          }
        )
      } catch (error) {
        this.cleanup()
        reject(new Error(`音频播放失败: ${error}`))
      }
    })
  }

  /**
   * 停止播放
   */
  stop(): void {
    if (this.source && this.isPlaying) {
      try {
        this.source.stop()
      } catch {
        // 忽略已经停止的错误
      }
    }
    this.cleanup()
    this.onPlayingChange?.(false)
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.isPlaying = false
    this.source = null
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }

  /**
   * 获取播放状态
   */
  getIsPlaying(): boolean {
    return this.isPlaying
  }
}

/**
 * 播放音频数据（向后兼容）
 */
export function playAudioBuffer(audioBuffer: ArrayBuffer): Promise<void> {
  const controller = new AudioController()
  return controller.playAudioBuffer(audioBuffer)
}

/**
 * 文本转语音并播放（支持状态回调）
 */
export async function textToSpeechAndPlay(
  text: string, 
  customVoice?: string,
  customSpeed?: number,
  onPlayingChange?: (playing: boolean) => void
): Promise<void> {
  if (!text.trim()) {
    throw new Error('文本内容为空')
  }

  try {
    // 停止当前播放
    stopCurrentAudio()
    
    const audioBuffer = await fetchAudioSpeech(text, customVoice, customSpeed)
    
    // 创建新的音频控制器
    currentAudioController = new AudioController(onPlayingChange)
    await currentAudioController.playAudioBuffer(audioBuffer)
  } catch (error) {
    console.error('朗读失败:', error)
    onPlayingChange?.(false)
    throw error
  }
}

/**
 * 停止当前播放的音频
 */
export function stopCurrentAudio(): void {
  if (currentAudioController) {
    currentAudioController.stop()
    currentAudioController = null
  }
}

/**
 * 获取当前音频播放状态
 */
export function getCurrentAudioPlayingState(): boolean {
  return currentAudioController?.getIsPlaying() ?? false
}
