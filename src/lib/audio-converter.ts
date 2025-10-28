/**
 * 将音频 Blob 转换为 WAV 格式
 */
export async function convertToWav(audioBlob: Blob): Promise<Blob> {
  try {
    // 创建 Audio Context
    const audioContext = new AudioContext()
    
    // 读取音频数据
    const arrayBuffer = await audioBlob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    
    // 转换为 WAV
    const wavBlob = audioBufferToWav(audioBuffer)
    
    // 关闭 Audio Context
    audioContext.close()
    
    return wavBlob
  } catch (error) {
    console.error('音频转换失败:', error)
    // 如果转换失败，返回原始 Blob
    return audioBlob
  }
}

/**
 * 将 AudioBuffer 转换为 WAV Blob
 */
function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numberOfChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16
  
  let result
  if (numberOfChannels === 2) {
    result = interleave(
      audioBuffer.getChannelData(0),
      audioBuffer.getChannelData(1)
    )
  } else {
    result = audioBuffer.getChannelData(0)
  }
  
  const buffer = new ArrayBuffer(44 + result.length * 2)
  const view = new DataView(buffer)
  
  // WAV 文件头
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + result.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numberOfChannels * bitDepth / 8, true)
  view.setUint16(32, numberOfChannels * bitDepth / 8, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, result.length * 2, true)
  
  // 写入音频数据
  floatTo16BitPCM(view, 44, result)
  
  return new Blob([buffer], { type: 'audio/wav' })
}

function interleave(leftChannel: Float32Array, rightChannel: Float32Array): Float32Array {
  const length = leftChannel.length + rightChannel.length
  const result = new Float32Array(length)
  
  let inputIndex = 0
  for (let i = 0; i < length;) {
    result[i++] = leftChannel[inputIndex]
    result[i++] = rightChannel[inputIndex]
    inputIndex++
  }
  return result
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
}
