'use client'

import { useEffect } from 'react'

export function ConsoleFilter() {
  useEffect(() => {
    const originalError = console.error

    console.error = (...args: any[]) => {
      // 过滤 flushSync 警告
      const message = args.join(' ')
      if (message.includes('flushSync')) {
        return
      }
      originalError.apply(console, args)
    }

    return () => {
      console.error = originalError
    }
  }, [])

  return null
}
