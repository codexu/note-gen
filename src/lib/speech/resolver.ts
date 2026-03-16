import type { SpeechCapabilities, SpeechEngineResolution, SpeechMode, SpeechTask } from './types.ts'

function getAvailability(task: SpeechTask, capabilities: SpeechCapabilities) {
  if (task === 'tts') {
    return {
      local: capabilities.localTtsAvailable,
      model: capabilities.modelTtsAvailable,
    }
  }

  return {
    local: capabilities.localSttAvailable,
    model: capabilities.modelSttAvailable,
  }
}

export function resolveSpeechEngine(
  task: SpeechTask,
  mode: SpeechMode,
  capabilities: SpeechCapabilities,
): SpeechEngineResolution {
  const availability = getAvailability(task, capabilities)

  if (mode === 'local') {
    return availability.local
      ? { available: true, engine: 'local', reason: 'local-preferred' }
      : { available: false, engine: 'local', reason: 'local-unavailable' }
  }

  if (mode === 'model') {
    return availability.model
      ? { available: true, engine: 'model', reason: 'model-fallback' }
      : { available: false, engine: 'model', reason: 'model-unavailable' }
  }

  if (availability.local) {
    return { available: true, engine: 'local', reason: 'local-preferred' }
  }

  if (availability.model) {
    return { available: true, engine: 'model', reason: 'model-fallback' }
  }

  return { available: false, engine: 'local', reason: 'local-unavailable' }
}
