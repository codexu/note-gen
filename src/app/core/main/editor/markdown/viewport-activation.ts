'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const VIEWPORT_ROOT_MARGIN = '800px 0px'

type ViewportCallback = () => void

interface ObserverEntry {
  callbacks: Map<Element, Set<ViewportCallback>>
  observer: IntersectionObserver
}

const rootObservers = new WeakMap<Element, ObserverEntry>()
let documentObserver: ObserverEntry | null = null

function createObserverEntry(root: Element | null): ObserverEntry {
  const callbacks = new Map<Element, Set<ViewportCallback>>()
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue

      const elementCallbacks = callbacks.get(entry.target)
      if (!elementCallbacks) continue

      callbacks.delete(entry.target)
      observer.unobserve(entry.target)
      for (const callback of elementCallbacks) {
        callback()
      }
    }
  }, {
    root,
    rootMargin: VIEWPORT_ROOT_MARGIN,
  })

  return { callbacks, observer }
}

export function getEditorViewportRoot(element: Element): Element | null {
  return element.closest('[data-editor-viewport-root]')
    ?? element.closest('.editor-scroll-container')
}

function getObserverEntry(element: Element): ObserverEntry {
  const root = getEditorViewportRoot(element)
  if (!root) {
    documentObserver ??= createObserverEntry(null)
    return documentObserver
  }

  const existing = rootObservers.get(root)
  if (existing) return existing

  const created = createObserverEntry(root)
  rootObservers.set(root, created)
  return created
}

export function observeElementNearViewport(
  element: Element,
  callback: ViewportCallback
): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback()
    return () => {}
  }

  const entry = getObserverEntry(element)
  const elementCallbacks = entry.callbacks.get(element) ?? new Set<ViewportCallback>()
  elementCallbacks.add(callback)
  entry.callbacks.set(element, elementCallbacks)
  entry.observer.observe(element)

  return () => {
    const currentCallbacks = entry.callbacks.get(element)
    if (!currentCallbacks) return

    currentCallbacks.delete(callback)
    if (currentCallbacks.size === 0) {
      entry.callbacks.delete(element)
      entry.observer.unobserve(element)
    }
  }
}

export function useViewportActivation<ElementType extends Element>() {
  const elementRef = useRef<ElementType>(null)
  const [isActive, setIsActive] = useState(false)
  const activate = useCallback(() => setIsActive(true), [])

  useEffect(() => {
    const element = elementRef.current
    if (!element || isActive) return

    return observeElementNearViewport(element, activate)
  }, [activate, isActive])

  return { elementRef, isActive, activate }
}
