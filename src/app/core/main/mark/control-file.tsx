import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus } from "lucide-react"
import { useTranslations } from 'next-intl'
import { open } from '@tauri-apps/plugin-dialog';
import useMarkStore from "@/stores/mark";
import { insertMark } from "@/db/marks";
import { useEffect, useCallback } from 'react'
import emitter from '@/lib/emitter'
import { v4 as uuid } from 'uuid'
import { toast } from '@/hooks/use-toast'
import { useRecordCompletion } from './use-record-completion'
import { getDefaultRecordSaveTagId } from '@/lib/record-save-target'
import {
  DocumentParseError,
  getDocumentFileName,
  getDocumentParseMessageKey,
  parseLocalDocument,
} from '@/lib/document-parser'

export function ControlFile() {
  const t = useTranslations();
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

  async function selectFile() {
    const filePath = await open({
      multiple: false,
      directory: false,
    });
    if (!filePath) return

    await readFileByPath(filePath)
  }

  async function saveFileRecord(path: string, desc: string, content: string, tagId: number) {
    const result = await insertMark({
      tagId,
      type: 'file',
      desc,
      content,
      url: path
    })
    const markId = Number(result.lastInsertId || 0) || null
    await completeRecord({
      markId,
      tagId,
      typeLabel: t('record.mark.type.file'),
    })
  }

  async function readFileByPath(path: string) {
    const tagId = await getDefaultRecordSaveTagId()
    const fileName = getDocumentFileName(path)
    const desc = fileName
    let content = ''
    const queueId = uuid()

    try {
      addQueue({ queueId, tagId, progress: t('record.mark.progress.cacheFile'), type: 'file', startTime: Date.now() })
      content = (await parseLocalDocument(path, fileName)).markdown
      setQueue(queueId, { progress: t('record.mark.progress.save') })
    } catch (error) {
      console.error('Document parsing failed:', error)
      const code = error instanceof DocumentParseError ? error.code : 'PARSE_FAILED'
      toast({
        title: t('record.capture.fileUnsupportedSaved'),
        description: t(`record.capture.${getDocumentParseMessageKey(code)}`),
      })
    } finally {
      removeQueue(queueId)
    }

    await saveFileRecord(path, desc, content, tagId)
  }

  return (
    <TooltipButton icon={<FilePlus />} tooltipText={t('record.mark.type.file')} onClick={selectFile} />
  )
}
