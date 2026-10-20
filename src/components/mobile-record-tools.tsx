'use client'

import { SimpleMobileTool } from '@/components/simple-mobile-tool'
import emitter from '@/lib/emitter'
import { exists, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import { useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'
import { useTranslations } from 'next-intl'
import { Separator } from '@/components/ui/separator'
import useRecordingStore from '@/stores/recording'
import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'

interface MobileRecordToolsProps {
  onClose?: () => void
  onOrganize?: () => void
}

export function MobileRecordTools({ onClose, onOrganize }: MobileRecordToolsProps) {
  const router = useRouter()
  const t = useTranslations()
  const { loadFileTree, setActiveFilePath } = useArticleStore()
  const { isRecording } = useRecordingStore()

  const recordTools = [
    { id: 'text' },
    { id: 'recording' },
    { id: 'image' },
    { id: 'link' },
    { id: 'file' },
    { id: 'todo' },
  ]

  const createQuickWriteFile = async () => {
    let index = 0
    let fileName = 'untitled.md'

    while (true) {
      const pathOptions = await getFilePathOptions(fileName)
      const fileExists = pathOptions.baseDir
        ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        : await exists(pathOptions.path)
      if (!fileExists) break

      index += 1
      fileName = `untitled-${index}.md`
    }

    const pathOptions = await getFilePathOptions(fileName)
    if (pathOptions.baseDir) {
      await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
    } else {
      await writeTextFile(pathOptions.path, '')
    }

    return fileName
  }

  const handleQuickWrite = async () => {
    try {
      if (!await prepareActiveEditorDeactivationDurably(
        useArticleStore.getState().activeFilePath,
      )) {
        return
      }
      const fileName = await createQuickWriteFile()
      await loadFileTree()
      await setActiveFilePath(
        fileName,
        true,
        { deactivationAlreadyPrepared: true },
      )
      router.push('/mobile/writing')
      onClose?.()
    } catch {
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      })
    }
  }

  const handleToolClick = async (toolId: string) => {
    if (toolId === 'write') {
      await handleQuickWrite()
      return
    }

    if (toolId === 'organize') {
      onOrganize?.()
      return
    }

    // 发射工具快捷键事件
    emitter.emit(`toolbar-shortcut-${toolId}` as any)
    // 点击后关闭弹窗
    if (onClose) {
      onClose()
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-xs font-medium text-[hsl(var(--component-inactive-color))]">{t('navigation.write')}</span>
        <Separator className="flex-1 bg-border/60" />
      </div>
      <div className="grid w-full grid-cols-2 gap-1.5">
        <SimpleMobileTool
          toolId="write"
          label={t('navigation.files')}
          onToolClick={handleToolClick}
        />
        <SimpleMobileTool
          toolId="organize"
          onToolClick={handleToolClick}
        />
      </div>
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-xs font-medium text-[hsl(var(--component-inactive-color))]">{t('navigation.record')}</span>
        <Separator className="flex-1 bg-border/60" />
      </div>
      <div className="grid w-full grid-cols-2 gap-1.5">
        {recordTools.map((tool) => (
          <SimpleMobileTool
            key={tool.id}
            toolId={tool.id}
            onToolClick={handleToolClick}
            active={tool.id === 'recording' && isRecording}
            label={tool.id === 'recording' && isRecording ? t('recording.recording') : undefined}
          />
        ))}
      </div>
    </div>
  )
}
