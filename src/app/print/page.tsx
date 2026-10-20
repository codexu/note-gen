'use client'

import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { useEffect, useState } from 'react'

const IMAGE_LOAD_TIMEOUT_MS = 5000
const PRINT_EXPORT_STORE = 'print-export.json'

interface TauriPrintDocument {
  html: string
  outputPath?: string
  completionEvent?: string
}

function waitForImage(image: HTMLImageElement) {
  if (image.complete) return Promise.resolve()

  return Promise.race([
    new Promise<void>((resolve) => {
      image.onload = () => resolve()
      image.onerror = () => resolve()
    }),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, IMAGE_LOAD_TIMEOUT_MS)
    }),
  ])
}

async function waitForPrintResources() {
  await Promise.all(Array.from(document.images).map(waitForImage))
  await document.fonts?.ready
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export default function PrintPage() {
  const [error, setError] = useState('')

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('key')

    void (async () => {
      if (!key) {
        throw new Error('打印内容不存在或已经过期')
      }

      const store = await Store.load(PRINT_EXPORT_STORE)
      const printDocument = await store.get<TauriPrintDocument>(key)
      await store.delete(key)
      await store.save()

      if (!printDocument) {
        throw new Error('打印内容不存在或已经过期')
      }

      const exportedDocument = new DOMParser().parseFromString(printDocument.html, 'text/html')
      document.head.replaceWith(exportedDocument.head)
      document.body.replaceWith(exportedDocument.body)
      await waitForPrintResources()
      await invoke('print_webview', {
        path: printDocument.outputPath,
        eventName: printDocument.completionEvent,
      })
    })().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center p-8 text-sm text-muted-foreground">
      {error || '正在准备系统打印窗口…'}
    </main>
  )
}
