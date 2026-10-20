'use client'

import { useCallback, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { copyFile, exists, mkdir, readDir, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import { getDocumentFileName, parseLocalDocument } from '@/lib/document-parser'

export const DOCUMENT_TO_MARKDOWN_EXTENSIONS = [
  'doc', 'docx', 'docm',
  'ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm',
  'xls', 'xlsx', 'xlsm', 'xlsb',
  'odt', 'ods', 'odp',
  'rtf', 'epub', 'csv', 'pdf',
]

function markdownNameFromDocumentName(fileName: string) {
  const extensionIndex = fileName.lastIndexOf('.')
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  return `${baseName || 'document'}.md`
}

async function getAvailableMarkdownPath(targetDir: string, fileName: string) {
  const markdownName = markdownNameFromDocumentName(fileName)
  const baseName = markdownName.slice(0, -3)
  let candidate = await join(targetDir, markdownName)
  let suffix = 1

  while (await exists(candidate)) {
    candidate = await join(targetDir, `${baseName} (${suffix}).md`)
    suffix += 1
  }

  return candidate
}

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

  const convertDocumentsToMarkdown = useCallback(async () => {
    if (isImporting) {
      return
    }

    setIsImporting(true)
    try {
      const selected = await openDialog({
        multiple: true,
        directory: false,
        filters: [{
          name: t('convertFileType'),
          extensions: DOCUMENT_TO_MARKDOWN_EXTENSIONS,
        }],
        title: t('convertDialogTitle'),
      })

      if (!selected) {
        return
      }

      const selectedPaths = Array.isArray(selected) ? selected : [selected]
      const workspace = await getWorkspacePath()
      const targetDir = workspace.isCustom
        ? workspace.path
        : await join(await appDataDir(), 'article')
      let convertedCount = 0
      const failures: string[] = []

      for (const sourcePath of selectedPaths) {
        const fileName = getDocumentFileName(sourcePath)
        try {
          const parsed = await parseLocalDocument(sourcePath, fileName)
          const targetPath = await getAvailableMarkdownPath(targetDir, fileName)
          await writeTextFile(targetPath, parsed.markdown)
          convertedCount += 1
        } catch (error) {
          console.error(`Convert document to Markdown failed: ${fileName}`, error)
          failures.push(fileName)
        }
      }

      if (convertedCount > 0) {
        await loadFileTree()
        toast({
          title: t('convertSuccess'),
          description: failures.length > 0
            ? t('convertPartialDesc', { success: convertedCount, failed: failures.length })
            : t('convertSuccessDesc', { count: convertedCount }),
        })
      } else if (failures.length > 0) {
        toast({
          title: t('convertError'),
          description: failures.join(', '),
          variant: 'destructive',
        })
      }
    } catch (error) {
      console.error('Convert documents to Markdown error:', error)
      toast({
        title: t('convertError'),
        description: String(error),
        variant: 'destructive',
      })
    } finally {
      setIsImporting(false)
    }
  }, [isImporting, loadFileTree, t])

  return { isImporting, importMarkdown, importNotionZip, convertDocumentsToMarkdown }
}
