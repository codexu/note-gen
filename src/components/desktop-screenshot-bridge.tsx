'use client'

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { BaseDirectory, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef } from 'react'

import { useRecordCompletion } from '@/app/core/main/mark/use-record-completion'
import { getMarkById, insertExternalMark, updateMark, type Mark } from '@/db/marks'
import { getTags } from '@/db/tags'
import { toast } from '@/hooks/use-toast'
import {
  beginDesktopScreenshot,
  readDesktopScreenshotError,
  type DesktopScreenshotError,
  type DesktopScreenshotResult,
} from '@/lib/desktop-screenshot'
import emitter from '@/lib/emitter'
import { uploadImage } from '@/lib/imageHosting'
import { recognizeImageWithFallback } from '@/lib/image-recognition'
import { getImageRecognitionProgressText } from '@/lib/image-recognition-progress'
import { getDefaultRecordSaveTagId } from '@/lib/record-save-target'
import { notifyScreenshotResult } from '@/lib/screenshot-notification'
import { listenTauriEvent } from '@/lib/tauri-event-listener'
import useMarkStore from '@/stores/mark'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'

const SCREENSHOT_DIR = 'screenshot'
const savingSessions = new Map<string, Promise<void>>()
const savedSessions = new Set<string>()
type AcknowledgementRetry = { attempts: number; timer: ReturnType<typeof setTimeout> | null }
const acknowledgementRetries = new Map<string, AcknowledgementRetry>()

async function getScreenshotSaveTarget(sessionId: string) {
  const store = await Store.load('desktop-screenshot.json')
  const storedTarget = await store.get<number>(sessionId)
  const tags = await getTags()
  if (tags.length === 0) throw new Error('No record tags are available')
  if (storedTarget && tags.some(tag => tag.id === storedTarget)) return storedTarget

  await useTagStore.getState().initTags()
  const tagId = await getDefaultRecordSaveTagId()
  // Keep the first save target across file/DB retries and pending-result recovery.
  await store.set(sessionId, tagId)
  await store.save()
  return tagId
}

