'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { ImageHostingType } from '@/lib/image-hosting-config'

interface ImageHostingSettingsActivity {
  active: boolean
  isActive: () => boolean
  getCheckGuard: () => () => boolean
}

const ImageHostingSettingsActivityContext = createContext<ImageHostingSettingsActivity>({
  active: false,
  isActive: () => false,
  getCheckGuard: () => () => false,
})

/** A check belongs to one visible provider session, including after reopening. */
export function ImageHostingSettingsActivityProvider({ active, provider, children }: {
  active: boolean
  provider: ImageHostingType
  children: ReactNode
}) {
  const mounted = useRef(true)
  const session = useRef({ active, provider, token: Symbol() })
  if (session.current.active !== active || session.current.provider !== provider) {
    session.current = { active, provider, token: Symbol() }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      session.current = { ...session.current, token: Symbol() }
    }
  }, [])

  const isActive = useCallback(() => mounted.current && session.current.active, [])
  const getCheckGuard = useCallback(() => {
    const token = session.current.token
    return () => isActive() && session.current.token === token
  }, [isActive])
  const value = useMemo(() => ({ active, isActive, getCheckGuard }), [active, isActive, getCheckGuard])

  return <ImageHostingSettingsActivityContext.Provider value={value}>{children}</ImageHostingSettingsActivityContext.Provider>
}

export function useImageHostingSettingsActivity(): ImageHostingSettingsActivity {
  return useContext(ImageHostingSettingsActivityContext)
}
