import useSettingStore from '@/stores/setting'

export interface AudioSpeechRequest {
  model: string
  input: string
  voice?: string
}

export interface AudioSpeechResponse {
  audio: ArrayBuffer
}

/**
 * 调用音频AI模型接口生成语音
 */
export async function fetchAudioSpeech(text: string, customVoice?: string): Promise<ArrayBuffer> {
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

  const requestBody: AudioSpeechRequest = {
    model: audioConfig.model || 'tts-1',
    input: text,
    voice: voice
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

/**
 * 播放音频数据
 */
export function playAudioBuffer(audioBuffer: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      audioContext.decodeAudioData(
        audioBuffer.slice(0), // 创建副本避免detached buffer问题
        (decodedData) => {
          const source = audioContext.createBufferSource()
          source.buffer = decodedData
          source.connect(audioContext.destination)
          
          source.onended = () => {
            audioContext.close()
            resolve()
          }
          
          source.start(0)
        },
        (error) => {
          audioContext.close()
          reject(new Error(`音频解码失败: ${error}`))
        }
      )
    } catch (error) {
      reject(new Error(`音频播放失败: ${error}`))
    }
  })
}

/**
 * 文本转语音并播放
 */
export async function textToSpeechAndPlay(text: string, customVoice?: string): Promise<void> {
  if (!text.trim()) {
    throw new Error('文本内容为空')
  }

  try {
    const audioBuffer = await fetchAudioSpeech(text, customVoice)
    await playAudioBuffer(audioBuffer)
  } catch (error) {
    console.error('朗读失败:', error)
    throw error
  }
}
