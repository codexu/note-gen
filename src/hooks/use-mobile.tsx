import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MobileModeContext = React.createContext<boolean | null>(null)
let mobileMediaQuery: MediaQueryList | null = null
const mobileSubscribers = new Set<() => void>()

function getMobileMediaQuery() {
  if (typeof window === 'undefined') return null
  mobileMediaQuery ??= window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  return mobileMediaQuery
}

function subscribeToMobileViewport(callback: () => void) {
  const mediaQuery = getMobileMediaQuery()
  mobileSubscribers.add(callback)

  if (mobileSubscribers.size === 1) {
    mediaQuery?.addEventListener('change', notifyMobileSubscribers)
  }

  return () => {
    mobileSubscribers.delete(callback)
    if (mobileSubscribers.size === 0) {
      mediaQuery?.removeEventListener('change', notifyMobileSubscribers)
    }
  }
}

function notifyMobileSubscribers() {
  mobileSubscribers.forEach(callback => callback())
}

function getMobileSnapshot() {
  return getMobileMediaQuery()?.matches ?? false
}

function getServerMobileSnapshot() {
  return false
}

function subscribeToForcedMode() {
  return () => undefined
}

export function MobileModeProvider({
  mobile,
  children,
}: {
  mobile: boolean
  children: React.ReactNode
}) {
  return (
    <MobileModeContext.Provider value={mobile}>
      {children}
    </MobileModeContext.Provider>
  )
}

export function useIsMobile() {
  const forcedMobileMode = React.useContext(MobileModeContext)
  const viewportMobile = React.useSyncExternalStore(
    forcedMobileMode === null ? subscribeToMobileViewport : subscribeToForcedMode,
    forcedMobileMode === null ? getMobileSnapshot : () => forcedMobileMode,
    forcedMobileMode === null ? getServerMobileSnapshot : () => forcedMobileMode,
  )

  return forcedMobileMode ?? viewportMobile
}