async function acknowledgeScreenshot(sessionId: string) {
  try {
    await invoke('remove_desktop_screenshot_result', { sessionId })
    const store = await Store.load('desktop-screenshot.json')
    await store.delete(sessionId)
    await store.save()
    const pending = acknowledgementRetries.get(sessionId)
    if (pending?.timer) clearTimeout(pending.timer)
    acknowledgementRetries.delete(sessionId)
  } catch (error) {
    const pending: AcknowledgementRetry = acknowledgementRetries.get(sessionId) ?? { attempts: 0, timer: null }
    if (!pending.timer) {
      const delay = [1000, 2000, 5000, 30000, 300000][Math.min(pending.attempts, 4)]
      pending.attempts += 1
      console.warn('Screenshot acknowledgement cleanup will retry:', { sessionId, attempt: pending.attempts, retryInMs: delay, error })
      pending.timer = setTimeout(() => {
        pending.timer = null
        void acknowledgeScreenshot(sessionId).catch(retryError => {
          console.error('Screenshot acknowledgement cleanup retry failed:', sessionId, retryError)
        })
      }, delay)
      acknowledgementRetries.set(sessionId, pending)
    }
    throw error
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

function isScreenshotResult(value: DesktopScreenshotResult) {
  return Boolean(value)
    && typeof value.sessionId === 'string'
    && /^[a-zA-Z0-9-]{1,80}$/.test(value.sessionId)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0
}

export function DesktopScreenshotBridge({ ready }: { ready: boolean }) {
  const t = useTranslations()
  const completeRecord = useRecordCompletion()
  const readyRef = useRef(ready)
  const pendingResults = useRef(new Map<string, DesktopScreenshotResult>())
  const pendingStart = useRef(false)

  readyRef.current = ready

  const showCaptureError = useCallback(async (error: unknown) => {
    const failure = readDesktopScreenshotError(error)
    const description = failure.code === 'permission-denied'
      ? t('record.capture.desktopScreenshotPermissionDenied')
      : failure.code === 'unsupported-session'
        ? t('record.capture.desktopScreenshotUnsupportedSession')
        : t('record.capture.desktopScreenshotCaptureFailed')

    console.error('Desktop screenshot failed:', failure)
    void notifyScreenshotResult({
      title: t('record.capture.screenshotCaptureFailed'),
      body: description,
    })
    toast({
      title: t('record.capture.screenshotCaptureFailed'),
      description,
      variant: 'destructive',
      duration: Infinity,
    })
  }, [t])

  const processSavedScreenshot = useCallback(async (
    savedMark: Mark,
    bytes: Uint8Array,
    filename: string,
    enableRecognition: boolean,
    shouldGenerateDescription: boolean,
  ) => {
    const queueId = savedMark.sourceId || filename
    const { addQueue, removeQueue, setQueue, fetchMarks } = useMarkStore.getState()

    // Recognition and hosting run after the local record has been saved.
    addQueue({
      queueId,
      tagId: savedMark.tagId,
      progress: t('record.mark.progress.cacheScreenshot'),
      type: 'scan',
      startTime: Date.now(),
    })

    const updateSavedScreenshot = async (patch: Pick<Partial<Mark>, 'content' | 'desc' | 'url'>) => {
      const current = await getMarkById(savedMark.id)
      if (!current || current.deleted) return

      // A user may have edited or moved this record while recognition was running.
      await updateMark({
        ...current,
        ...patch,
        content: patch.content !== undefined && current.content !== savedMark.content
          ? current.content
          : patch.content ?? current.content,
        desc: patch.desc !== undefined && current.desc !== savedMark.desc
          ? current.desc
          : patch.desc ?? current.desc,
      })
      await fetchMarks()
    }

    try {
      if (enableRecognition) {
        try {
          const result = await recognizeImageWithFallback({
            imagePath: `${SCREENSHOT_DIR}/${filename}`,
            base64: `data:image/png;base64,${bytesToBase64(bytes)}`,
            shouldGenerateDescription,
            onProgress: stage => {
              setQueue(queueId, { progress: getImageRecognitionProgressText(t, stage) })
            },
          })
          await updateSavedScreenshot({
            content: result.content,
            desc: result.desc || result.content || t('record.capture.screenshotNoText'),
          })
          toast({ title: t('record.capture.screenshotRecognitionComplete') })
        } catch (error) {
          console.error('Screenshot recognition failed:', error)
          await updateSavedScreenshot({ desc: t('record.capture.screenshotRecognitionFailed') })
          toast({
            title: t('record.capture.screenshotRecognitionFailed'),
            variant: 'destructive',
          })
        }
      }

      try {
        setQueue(queueId, { progress: t('record.mark.progress.uploadImage') })
        const hostedUrl = await uploadImage(new File([new Uint8Array(bytes)], filename, { type: 'image/png' }))
        if (hostedUrl) await updateSavedScreenshot({ url: hostedUrl })
      } catch (error) {
        console.error('Failed to upload screenshot to image hosting:', error)
        toast({
          title: t('record.capture.imageUploadFallback'),
          description: t('record.capture.imageUploadFallbackDescription'),
        })
      }
    } catch (error) {
      console.error('Failed to process saved screenshot:', error)
    } finally {
      removeQueue(queueId)
    }
  }, [t])

  const saveScreenshot = useCallback((result: DesktopScreenshotResult): Promise<void> => {
    const existing = savingSessions.get(result.sessionId)
    if (existing) return existing
    if (savedSessions.has(result.sessionId)) {
      return acknowledgeScreenshot(result.sessionId).catch(error => {
        console.error('Failed to acknowledge saved desktop screenshot:', error)
      })
    }

    const save = (async () => {
      const tagId = await getScreenshotSaveTarget(result.sessionId)
      const filename = `${result.sessionId}.png`
      // Read only the native session's result directory, never an event-supplied path.
      const bytes = await readFile(`desktop_screenshot/results/${result.sessionId}.png`, {
        baseDir: BaseDirectory.AppData,
      })
      await mkdir(SCREENSHOT_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
      await writeFile(`${SCREENSHOT_DIR}/${filename}`, bytes, { baseDir: BaseDirectory.AppData })

      const settings = useSettingStore.getState()
      const saved = await insertExternalMark({
        sourceId: `screenshot:${result.sessionId}`,
        tagId,
        type: 'scan',
        content: '',
        url: filename,
        desc: settings.enableImageRecognition ? t('record.capture.screenshotRecognitionPending') : '',
      })

      savedSessions.add(result.sessionId)
      if (savedSessions.size > 200) {
        const oldest = savedSessions.values().next().value
        if (oldest) savedSessions.delete(oldest)
      }

      if (!saved.duplicate) {
        // Both the PNG and record are durable now. Notify before optional OCR,
        // hosting or list refresh, and never notify again during recovery.
        void notifyScreenshotResult({
          title: t('record.capture.desktopScreenshotSavedTitle'),
          body: t('record.capture.desktopScreenshotSavedBody'),
        })
      }

      // A failed acknowledgement must never turn a persisted record into a new insert.
      await acknowledgeScreenshot(result.sessionId).catch(error => {
        console.error('Failed to acknowledge desktop screenshot:', error)
      })

      if (saved.duplicate) return

      void processSavedScreenshot(
        saved.mark,
        bytes,
        filename,
        settings.enableImageRecognition,
        Boolean(settings.primaryModel),
      )

      try {
        await completeRecord({
          markId: saved.mark.id,
          tagId: saved.mark.tagId,
          typeLabel: t('record.mark.type.screenshot'),
          background: true,
        })
      } catch (error) {
        // The record is already durable; a refresh failure must not report a failed save.
        console.error('Failed to refresh saved screenshot:', error)
      }
    })()

    savingSessions.set(result.sessionId, save)
    void save.finally(() => {
      savingSessions.delete(result.sessionId)
    }).catch(() => undefined)
    return save
  }, [completeRecord, processSavedScreenshot, t])

  const acceptResult = useCallback((result: DesktopScreenshotResult): void => {
    if (!isScreenshotResult(result)) return
    if (!readyRef.current) {
      pendingResults.current.set(result.sessionId, result)
      return
    }
    if (savingSessions.has(result.sessionId)) return

    void saveScreenshot(result).catch(async error => {
      console.error('Failed to save desktop screenshot:', error)
      await invoke('fail_pinned_screenshot_record', { sessionId: result.sessionId }).catch(notifyError => {
        console.error('Failed to notify pinned screenshot of record save failure:', notifyError)
      })
      void notifyScreenshotResult({
        title: t('record.capture.screenshotSaveFailed'),
        body: t('record.capture.desktopScreenshotSaveRetry'),
      })
      toast({
        title: t('record.capture.screenshotSaveFailed'),
        description: t('record.capture.desktopScreenshotSaveRetry'),
        variant: 'destructive',
        duration: Infinity,
        action: {
          label: t('record.capture.retry'),
          onClick: () => acceptResult(result),
        },
      })
    })
  }, [saveScreenshot, t])

  const acceptResultRef = useRef(acceptResult)
  const showCaptureErrorRef = useRef(showCaptureError)
  acceptResultRef.current = acceptResult
  showCaptureErrorRef.current = showCaptureError

  useEffect(() => {
    let cancelled = false
    const unlisteners: (() => void)[] = []

    const register = async () => {
      const currentWindow = getCurrentWindow()
      const unlistenResult = await listenTauriEvent<DesktopScreenshotResult>(
        'desktop-screenshot-completed',
        event => acceptResultRef.current(event.payload),
        { kind: 'Window', label: currentWindow.label },
      )
      if (cancelled) {
        unlistenResult()
        return
      }
      unlisteners.push(unlistenResult)

      const unlistenError = await listenTauriEvent<DesktopScreenshotError>(
        'desktop-screenshot-error',
        event => { void showCaptureErrorRef.current(event.payload) },
        { kind: 'Window', label: currentWindow.label },
      )
      if (cancelled) {
        unlistenError()
        return
      }
      unlisteners.push(unlistenError)

      // Listening first closes the gap between fetching pending results and a live completion.
      const pending = await invoke<DesktopScreenshotResult[]>('drain_desktop_screenshot_results')
      if (!cancelled) pending.forEach(result => acceptResultRef.current(result))
    }

    void register().catch(error => {
      console.error('Failed to register desktop screenshot bridge:', error)
    })

    const handleCapture = () => {
      if (!readyRef.current) {
        pendingStart.current = true
        return
      }
      void beginDesktopScreenshot().catch(error => showCaptureErrorRef.current(error))
    }
    emitter.on('desktop-screenshot-trigger', handleCapture)

    return () => {
      cancelled = true
      emitter.off('desktop-screenshot-trigger', handleCapture)
      unlisteners.forEach(unlisten => unlisten())
    }
  }, [])

  useEffect(() => {
    if (!ready) return

    const pending = Array.from(pendingResults.current.values())
    pendingResults.current.clear()
    pending.forEach(result => acceptResultRef.current(result))

    if (pendingStart.current) {
      pendingStart.current = false
      void beginDesktopScreenshot().catch(error => showCaptureErrorRef.current(error))
    }
  }, [ready])

  return null
}
