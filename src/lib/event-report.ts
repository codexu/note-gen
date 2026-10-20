/**
 * 匿名产品统计上报。
 *
 * 只发送应用启动事件，用于 Aptabase 统计基础活跃数据；
 * 不上报笔记内容、文件名、文件路径、AI 对话或硬件机器 ID。
 */

import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'

let runtimeSessionId: string | null = null

interface AptabaseEventPayload {
  timestamp: string
  sessionId: string
  eventName: string
  systemProps: {
    isDebug: boolean
    osName: string
    osVersion: string
    locale: string
    engineName: string
    engineVersion: string
    appVersion: string
    sdkVersion: string
  }
  props: Record<string, never>
}

declare global {
  interface Window {
    __reportNoteGenAppStart?: () => Promise<boolean>
  }
}

export enum EventType {
  APP_START = 'app_start',
}

function generateRFC3339Timestamp(): string {
  return new Date().toISOString()
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function getRuntimeSessionId(): string {
  if (!runtimeSessionId) {
    runtimeSessionId = generateSessionId()
  }

  return runtimeSessionId
}

async function getAppVersion(): Promise<string> {
  try {
    return await getVersion()
  } catch (error) {
    console.error('Failed to get app version:', error)
    return 'unknown'
  }
}

async function getPlatform(): Promise<string> {
  try {
    return platform()
  } catch (error) {
    console.error('Failed to get platform:', error)
    return 'unknown'
  }
}

async function getSystemProps(): Promise<AptabaseEventPayload['systemProps']> {
  const [appVersion, osName] = await Promise.all([
    getAppVersion(),
    getPlatform(),
  ])

  return {
    isDebug: false,
    osName,
    osVersion: 'unknown',
    locale: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
    engineName: 'tauri',
    engineVersion: '2',
    appVersion,
    sdkVersion: 'notegen-aptabase-native',
  }
}

async function trackAnalyticsEvent(name: EventType): Promise<boolean> {
  try {
    const event: AptabaseEventPayload = {
      timestamp: generateRFC3339Timestamp(),
      sessionId: getRuntimeSessionId(),
      eventName: name,
      systemProps: await getSystemProps(),
      props: {},
    }

    const responseText = await invoke<string>('track_analytics_event', { event })
    if (process.env.NODE_ENV === 'development') {
      console.info(`[analytics] reported ${name}`, {
        response: responseText,
        sessionId: event.sessionId,
      })
    }

    return true
  } catch {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[analytics] skipped ${name}: analytics service unavailable`)
    }
    return false
  }
}

export async function reportAppStart(): Promise<boolean> {
  return trackAnalyticsEvent(EventType.APP_START)
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  window.__reportNoteGenAppStart = reportAppStart
}
