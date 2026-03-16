import type { SpeechCapabilities, SpeechCapabilityInput } from './types.ts'

export function getSpeechCapabilities({ audioModel, sttModel }: SpeechCapabilityInput): SpeechCapabilities {
  const currentWindow = typeof window === 'undefined' ? undefined : window

  return {
    localTtsAvailable: Boolean(currentWindow?.speechSynthesis),
    localSttAvailable: Boolean(currentWindow?.SpeechRecognition || currentWindow?.webkitSpeechRecognition),
    modelTtsAvailable: Boolean(audioModel),
    modelSttAvailable: Boolean(sttModel),
  }
}
