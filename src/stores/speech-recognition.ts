import { create } from 'zustand'

// 浏览器语音识别 API 类型定义
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onerror: ((event: any) => void) | null
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition
    webkitSpeechRecognition: new () => SpeechRecognition
  }
}

interface SpeechRecognitionState {
  // 识别状态
  isRecognizing: boolean
  transcript: string // 识别的文本
  interimTranscript: string // 临时文本（实时）
  lastError: string | null // 最后的错误类型
  
  // 识别实例
  recognition: SpeechRecognition | null
  
  // 控制方法
  startRecognition: (language?: string) => Promise<void>
  stopRecognition: () => void
  
  // 内部方法
  resetState: () => void
  
  // 检查浏览器支持
  isSupported: () => boolean
}

const useSpeechRecognitionStore = create<SpeechRecognitionState>((set, get) => ({
  isRecognizing: false,
  transcript: '',
  interimTranscript: '',
  lastError: null,
  recognition: null,

  isSupported: () => {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  },

  startRecognition: async (language = 'zh-CN') => {
    try {
      // 检查浏览器支持
      if (!get().isSupported()) {
        throw new Error('当前浏览器不支持语音识别功能，请使用 Chrome、Edge 或 Safari')
      }

      // 创建识别实例
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognition = new SpeechRecognitionAPI()

      // 配置识别选项
      recognition.continuous = true // 持续识别
      recognition.interimResults = true // 实时结果
      recognition.lang = language // 语言设置
      recognition.maxAlternatives = 1 // 最多返回1个结果

      // 识别结果处理
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = ''
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const transcript = result[0].transcript

          if (result.isFinal) {
            finalTranscript += transcript
          } else {
            interimTranscript += transcript
          }
        }

        set({
          transcript: get().transcript + finalTranscript,
          interimTranscript
        })
      }

      // 错误处理
      recognition.onerror = (event: any) => {
        console.error('语音识别错误:', event.error, event)
        
        // 重置状态
        get().resetState()
        
        // 记录错误类型，供外部判断
        set({ 
          isRecognizing: false,
          lastError: event.error 
        })
      }

      // 识别结束处理
      recognition.onend = () => {
        set({ isRecognizing: false })
      }

      // 开始识别
      try {
        recognition.start()
        
        set({
          recognition,
          isRecognizing: true,
          transcript: '',
          interimTranscript: ''
        })
      } catch (startError) {
        console.error('启动识别失败:', startError)
        throw startError
      }

    } catch (error) {
      console.error('启动语音识别失败:', error)
      throw error
    }
  },

  stopRecognition: () => {
    const { recognition } = get()
    
    if (recognition) {
      recognition.stop()
    }
    
    set({
      isRecognizing: false,
      interimTranscript: ''
    })
  },

  resetState: () => {
    const { recognition } = get()
    
    if (recognition) {
      recognition.abort()
    }
    
    set({
      isRecognizing: false,
      transcript: '',
      interimTranscript: '',
      recognition: null
    })
  }
}))

export default useSpeechRecognitionStore
