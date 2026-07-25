'use client'

import { useCallback, useSyncExternalStore } from 'react'

let importLocked = false

const listeners = new Set<() => void>()

function emitImportLockChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function isImportLocked(): boolean {
  return importLocked
}

export function tryAcquireImportLock(): boolean {
  if (importLocked) {
    return false
  }

  importLocked = true
  emitImportLockChange()
  return true
}

export function releaseImportLock(): void {
  if (!importLocked) {
    return
  }

  importLocked = false
  emitImportLockChange()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useImportLock() {
  const isLocked = useSyncExternalStore(subscribe, isImportLocked, isImportLocked)

  const acquire = useCallback(() => tryAcquireImportLock(), [])
  const release = useCallback(() => releaseImportLock(), [])

  return { isLocked, acquire, release }
}
