'use client'

import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus } from "lucide-react"
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs'
import { platform } from '@tauri-apps/plugin-os'
import useMarkStore from "@/stores/mark";
import { insertAndroidMarkdownMark, insertMark } from "@/db/marks";
import { useEffect, useCallback, useLayoutEffect, useRef } from 'react'
import emitter from '@/lib/emitter'
import { v4 as uuid, v5 as uuidv5 } from 'uuid'
import { toast } from '@/hooks/use-toast'
import { useRecordCompletion } from './use-record-completion'
import { getDefaultRecordSaveTagId } from '@/lib/record-save-target'
import { listenTauriEvent } from '@/lib/tauri-event-listener'
import {
  DocumentParseError,
  getDocumentFileName,
  getDocumentParseMessageKey,
  parseLocalDocument,
} from '@/lib/document-parser'

interface AndroidMarkdownFile {
  path: string
  name: string
}

export function ControlFile({ androidImportReady = false }: { androidImportReady?: boolean }) {
  const t = useTranslations();
  const router = useRouter()
  const { addQueue, setQueue, removeQueue } = useMarkStore()
  const completeRecord = useRecordCompletion()

  const handleSelectFile = useCallback(() => {
    selectFile()
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-file', handleSelectFile)
    return () => {
      emitter.off('toolbar-shortcut-file', handleSelectFile)
    }
  }, [handleSelectFile])

  function showImportError(error: unknown) {
    const description = error instanceof DocumentParseError
      ? t(`record.capture.${getDocumentParseMessageKey(error.code)}`)
      : error instanceof Error ? error.message : String(error)
    toast({ title: t('common.error'), description, variant: 'destructive' })
  }

  const androidImportHandlers = useRef({ showImportError, readFileByPath })
  useLayoutEffect(() => {
    androidImportHandlers.current = { showImportError, readFileByPath }
  })

  useEffect(() => {
    if (!androidImportReady || platform() !== 'android') return

    let disposed = false
    let unlisten: (() => void) | undefined
    let draining = false
    let pending = false

    async function drain() {
      pending = true
      if (draining || disposed) return
      draining = true
      try {
        while (pending && !disposed) {
          pending = false
          const files = await invoke<AndroidMarkdownFile[]>('take_android_markdown_files').catch(error => {
            androidImportHandlers.current.showImportError(error)
            return []
          })
          for (const file of files) {
            try {
              await androidImportHandlers.current.readFileByPath(file.path, file.name, true)
            } catch (error) {
              androidImportHandlers.current.showImportError(error)
            }
          }
        }
      } finally {
        draining = false
      }
    }

    // The native queue retains the launch intent until the listener and database are ready.
    void listenTauriEvent('android-markdown-files-ready', () => { void drain() }).then(stop => {
      if (disposed) {
        stop()
        return
      }
      unlisten = stop
      void drain()
    }).catch(error => androidImportHandlers.current.showImportError(error))

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [androidImportReady])

  async function selectFile() {
    try {
      const file = platform() === 'android'
        ? await invoke<{ path: string | null; name: string | null }>('pick_android_record_file')
        : { path: await open({ multiple: false, directory: false }), name: null }
      if (file.path) await readFileByPath(file.path, file.name)
    } catch (error) {
      toast({ title: t('common.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    }
  }

  async function saveFileRecord(path: string, desc: string, content: string, tagId: number, externalMarkdown: boolean) {
    const mark = {
      tagId,
      type: 'file' as const,
      desc,
      content,
      url: path
    }
    let markId: number | null
    if (externalMarkdown) {
      const sourceId = uuidv5(JSON.stringify(['android-markdown', path, content]), uuidv5.URL)
      const saved = await insertAndroidMarkdownMark({ ...mark, sourceId })
      if (saved.duplicate) {
        router.push(`/mobile/record/detail?id=${saved.mark.id}`)
        return
      }
      markId = saved.mark.id
    } else {
      const result = await insertMark(mark)
      markId = Number(result.lastInsertId || 0) || null
    }
    await completeRecord({
      markId,
      tagId,
      typeLabel: t('record.mark.type.file'),
    })
  }

  async function readFileByPath(path: string, name: string | null, externalMarkdown = false) {
    const tagId = await getDefaultRecordSaveTagId()
    const fileName = name || getDocumentFileName(path)
    const desc = fileName
    let content = ''
    const queueId = uuid()

    try {
      addQueue({ queueId, tagId, progress: t('record.mark.progress.cacheFile'), type: 'file', startTime: Date.now() })
      content = externalMarkdown ? await readTextFile(path) : (await parseLocalDocument(path, fileName)).markdown
      setQueue(queueId, { progress: t('record.mark.progress.save') })
    } catch (error) {
      console.error('Document parsing failed:', error)
      if (externalMarkdown) throw new DocumentParseError('READ_FAILED', String(error))
      const code = error instanceof DocumentParseError ? error.code : 'PARSE_FAILED'
      toast({
        title: t('record.capture.fileUnsupportedSaved'),
        description: t(`record.capture.${getDocumentParseMessageKey(code)}`),
      })
    } finally {
      removeQueue(queueId)
    }

    await saveFileRecord(path, desc, content, tagId, externalMarkdown)
  }

  return (
    <TooltipButton icon={<FilePlus />} tooltipText={t('record.mark.type.file')} onClick={selectFile} />
  )
}
