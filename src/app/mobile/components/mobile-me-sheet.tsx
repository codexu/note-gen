"use client"

import { UserRound } from "lucide-react"
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from "framer-motion"
import { useTranslations } from "next-intl"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { MobileMePage } from "@/app/mobile/setting/components/mobile-me-page"
import { getMobilePlatform } from "@/app/mobile/components/mobile-update-prompt"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ShineBorder } from "@/components/ui/shine-border"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import useSyncStore from "@/stores/sync"
import useSettingStore from "@/stores/setting"
import useUpdateStore from "@/stores/update"
import { cn } from "@/lib/utils"
import emitter from "@/lib/emitter"
import {
  getAutoDataSyncState,
  subscribeAutoDataSyncState,
  type AutoDataSyncState,
} from "@/lib/sync/auto-data-sync-queue"

const MOBILE_ME_RESTORE_OPEN_KEY = "mobile-me-restore-open"
const MOBILE_ME_RESTORE_INSTANT_KEY = "mobile-me-restore-open-instant"
const SYNC_INDICATOR_HIDE_DELAY = 500

export function MobileMeSheet() {
  const reduceMotion = useReducedMotion()
  const tNavigation = useTranslations("navigation")
  const [open, setOpen] = useState(false)
  const [instantRestore, setInstantRestore] = useState(false)
  const [autoDataSyncState, setAutoDataSyncState] = useState<AutoDataSyncState>(
    getAutoDataSyncState()
  )
  const [syncingFiles, setSyncingFiles] = useState<Set<string>>(() => new Set())
  const [showSyncIndicator, setShowSyncIndicator] = useState(false)
  const primaryBackupMethod = useSettingStore(state => state.primaryBackupMethod)
  const autoRecordSyncEnabled = useSettingStore(state => state.autoRecordSyncEnabled)
  const autoConversationSyncEnabled = useSettingStore(state => state.autoConversationSyncEnabled)
  const mobileUpdate = useUpdateStore(state => state.mobileUpdate)
  const [currentPlatform] = useState(() => getMobilePlatform())
  const hasMobileUpdate = Boolean(mobileUpdate && currentPlatform)
  const swipeSurfaceRef = useRef<HTMLDivElement>(null)
  const surfaceX = useMotionValue(0)
  const avatarUrl = useSyncStore(state =>
    state.userInfo?.avatar_url
    || state.giteeUserInfo?.avatar_url
    || state.gitlabUserInfo?.avatar_url
    || state.giteaUserInfo?.avatar_url
    || ""
  )

  useEffect(() => subscribeAutoDataSyncState(setAutoDataSyncState), [])

  useEffect(() => {
    const handlePushStarted = (event: { path: string }) => {
      setSyncingFiles(current => {
        const next = new Set(current)
        next.add(event.path)
        return next
      })
    }
    const handlePushCompleted = (event: { path: string }) => {
      setSyncingFiles(current => {
        if (!current.has(event.path)) return current
        const next = new Set(current)
        next.delete(event.path)
        return next
      })
    }

    emitter.on('sync-push-started', handlePushStarted)
    emitter.on('sync-push-completed', handlePushCompleted)
    return () => {
      emitter.off('sync-push-started', handlePushStarted)
      emitter.off('sync-push-completed', handlePushCompleted)
    }
  }, [])

  const syncing = useMemo(() => (
    primaryBackupMethod !== 'selfHosted' && primaryBackupMethod !== 'local'
    && (syncingFiles.size > 0
      || autoDataSyncState.phase === 'uploading'
      || autoDataSyncState.phase === 'downloading')
  ), [autoDataSyncState.phase, primaryBackupMethod, syncingFiles])
  const indicator = useMemo(() => {
    if (hasMobileUpdate) return true
    if (primaryBackupMethod === 'selfHosted' || primaryBackupMethod === 'local') return false
    const recordProblem = autoRecordSyncEnabled
      && (autoDataSyncState.phase === 'waiting_provider'
        || (autoDataSyncState.affectedDomains.includes('records')
          && (autoDataSyncState.phase === 'failed' || autoDataSyncState.phase === 'conflict')))
    const conversationProblem = autoConversationSyncEnabled
      && autoDataSyncState.affectedDomains.includes('conversations')
      && (autoDataSyncState.phase === 'failed' || autoDataSyncState.phase === 'conflict')
    return recordProblem || conversationProblem
  }, [
    autoConversationSyncEnabled,
    autoDataSyncState.affectedDomains,
    autoDataSyncState.phase,
    autoRecordSyncEnabled,
    hasMobileUpdate,
    primaryBackupMethod,
  ])

  useEffect(() => {
    if (primaryBackupMethod === 'selfHosted' || primaryBackupMethod === 'local') {
      setShowSyncIndicator(false)
      return
    }
    if (syncing) {
      setShowSyncIndicator(true)
      return
    }

    const timer = window.setTimeout(
      () => setShowSyncIndicator(false),
      SYNC_INDICATOR_HIDE_DELAY,
    )
    return () => window.clearTimeout(timer)
  }, [primaryBackupMethod, syncing])

  useLayoutEffect(() => {
    if (window.sessionStorage.getItem(MOBILE_ME_RESTORE_OPEN_KEY) !== "true") {
      return
    }

    const restoreInstantly = (
      window.sessionStorage.getItem(MOBILE_ME_RESTORE_INSTANT_KEY) === "true"
    )
    window.sessionStorage.removeItem(MOBILE_ME_RESTORE_OPEN_KEY)
    window.sessionStorage.removeItem(MOBILE_ME_RESTORE_INSTANT_KEY)

    if (restoreInstantly) {
      surfaceX.set(0)
      setInstantRestore(true)
      setOpen(true)
      requestAnimationFrame(() => setInstantRestore(false))
      return
    }

    openSheet()
  }, [])

  function getSurfaceWidth() {
    return swipeSurfaceRef.current?.offsetWidth
      ?? Math.min(window.innerWidth * 0.88, 360)
  }

  function moveSurface(
    target: number,
    onComplete?: () => void,
  ) {
    if (reduceMotion) {
      surfaceX.set(target)
      onComplete?.()
      return
    }

    animate(surfaceX, target, {
      type: "spring",
      stiffness: 520,
      damping: 42,
      onComplete,
    })
  }

  function openSheet() {
    surfaceX.set(-getSurfaceWidth())
    setOpen(true)
    requestAnimationFrame(() => moveSurface(0))
  }

  function closeSheet() {
    moveSurface(-getSurfaceWidth(), () => {
      setOpen(false)
      surfaceX.set(0)
    })
  }

  function closeSheetBeforeNavigation() {
    setOpen(false)
    surfaceX.set(0)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      openSheet()
      return
    }

    closeSheet()
  }

  function handleSwipeEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const width = swipeSurfaceRef.current?.offsetWidth ?? 360
    const shouldClose = info.offset.x <= -width * 0.25 || info.velocity.x <= -650

    if (shouldClose) {
      closeSheet()
      return
    }

    moveSurface(0)
  }

  function handleEdgePanStart() {
    surfaceX.set(-getSurfaceWidth())
    setOpen(true)
  }

  function handleEdgePan(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const width = getSurfaceWidth()
    surfaceX.set(Math.min(0, Math.max(-width, -width + Math.max(0, info.offset.x))))
  }

  function handleEdgePanEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const width = getSurfaceWidth()
    const shouldOpen = info.offset.x >= width * 0.25 || info.velocity.x >= 650

    if (shouldOpen) {
      moveSurface(0)
      return
    }

    closeSheet()
  }

  return (
    <>
      <motion.div
        aria-hidden
        className="fixed inset-y-0 left-0 z-40 w-5 touch-pan-y"
        onPanStart={handleEdgePanStart}
        onPan={handleEdgePan}
        onPanEnd={handleEdgePanEnd}
      />

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tNavigation("me")}
            aria-busy={syncing}
            className="relative rounded-full transition-transform duration-300 active:scale-90 data-[state=open]:scale-90"
          >
            <span className="relative flex size-8 items-center justify-center rounded-full">
              <ShineBorder
                borderWidth={2}
                duration={5}
                shineColor={["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A"]}
                className={cn(
                  "rounded-full transition-opacity duration-200",
                  showSyncIndicator
                    ? "opacity-100 [animation-play-state:running]"
                    : "opacity-0 [animation-play-state:paused]"
                )}
              />
              <Avatar className="size-7">
                <AvatarImage src={avatarUrl} alt="" />
                <AvatarFallback>
                  <UserRound />
                </AvatarFallback>
              </Avatar>
            </span>
            <span
              aria-hidden
              className={cn(
                "absolute right-0.5 top-0.5 size-2 rounded-full bg-destructive ring-2 ring-background",
                !indicator && "hidden"
              )}
            />
          </Button>
        </SheetTrigger>

        <SheetContent
          side="left"
          showCloseButton={false}
          overlayClassName="mobile-me-sheet-overlay duration-500"
          className={cn(
            "mobile-me-sheet-content gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none",
            "data-[side=left]:w-[88vw] data-[side=left]:max-w-[22.5rem] data-[side=left]:border-r-0",
            "duration-0 data-open:animate-none data-closed:animate-none"
          )}
        >
          <motion.div
            ref={swipeSurfaceRef}
            style={{ x: surfaceX }}
            className="mobile-me-sheet-surface relative flex h-full min-h-0 w-full touch-pan-y flex-col overflow-hidden border-r bg-background shadow-2xl"
            drag="x"
            dragConstraints={{ left: -480, right: 0 }}
            dragDirectionLock
            dragElastic={{ left: 0.04, right: 0 }}
            dragMomentum={false}
            onDragEnd={handleSwipeEnd}
          >
            <SheetTitle className="sr-only">{tNavigation("me")}</SheetTitle>
            <SheetDescription className="sr-only">{tNavigation("me")}</SheetDescription>

            <div className="relative min-h-0 flex-1 pt-[env(safe-area-inset-top)]">
              <MobileMePage
                embedded
                animateEntrance={!instantRestore}
                refreshOnMount={!instantRestore}
                onNavigate={closeSheetBeforeNavigation}
              />
            </div>
          </motion.div>
        </SheetContent>
      </Sheet>
    </>
  )
}
