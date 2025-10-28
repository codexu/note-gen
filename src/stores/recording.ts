import { create } from 'zustand'

interface RecordingState {
  // 录音状态
  isRecording: boolean
  isPaused: boolean
  recordingDuration: number // 录音时长（秒）
  
  // 录音数据
  audioChunks: Blob[]
  mediaRecorder: MediaRecorder | null
  
  // 控制方法
  startRecording: () => Promise<void>
  pauseRecording: () => void
  resumeRecording: () => void
  stopRecording: () => Promise<Blob | null>
  cancelRecording: () => void
  
  // 内部方法
  setRecordingDuration: (duration: number) => void
  resetState: () => void
}

const useRecordingStore = create<RecordingState>((set, get) => ({
  isRecording: false,
  isPaused: false,
  recordingDuration: 0,
  audioChunks: [],
  mediaRecorder: null,

  setRecordingDuration: (duration) => set({ recordingDuration: duration }),

  startRecording: async () => {
    try {
      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      // 优先尝试更兼容的格式
      let mimeType = 'audio/webm'
      const supportedTypes = [
        'audio/wav',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm'
      ]
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          break
        }
      }
      
      console.log('使用音频格式:', mimeType)
      
      // 创建MediaRecorder实例
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      
      const chunks: Blob[] = []
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      
      mediaRecorder.onstop = () => {
        // 停止所有音频轨道
        stream.getTracks().forEach(track => track.stop())
      }
      
      mediaRecorder.start()
      
      set({
        isRecording: true,
        isPaused: false,
        audioChunks: chunks,
        mediaRecorder,
        recordingDuration: 0
      })
      
      // 启动计时器
      const timerId = setInterval(() => {
        const state = get()
        if (state.isRecording && !state.isPaused) {
          set({ recordingDuration: state.recordingDuration + 1 })
        } else {
          clearInterval(timerId)
        }
      }, 1000)
      
    } catch (error) {
      console.error('启动录音失败:', error)
      
      // 根据错误类型提供更具体的错误信息
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          throw new Error('麦克风权限被拒绝，请在系统设置中允许 NoteGen 访问麦克风')
        } else if (error.name === 'NotFoundError') {
          throw new Error('未检测到麦克风设备，请连接麦克风后重试')
        } else if (error.name === 'NotReadableError') {
          throw new Error('麦克风正在被其他应用使用，请关闭其他应用后重试')
        }
      }
      
      throw new Error('无法启动录音，请检查麦克风设备和权限设置')
    }
  },

  pauseRecording: () => {
    const { mediaRecorder } = get()
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause()
      set({ isPaused: true })
    }
  },

  resumeRecording: () => {
    const { mediaRecorder } = get()
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume()
      set({ isPaused: false })
    }
  },

  stopRecording: async (): Promise<Blob | null> => {
    const { mediaRecorder, audioChunks } = get()
    
    if (!mediaRecorder) {
      return null
    }
    
    return new Promise((resolve) => {
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
        get().resetState()
        resolve(audioBlob)
      }
      
      mediaRecorder.stop()
    })
  },

  cancelRecording: () => {
    const { mediaRecorder } = get()
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }
    
    get().resetState()
  },

  resetState: () => {
    set({
      isRecording: false,
      isPaused: false,
      recordingDuration: 0,
      audioChunks: [],
      mediaRecorder: null
    })
  }
}))

export default useRecordingStore
