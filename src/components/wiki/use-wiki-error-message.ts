'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'

export function useWikiErrorMessage() {
  const t = useTranslations('wiki')
  return useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause)
    const code = /^(WIKI_[A-Z_]+)(?::|$)/.exec(message)?.[1]
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : message
  }, [t])
}
