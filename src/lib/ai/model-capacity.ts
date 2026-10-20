import { Store } from '@tauri-apps/plugin-store'
import type { AiConfig } from '@/app/core/setting/config'
import { agentDebugLog } from '@/lib/agent/debug-log'

const FALLBACK_CONTEXT_WINDOW = 16_384
const MIN_CONTEXT_WINDOW = 1_024
const ESTIMATED_CONTEXT_WINDOW_TIERS = [16_384, 32_768, 65_536, 131_072]
const LEARNED_CONTEXT_WINDOWS_KEY = 'learnedContextWindows'

export type ModelCapacitySource = 'user' | 'learned' | 'estimated' | 'fallback'

export interface ModelCapacity {
  contextWindow: number
  source: ModelCapacitySource
  confidence: 'high' | 'medium' | 'low'
  expandable: boolean
}

interface LearnedContextWindow {
  contextWindow: number
  exact: boolean
  expandable?: boolean
}

type LearnedContextWindows = Record<string, number | LearnedContextWindow>

const CONTEXT_OVERFLOW_PATTERN =
  /context[_\s-]*(?:length|window|size)[_\s-]*(?:exceeded|error)|maximum context|maximum (?:sequence|model) length|maximum number of tokens allowed|max(?:imum)?[_\s-]*(?:seq[_\s-]*len|model[_\s-]*len|position[_\s-]*embeddings|context[_\s-]*(?:length|window))|input (?:token count|length)[\s\S]+(?:exceed|too long)|number of input tokens[\s\S]+exceeded|requested [\s\S]+ tokens[\s\S]+(?:exceed|maximum)|prompt (?:is )?too long|too many tokens|token limit exceeded|exceeds? (?:the )?(?:available )?context|reduce the length of (?:the )?(?:messages|prompt)|input is too long for (?:the )?(?:requested )?model|context_length_exceeded|input_too_long/i

