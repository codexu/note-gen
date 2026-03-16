export type SpeechTask = 'tts' | 'stt'

export type SpeechMode = 'auto' | 'local' | 'model'

export type SpeechEngine = 'local' | 'model'

export interface SpeechCapabilities {
  localTtsAvailable: boolean
  localSttAvailable: boolean
  modelTtsAvailable: boolean
  modelSttAvailable: boolean
}

export interface SpeechCapabilityInput {
  audioModel: string
  sttModel: string
}

export interface SpeechEngineResolution {
  available: boolean
  engine: SpeechEngine
  reason: 'local-preferred' | 'model-fallback' | 'local-unavailable' | 'model-unavailable'
}
