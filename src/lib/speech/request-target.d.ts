import type { AiRequestConfig } from '@/lib/ai/tauri-client'

export function resolveSpeechRequestTarget(
  config: AiRequestConfig,
  endpoint: string | undefined,
  defaultPath: '/audio/speech' | '/audio/transcriptions',
): { config: AiRequestConfig; path: string }
