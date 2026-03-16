import { getSpeechCapabilities } from './capabilities.ts'
import { resolveSpeechEngine } from './resolver.ts'
import type { SpeechCapabilities, SpeechCapabilityInput, SpeechEngineResolution, SpeechTask } from './types.ts'

export interface SpeechPreferenceInput extends SpeechCapabilityInput {
  textToSpeechMode: 'auto' | 'local' | 'model'
  speechToTextMode: 'auto' | 'local' | 'model'
}

export function resolvePreferredSpeechEngine(
  task: SpeechTask,
  settings: SpeechPreferenceInput,
  capabilities?: SpeechCapabilities,
): SpeechEngineResolution {
  const resolvedCapabilities = capabilities ?? getSpeechCapabilities(settings)
  const mode = task === 'tts' ? settings.textToSpeechMode : settings.speechToTextMode

  return resolveSpeechEngine(task, mode, resolvedCapabilities)
}

export function shouldFallbackToModelAfterLocalFailure(settings: SpeechPreferenceInput): boolean {
  return settings.speechToTextMode === 'auto' && Boolean(settings.sttModel)
}
