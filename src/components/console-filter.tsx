'use client'

import { useEffect } from 'react'
import { recordRuntimeLog } from '@/lib/diagnostics/runtime-log-buffer'
import useSettingStore from '@/stores/setting'

function captureRuntimeLog(level: 'info' | 'warn' | 'error', args: unknown[]) {
  if (useSettingStore.getState().developerMode) recordRuntimeLog(level, args)
}

function shouldFilterConsoleMessage(args: unknown[]) {
  const message = args.map((arg) => String(arg)).join(' ')

  if (isKnownTauriDevNoise(message)) {
    return true
  }

  if (message.includes('flushSync')) {
    return true
  }

  return (
    message.includes("[TAURI] Couldn't find callback id") &&
    message.includes('app is reloaded while Rust is running an asynchronous operation')
  )
}

function getErrorMessage(value: unknown) {
  if (value instanceof Error) {
    return value.message
  }

  if (typeof value === 'object' && value !== null && 'message' in value) {
    return String((value as { message?: unknown }).message)
  }

  return String(value)
}

function isKnownTauriDevNoise(message: string) {
  if (message.includes('IPC custom protocol failed') && message.includes('postMessage interface')) {
    return true
  }

  if (
    message.includes('Fetch API cannot load ipc://localhost') &&
    message.includes('access control checks')
  ) {
    return true
  }

  if (
    message.includes("[TAURI] Couldn't find callback id") &&
    message.includes('app is reloaded while Rust is running an asynchronous operation')
  ) {
    return true
  }

  if (
    message.includes('undefined is not an object') &&
    message.includes('callbackId')
  ) {
    return true
  }

  if (
    (message.includes('__nextjs_original-stack-frames') ||
      message.includes('__nextjs_original-stack-frame')) &&
    (message.includes('access control') ||
      message.includes('getOriginalStackFrames') ||
      message.includes('localhost:3456'))
  ) {
    return true
  }

  return false
}

export function ConsoleFilter() {
  useEffect(() => {
    const originalError = console.error
    const originalWarn = console.warn
    const originalInfo = console.info

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isKnownTauriDevNoise(getErrorMessage(event.reason))) {
        event.preventDefault()
      }
    }

    const handleError = (event: ErrorEvent) => {
      const message = event.message || getErrorMessage(event.error)
      if (isKnownTauriDevNoise(message)) {
        event.preventDefault()
      }
    }

    console.error = (...args: unknown[]) => {
      if (shouldFilterConsoleMessage(args)) {
        return
      }
      captureRuntimeLog('error', args)
      originalError.apply(console, args)
    }

    console.warn = (...args: unknown[]) => {
      if (shouldFilterConsoleMessage(args)) {
        return
      }
      captureRuntimeLog('warn', args)
      originalWarn.apply(console, args)
    }

    console.info = (...args: unknown[]) => {
      captureRuntimeLog('info', args)
      originalInfo.apply(console, args)
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('error', handleError)

    return () => {
      console.error = originalError
      console.warn = originalWarn
      console.info = originalInfo
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('error', handleError)
    }
  }, [])

  return null
}
