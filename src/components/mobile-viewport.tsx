'use client'

import { useEffect } from 'react'

const KEYBOARD_OPEN_THRESHOLD = 80
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const RICH_TEXT_EDITOR_SELECTOR = '.ProseMirror[contenteditable]:not([contenteditable="false"])'
const KEYBOARD_KEEPALIVE_SELECTOR = '.mobile-writing-toolbar'
const DRAWER_CONTENT_SELECTOR = '[data-slot="drawer-content"]'
const KEYBOARD_VIEWPORT_CHECK_DELAYS = [0, 80, 160, 320, 600, 900]
const EDITABLE_POINTER_WINDOW = 700
const STABLE_VIEWPORT_FALLBACK_WINDOW = 1200

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && target.matches(EDITABLE_SELECTOR)
}

function hasEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(EDITABLE_SELECTOR))
}

function hasKeyboardKeepAliveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(`${EDITABLE_SELECTOR}, ${KEYBOARD_KEEPALIVE_SELECTOR}`))
}

export function MobileViewport() {
  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    root.classList.add('mobile-app-active')
    body.classList.add('mobile-app-active')
    const timers = new Set<number>()
    let stableViewportHeight = window.visualViewport?.height ?? window.innerHeight
    let recentEditablePointerAt = 0
    let stableViewportFallbackUntil = 0

    const setTimer = (callback: () => void, delay: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        callback()
      }, delay)
      timers.add(id)
    }

    const updateViewportVars = () => {
      const viewport = window.visualViewport
      const viewportHeight = viewport?.height ?? window.innerHeight
      const viewportWidth = viewport?.width ?? window.innerWidth
      const viewportOffsetTop = viewport?.offsetTop ?? 0
      const activeElement = document.activeElement
      const hasEditableFocus = activeElement instanceof HTMLElement && isEditableElement(activeElement)
      const keyboardInset = Math.max(0, window.innerHeight - viewportHeight - viewportOffsetTop)
      const keyboardInsetFromStableViewport = Math.max(0, stableViewportHeight - viewportHeight)
      const allowStableViewportFallback = hasEditableFocus && Date.now() <= stableViewportFallbackUntil
      const keyboardOpen = keyboardInset > KEYBOARD_OPEN_THRESHOLD
        || (allowStableViewportFallback && keyboardInsetFromStableViewport > KEYBOARD_OPEN_THRESHOLD)
      const effectiveKeyboardInset = Math.max(keyboardInset, keyboardInsetFromStableViewport)

      if (!hasEditableFocus && viewportHeight > stableViewportHeight) {
        stableViewportHeight = viewportHeight
      }

      root.style.setProperty('--mobile-viewport-height', `${viewportHeight}px`)
      root.style.setProperty('--mobile-viewport-width', `${viewportWidth}px`)
      root.style.setProperty('--mobile-viewport-offset-top', `${Math.max(0, viewportOffsetTop)}px`)
      root.style.setProperty('--mobile-keyboard-inset', `${keyboardOpen ? effectiveKeyboardInset : 0}px`)
      root.classList.toggle('mobile-keyboard-open', keyboardOpen)
      body.classList.toggle('mobile-keyboard-open', keyboardOpen)
    }

    const keepFocusedElementVisible = () => {
      updateViewportVars()

      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLElement) || !isEditableElement(activeElement)) {
        return
      }

      // Tiptap keeps the caret visible by scrolling its own editor viewport.
      // Moving the entire contenteditable during the keyboard animation causes
      // a feedback loop with visualViewport updates on iOS.
      if (activeElement.matches(RICH_TEXT_EDITOR_SELECTOR)) {
        return
      }

      // Drawer inputs use their own scroll container and the browser's native
      // keyboard handling. Scrolling the page here would move the fixed drawer.
      if (activeElement.closest(DRAWER_CONTENT_SELECTOR)) {
        return
      }

      activeElement.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      })
    }

    const scheduleViewportUpdates = () => {
      KEYBOARD_VIEWPORT_CHECK_DELAYS.forEach((delay) => {
        setTimer(updateViewportVars, delay)
      })
    }

    const armStableViewportFallback = () => {
      stableViewportFallbackUntil = Date.now() + STABLE_VIEWPORT_FALLBACK_WINDOW
    }

    const handleEditablePointerStart = (event: Event) => {
      if (!hasKeyboardKeepAliveTarget(event.target)) {
        stableViewportFallbackUntil = 0
        return
      }

      if (hasEditableTarget(event.target)) {
        recentEditablePointerAt = Date.now()
      }
      armStableViewportFallback()
      scheduleViewportUpdates()
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (!isEditableElement(event.target)) {
        return
      }

      if (Date.now() - recentEditablePointerAt <= EDITABLE_POINTER_WINDOW) {
        armStableViewportFallback()
      }
      scheduleViewportUpdates()
      setTimer(keepFocusedElementVisible, 120)
      setTimer(keepFocusedElementVisible, 320)
      setTimer(keepFocusedElementVisible, 600)
    }

    const handleFocusOut = () => {
      stableViewportFallbackUntil = 0
      scheduleViewportUpdates()
    }

    const handleOrientationChange = () => {
      updateViewportVars()
      setTimer(updateViewportVars, 250)
    }

    const preventInterfacePinchZoom = (event: TouchEvent) => {
      if (event.touches.length < 2) return
      const target = event.target
      if (target instanceof Element && target.closest('.react-flow')) return
      event.preventDefault()
    }

    updateViewportVars()

    window.visualViewport?.addEventListener('resize', updateViewportVars)
    window.visualViewport?.addEventListener('scroll', updateViewportVars)
    window.addEventListener('resize', updateViewportVars)
    window.addEventListener('orientationchange', handleOrientationChange)
    document.addEventListener('pointerdown', handleEditablePointerStart)
    document.addEventListener('touchstart', handleEditablePointerStart, { passive: true })
    document.addEventListener('touchmove', preventInterfacePinchZoom, { capture: true, passive: false })
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewportVars)
      window.visualViewport?.removeEventListener('scroll', updateViewportVars)
      window.removeEventListener('resize', updateViewportVars)
      window.removeEventListener('orientationchange', handleOrientationChange)
      document.removeEventListener('pointerdown', handleEditablePointerStart)
      document.removeEventListener('touchstart', handleEditablePointerStart)
      document.removeEventListener('touchmove', preventInterfacePinchZoom, { capture: true })
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      timers.forEach((id) => window.clearTimeout(id))
      root.classList.remove('mobile-keyboard-open')
      body.classList.remove('mobile-keyboard-open')
      root.classList.remove('mobile-app-active')
      body.classList.remove('mobile-app-active')
      root.style.removeProperty('--mobile-viewport-height')
      root.style.removeProperty('--mobile-viewport-width')
      root.style.removeProperty('--mobile-viewport-offset-top')
      root.style.removeProperty('--mobile-keyboard-inset')
    }
  }, [])

  return null
}
