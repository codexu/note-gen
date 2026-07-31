'use client'

import { useCallback, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { copyFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'

async function copyMarkdownFilesRecursively(
  sourceDir: string,
  targetDir: string,
  relativePath = ''
): Promise<number> {
  let copiedCount = 0
  const entries = await readDir(sourceDir)

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const sourcePath = await join(sourceDir, entry.name)
    const nextRelativePath = relativePath ? await join(relativePath, entry.name) : entry.name
    const targetPath = await join(targetDir, nextRelativePath)

    if (entry.isDirectory) {
      copiedCount += await copyMarkdownFilesRecursively(sourcePath, targetDir, nextRelativePath)
      continue
    }

    if (!entry.isFile) {
      continue
    }

    const isMarkdown = entry.name.endsWith('.md')
    const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(entry.name)
    if (!isMarkdown && !isImage) {
      continue
    }

    const targetDirectory = relativePath ? await join(targetDir, relativePath) : targetDir
    if (!await exists(targetDirectory)) {
      await mkdir(targetDirectory, { recursive: true })
    }

    await copyFile(sourcePath, targetPath)
    copiedCount++
  }

  return copiedCount
}

export function useMarkdownImport() {
  const [isImporting, setIsImporting] = useState(false)
  const loadFileTree = useArticleStore(state => state.loadFileTree)
  const t = useTranslations('article.file.toolbar')

  const importMarkdown = useCallback(async () => {
    if (isImporting) {
      return
    }

    setIsImporting(true)
    try {
      const selectedPath = await openDialog({
        directory: true,
        multiple: false,
        title: t('importMarkdown'),
      })

      if (!selectedPath || Array.isArray(selectedPath)) {
        return
      }

      const workspace = await getWorkspacePath()
      const targetDir = workspace.isCustom
        ? workspace.path
        : await join(await appDataDir(), 'article')
      const copiedCount = await copyMarkdownFilesRecursively(selectedPath, targetDir)

      await loadFileTree()
      toast({
        title: t('importSuccess'),
        description: t('importSuccessDesc', { count: copiedCount }),
      })
    } catch (error) {
      console.error('Import markdown error:', error)
      toast({
        title: t('importError'),
        description: String(error),
        variant: 'destructive',
      })
    } finally {
      setIsImporting(false)
    }
  }, [isImporting, loadFileTree, t])

  const importNotionZip = useCallback(async () => {
    if (isImporting) {
      return
    }

    setIsImporting(true)
    try {
      const selectedPath = await openDialog({
        multiple: false,
        filters: [{ name: 'Notion Export', extensions: ['zip'] }],
        title: t('importNotion'),
      })

      if (!selectedPath || Array.isArray(selectedPath)) {
        return
      }

      const workspace = await getWorkspacePath()
      const targetDir = workspace.isCustom
        ? workspace.path
        : await join(await appDataDir(), 'article')
      const copiedCount = await invoke<number>('import_notion_zip', {
        zipPath: selectedPath,
        targetDir,
      })

      await loadFileTree()
      toast({
        title: t('importSuccess'),
        description: t('importSuccessDesc', { count: copiedCount }),
      })
    } catch (error) {
      console.error('Import notion zip error:', error)
      toast({
        title: t('importError'),
        description: String(error),
        variant: 'destructive',
      })
    } finally {
      setIsImporting(false)
    }
  }, [isImporting, loadFileTree, t])

  return { isImporting, importMarkdown, importNotionZip }
}
