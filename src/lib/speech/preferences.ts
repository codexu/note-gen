import type { SpeechMode } from './types.ts'

export function normalizeSpeechMode(value: unknown): SpeechMode {
  if (value === 'local' || value === 'model' || value === 'auto') {
    return value
  }

  return 'auto'
}
