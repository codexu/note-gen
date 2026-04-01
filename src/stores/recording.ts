import { create } from 'zustand'

interface RecordingState {
  // 录音状态
  isRecording: boolean
  isPaused: boolean
  recordingDuration: number // 录音时长（秒）

  // 录音数据
  audioChunks: Blob[]
  mediaRecorder: MediaRecorder | null

  // 计时器
  timerId?: NodeJS.Timeout

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
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前环境不支持麦克风录音，请检查 Android WebView 或应用权限配置')
      }

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
      
      // 启动计时器，保存到 state
      const timerId = setInterval(() => {
        const state = get()
        if (state.isRecording && !state.isPaused) {
          set({ recordingDuration: state.recordingDuration + 1 })
        } else {
          // 暂停时清除计时器
          clearInterval(state.timerId)
          set({ timerId: undefined })
        }
      }, 1000)

      set({
        isRecording: true,
        isPaused: false,
        audioChunks: chunks,
        mediaRecorder,
        recordingDuration: 0,
        timerId
      })
      
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
    const { mediaRecorder, timerId } = get()
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause()
      // 暂停时清除计时器
      if (timerId) {
        clearInterval(timerId)
      }
      set({ isPaused: true, timerId: undefined })
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
    const { mediaRecorder, audioChunks, timerId } = get()

    // 停止时清除计时器
    if (timerId) {
      clearInterval(timerId)
    }

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
    const { timerId } = get()
    // 重置时清除计时器
    if (timerId) {
      clearInterval(timerId)
    }
    set({
      isRecording: false,
      isPaused: false,
      recordingDuration: 0,
      audioChunks: [],
      mediaRecorder: null,
      timerId: undefined
    })
  }
}))

export default useRecordingStore