const CONTEXT_WINDOW_PATTERNS = [
  /maximum context length(?: is| of|:|=)?\s*\(?\s*([\d,]+)/i,
  /maximum context window(?: is| of|:|=)?\s*\(?\s*([\d,]+)/i,
  /maximum sequence length(?: is| of|:|=)?\s*\(?\s*([\d,]+)/i,
  /maximum model length(?: is| of|:|=)?\s*\(?\s*([\d,]+)/i,
  /max[_\s-]*seq[_\s-]*len\s*[:=]?\s*\(?\s*([\d,]+)/i,
  /max[_\s-]*model[_\s-]*len\s*[:=]?\s*\(?\s*([\d,]+)/i,
  /max[_\s-]*position[_\s-]*embeddings\s*[:=]?\s*\(?\s*([\d,]+)/i,
  /max(?:imum)?[_\s-]*context[_\s-]*(?:length|window)\s*["']?\s*[:=]\s*\(?\s*([\d,]+)/i,
  /([\d,]+)\s+max(?:imum)?\s+context\s+(?:length|window)/i,
  /context window(?: is| of|:|=)?\s*\(?\s*([\d,]+)/i,
  /context[_\s-]*length(?: is| of|:|=)?\s*\(?\s*([\d,]+)/i,
  /maximum number of tokens allowed(?: is|:|=)?\s*\(?\s*([\d,]+)/i,
  /maximum(?: allowed)?(?: context)? tokens(?: is|:|=)?\s*\(?\s*([\d,]+)/i,
  /(?:token|context) limit(?: is| of|:|=)?\s*\(?\s*([\d,]+)/i,
  /limit of\s*([\d,]+)\s*(?:tokens?|input tokens?)/i,
  /supports? (?:up to|at most)\s*([\d,]+)\s*tokens?/i,
  /([\d,]+)\s*tokens?\s*(?:maximum|max)\b/i,
  />\s*([\d,]+)\s*(?:tokens?\s*)?(?:maximum|max)\b/i,
]

function normalizeEndpoint(baseURL?: string) {
  return (baseURL || '').trim().replace(/\/+$/, '').toLowerCase()
}

export function getModelCapacityKey(config?: Pick<AiConfig, 'baseURL' | 'model'>) {
  return `${normalizeEndpoint(config?.baseURL)}::${(config?.model || '').trim().toLowerCase()}`
}

function normalizeContextWindow(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  const rounded = Math.floor(value)
  return rounded >= MIN_CONTEXT_WINDOW ? rounded : undefined
}

export async function resolveModelCapacity(
  config?: Pick<AiConfig, 'baseURL' | 'model' | 'contextWindow'>
): Promise<ModelCapacity> {
  const configured = normalizeContextWindow(config?.contextWindow)
  if (configured) {
    return {
      contextWindow: configured,
      source: 'user',
      confidence: 'high',
      expandable: false,
    }
  }

  const store = await Store.load('store.json')
  const learned = await store.get<LearnedContextWindows>(LEARNED_CONTEXT_WINDOWS_KEY) || {}
  const stored = learned[getModelCapacityKey(config)]
  const learnedWindow = normalizeContextWindow(
    typeof stored === 'number' ? stored : stored?.contextWindow
  )
  if (learnedWindow) {
    const exact = typeof stored === 'number' || stored?.exact === true
    return {
      contextWindow: learnedWindow,
      source: exact ? 'learned' : 'estimated',
      confidence: exact ? 'medium' : 'low',
      expandable: !exact && typeof stored !== 'number' && stored?.expandable === true,
    }
  }

  return {
    contextWindow: FALLBACK_CONTEXT_WINDOW,
    source: 'fallback',
    confidence: 'low',
    expandable: true,
  }
}

export function getNextEstimatedModelCapacity(
  capacity: ModelCapacity
): ModelCapacity | undefined {
  if (!capacity.expandable) {
    return undefined
  }

  const nextWindow = ESTIMATED_CONTEXT_WINDOW_TIERS.find(
    contextWindow => contextWindow > capacity.contextWindow
  )
  if (!nextWindow) {
    return undefined
  }

  return {
    contextWindow: nextWindow,
    source: 'estimated',
    confidence: 'low',
    expandable: true,
  }
}

function errorText(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    const cause = 'cause' in error ? error.cause : undefined
    return `${error.message}\n${cause ? errorText(cause) : ''}`
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export interface ContextOverflowInfo {
  detected: boolean
  contextWindow?: number
}

export function parseContextOverflowError(error: unknown): ContextOverflowInfo {
  const text = errorText(error)
  const detected = CONTEXT_OVERFLOW_PATTERN.test(text)

  if (!detected) {
    return { detected: false }
  }

  for (const pattern of CONTEXT_WINDOW_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[1]) {
      continue
    }

    const value = normalizeContextWindow(Number(match[1].replace(/,/g, '')))
    if (value) {
      return { detected: true, contextWindow: value }
    }
  }

  return { detected: true }
}

export async function learnContextWindow(
  config: Pick<AiConfig, 'baseURL' | 'model'>,
  contextWindow: number
) {
  await saveLearnedContextWindow(config, contextWindow, true)
}

async function saveLearnedContextWindow(
  config: Pick<AiConfig, 'baseURL' | 'model'>,
  contextWindow: number,
  exact: boolean,
  expandable = false
) {
  const normalized = normalizeContextWindow(contextWindow)
  if (!normalized) {
    return
  }

  const store = await Store.load('store.json')
  const learned = await store.get<LearnedContextWindows>(LEARNED_CONTEXT_WINDOWS_KEY) || {}
  learned[getModelCapacityKey(config)] = {
    contextWindow: normalized,
    exact,
    expandable,
  }
  await store.set(LEARNED_CONTEXT_WINDOWS_KEY, learned)
  await store.save()
  agentDebugLog('context_capacity_learned', {
    model: config.model || '',
    contextWindow: normalized,
    exact,
    source: exact
      ? 'provider_error'
      : expandable
        ? 'successful_probe'
        : 'conservative_reduction',
  })
}

export async function confirmEstimatedContextWindow(
  config: Pick<AiConfig, 'baseURL' | 'model' | 'contextWindow'>,
  contextWindow: number
) {
  if (normalizeContextWindow(config.contextWindow)) {
    return
  }

  const current = await resolveModelCapacity(config)
  if (
    !current.expandable
    || contextWindow <= current.contextWindow
  ) {
    return
  }

  await saveLearnedContextWindow(config, contextWindow, false, true)
}

export async function reduceLearnedContextWindow(
  config: Pick<AiConfig, 'baseURL' | 'model' | 'contextWindow'>,
  previousWindow?: number
) {
  if (normalizeContextWindow(config.contextWindow)) {
    return
  }

  const current = previousWindow || (await resolveModelCapacity(config)).contextWindow
  await saveLearnedContextWindow(
    config,
    Math.max(MIN_CONTEXT_WINDOW, Math.floor(current * 0.65)),
    false
  )
}
