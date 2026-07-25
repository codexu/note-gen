import {
  exists,
  lstat,
  mkdir,
  readDir,
  readTextFile,
  remove,
  stat,
} from '@tauri-apps/plugin-fs'
import { basename, dirname, join } from '@tauri-apps/api/path'
import { copyFileExclusive, writeTextFileExclusive } from '@/lib/fs/exclusive-file'
import { resolveSiYuanArchiveRootFromEntries } from './archive-root'
import { ImportBudgetTracker, SyImportAbortedError, SyImportBudgetExceededError, throwIfAborted } from './budgets'
import { loadAttributeViews } from './av-loader'
import { buildBlockIndex } from './block-index'
import { convertSyDocumentToMarkdown } from './converter'
import {
  classifyDocumentStatus,
  mergeImportIssues,
  scanDocumentIssues,
  scanMarkdownIssues,
} from './scan-import-issues'
import type {
  BlockRefTarget,
  SyDocument,
  SyDocumentPlan,
  SyImportDocumentReport,
  SyImportOptions,
  SyImportProgress,
  SyImportResult,
} from './types'
import { getWritingAssetsDirName } from '@/lib/writing-assets-path'
import {
  getImportedAssetRelativePath,
  getNoteGenAssetOutputDir,
  ImportPathAllocator,
  isDocumentId,
  parseSiYuanAssetReference,
  sanitizeFileName,
} from './utils'
import { parseAndValidateSiYuanDocument } from './validation'
import {
  assertDiscoveredDocumentsScheduled,
  countImportableSyDocuments,
  countRootLevelSyFiles,
  listVerifiedNotebookDirectories,
} from './document-discovery'

import { buildImportResult } from './import-result'

const MAX_SY_DOCUMENT_BYTES = 64 * 1024 * 1024

function shouldAbortImportPlanning(error: unknown): error is SyImportAbortedError | SyImportBudgetExceededError {
  return error instanceof SyImportAbortedError || error instanceof SyImportBudgetExceededError
}

async function yieldToUi(index: number) {
  if (index % 5 === 0) {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0)
    })
  }
}

function emitProgress(onProgress: SyImportOptions['onProgress'], progress: SyImportProgress) {
  onProgress?.(progress)
}

async function readNotebookName(notebookDir: string, notebookId: string): Promise<string> {
  const confPath = await join(notebookDir, '.siyuan', 'conf.json')

  if (await exists(confPath)) {
    try {
      const fileInfo = await lstat(confPath)
      if (!fileInfo.isFile || fileInfo.isSymlink) {
        throw new Error('Invalid SiYuan notebook configuration')
      }
      const conf = JSON.parse(await readTextFile(confPath)) as { name?: string }
      if (conf.name?.trim()) {
        return sanitizeFileName(conf.name, notebookId)
      }
    } catch {
      // fall through
    }
  }

  return sanitizeFileName(notebookId, notebookId)
}

async function parseSyDocument(syPath: string): Promise<{ document: SyDocument; byteSize: number }> {
  const fileInfo = await stat(syPath)
  if (!fileInfo.isFile || fileInfo.size > MAX_SY_DOCUMENT_BYTES) {
    throw new Error(`Invalid or oversized SiYuan document: ${syPath}`)
  }

  const content = await readTextFile(syPath)
  return {
    document: parseAndValidateSiYuanDocument(content, syPath),
    byteSize: fileInfo.size,
  }
}

async function planDirectoryDocuments(
  dirPath: string,
  parentRelativePath: string,
  assetsDirName: string,
  allocator: ImportPathAllocator,
  plans: SyDocumentPlan[],
  failedReports: SyImportDocumentReport[],
  budget: ImportBudgetTracker,
  signal?: AbortSignal,
  onProgress?: SyImportOptions['onProgress'],
  progressState?: { current: number; total: number },
): Promise<void> {
  throwIfAborted(signal)
  const entries = await readDir(dirPath)

  for (const entry of entries) {
    throwIfAborted(signal)
    if (entry.name.startsWith('.')) {
      continue
    }

    const entryPath = await join(dirPath, entry.name)

    if (!entry.isFile || !entry.name.endsWith('.sy')) {
      continue
    }

    const fileId = entry.name.replace(/\.sy$/, '')
    let currentTitle = fileId
    let fileName = sanitizeFileName(fileId, 'untitled')
    let childDirPath: string | null = null
    let childDirRelativePath: string | null = null

    try {
      if (!isDocumentId(fileId)) {
        throw new Error(`Invalid SiYuan document filename: ${entry.name}`)
      }

      const { document, byteSize } = await parseSyDocument(entryPath)
      budget.trackDocument(document, byteSize)
      if (document.ID !== fileId) {
        throw new Error(`SiYuan document ID does not match filename: ${entry.name}`)
      }

      currentTitle = document.Properties?.title ?? document.ID
      fileName = sanitizeFileName(currentTitle, document.ID)

      const childDir = await join(dirPath, fileId)
      if (await exists(childDir)) {
        const childInfo = await lstat(childDir)
        if (childInfo.isDirectory && !childInfo.isSymlink) {
          childDirPath = childDir
          childDirRelativePath = allocator.allocateRelativeDir(parentRelativePath, fileName)
        }
      }

      const mdParentRelativePath = childDirRelativePath ?? parentRelativePath
      const mdRelativePath = allocator.allocateRelativeFile(mdParentRelativePath, `${fileName}.md`)
      const assetOutputDir = getNoteGenAssetOutputDir(mdRelativePath, assetsDirName)

      plans.push({
        syPath: entryPath,
        mdAbsolutePath: allocator.toAbsolutePath(mdRelativePath),
        mdRelativePath,
        title: currentTitle,
        documentId: document.ID,
        assetOutputDir,
      })
    } catch (error) {
      if (shouldAbortImportPlanning(error)) {
        throw error
      }
      failedReports.push({
        title: currentTitle,
        syPath: entryPath,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        issues: [],
      })
    }

    if (progressState) {
      progressState.current += 1
      emitProgress(onProgress, {
        phase: 'planning',
        current: progressState.current,
        total: progressState.total,
        currentTitle,
      })
      await yieldToUi(progressState.current)
    }

    if (!isDocumentId(fileId)) {
      continue
    }

    if (childDirPath && childDirRelativePath) {
      await planDirectoryDocuments(
        childDirPath,
        childDirRelativePath,
        assetsDirName,
        allocator,
        plans,
        failedReports,
        budget,
        signal,
        onProgress,
        progressState,
      )
    }
  }
}

async function planNotebook(
  notebookDir: string,
  assetsDirName: string,
  allocator: ImportPathAllocator,
  plans: SyDocumentPlan[],
  failedReports: SyImportDocumentReport[],
  budget: ImportBudgetTracker,
  signal?: AbortSignal,
  onProgress?: SyImportOptions['onProgress'],
  progressState?: { current: number; total: number },
): Promise<void> {
  const notebookId = await basename(notebookDir)
  const notebookName = await readNotebookName(notebookDir, notebookId)
  const notebookRelativePath = allocator.allocateRelativeDir('', notebookName)
  await planDirectoryDocuments(
    notebookDir,
    notebookRelativePath,
    assetsDirName,
    allocator,
    plans,
    failedReports,
    budget,
    signal,
    onProgress,
    progressState,
  )
}

async function resolveRegularFileUnderRoot(
  root: string,
  relativePath: string,
): Promise<string | null> {
  let currentPath = root
  const segments = relativePath.replace(/\\/g, '/').split('/')

  for (let index = 0; index < segments.length; index += 1) {
    currentPath = await join(currentPath, segments[index])
    if (!await exists(currentPath)) {
      return null
    }

    const pathInfo = await lstat(currentPath)
    if (pathInfo.isSymlink) {
      return null
    }
    const isLastSegment = index === segments.length - 1
    if ((isLastSegment && !pathInfo.isFile) || (!isLastSegment && !pathInfo.isDirectory)) {
      return null
    }
  }

  return currentPath
}

async function copyAssetIfNeeded(
  assetPath: string,
  dataRoot: string,
  targetDir: string,
  assetOutputDir: string,
  copiedAssets: Set<string>,
): Promise<'copied' | 'already_copied' | 'missing'> {
  const copyKey = `${assetOutputDir}::${assetPath}`
  if (copiedAssets.has(copyKey)) {
    return 'already_copied'
  }

  const assetReference = parseSiYuanAssetReference(assetPath)
  if (!assetReference || assetReference.sourcePath !== assetPath) {
    throw new Error(`Unsafe SiYuan asset path rejected: ${assetPath}`)
  }

  const sourcePath = await resolveRegularFileUnderRoot(dataRoot, assetReference.sourcePath)
  if (!sourcePath) {
    return 'missing'
  }

  const targetRelativePath = getImportedAssetRelativePath(
    assetReference.sourcePath,
    assetOutputDir,
  )
  const targetPath = await join(targetDir, targetRelativePath)
  const targetParent = await dirname(targetPath)
  if (!await exists(targetParent)) {
    await mkdir(targetParent, { recursive: true })
  }

  try {
    await copyFileExclusive(sourcePath, targetPath)
  } catch (error) {
    throw new Error(
      `Failed to create imported asset without overwriting ${targetRelativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  copiedAssets.add(copyKey)
  return 'copied'
}

async function rollbackWrittenMarkdown(paths: string[]): Promise<void> {
  for (const filePath of [...paths].reverse()) {
    try {
      await remove(filePath)
    } catch {
      // Best-effort cleanup after cancellation.
    }
  }
}

async function rollbackCopiedAssets(
  assetCopyKeys: string[],
  targetDir: string,
  copiedAssets: Set<string>,
): Promise<{ removedCount: number; errors: string[] }> {
  const cleanupErrors: string[] = []
  let removedCount = 0

  for (const copyKey of [...assetCopyKeys].reverse()) {
    const separatorIndex = copyKey.indexOf('::')
    if (separatorIndex <= 0) {
      continue
    }
    const assetOutputDir = copyKey.slice(0, separatorIndex)
    const assetPath = copyKey.slice(separatorIndex + 2)
    const targetRelativePath = getImportedAssetRelativePath(assetPath, assetOutputDir)
    const targetPath = await join(targetDir, targetRelativePath)
    try {
      await remove(targetPath)
      copiedAssets.delete(copyKey)
      removedCount += 1
    } catch (error) {
      cleanupErrors.push(
        `${targetRelativePath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return { removedCount, errors: cleanupErrors }
}

interface CollectedImportPlans {
  plans: SyDocumentPlan[]
  failedReports: SyImportDocumentReport[]
  notebookCount: number
  discoveredDocumentCount: number
}

async function createImportPathAllocator(targetDir: string): Promise<ImportPathAllocator> {
  const allocator = new ImportPathAllocator(targetDir)
  if (!await exists(targetDir)) {
    return allocator
  }

  for (const entry of await readDir(targetDir)) {
    allocator.reserveRelativePath(entry.name)
  }
  return allocator
}

async function collectImportPlans(
  dataRoot: string,
  targetDir: string,
  assetsDirName: string,
  signal?: AbortSignal,
  onProgress?: SyImportOptions['onProgress'],
): Promise<CollectedImportPlans> {
  throwIfAborted(signal)
  const allocator = await createImportPathAllocator(targetDir)
  const plans: SyDocumentPlan[] = []
  const failedReports: SyImportDocumentReport[] = []
  const budget = new ImportBudgetTracker()

  const notebookDirs = await listVerifiedNotebookDirectories(dataRoot)
  const rootSyFileCount = await countRootLevelSyFiles(dataRoot)
  const discoveredDocumentCount = await countImportableSyDocuments(dataRoot)
  const estimatedTotal = Math.max(discoveredDocumentCount, 1)

  emitProgress(onProgress, { phase: 'planning', current: 0, total: estimatedTotal })
  const progressState = { current: 0, total: estimatedTotal }

  for (const notebookDir of notebookDirs) {
    throwIfAborted(signal)
    await planNotebook(
      notebookDir,
      assetsDirName,
      allocator,
      plans,
      failedReports,
      budget,
      signal,
      onProgress,
      progressState,
    )
  }

  if (rootSyFileCount > 0) {
    throwIfAborted(signal)
    const archiveName = sanitizeFileName(await basename(dataRoot), 'SiYuan Import')
    const importRelativePath = allocator.allocateRelativeDir('', archiveName)
    await planDirectoryDocuments(
      dataRoot,
      importRelativePath,
      assetsDirName,
      allocator,
      plans,
      failedReports,
      budget,
      signal,
      onProgress,
      progressState,
    )
  }

  if (notebookDirs.length === 0 && rootSyFileCount === 0) {
    throw new Error('No SiYuan notebooks found in the selected directory.')
  }

  assertDiscoveredDocumentsScheduled(discoveredDocumentCount, plans.length, failedReports.length)

  const notebookCount = notebookDirs.length > 0
    ? notebookDirs.length
    : rootSyFileCount > 0
      ? 1
      : 0

  return {
    plans,
    failedReports,
    notebookCount,
    discoveredDocumentCount,
  }
}

export async function resolveSiYuanArchiveRoot(extractedDirectory: string): Promise<string> {
  const entries = await readDir(extractedDirectory)
  const archiveRoot = await resolveSiYuanArchiveRootFromEntries(
    entries,
    extractedDirectory,
    join,
  )
  const archiveRootInfo = await lstat(archiveRoot)
  if (!archiveRootInfo.isDirectory || archiveRootInfo.isSymlink) {
    throw new Error('Invalid SiYuan .sy.zip archive root.')
  }

  return archiveRoot
}

export async function importSiYuanData(options: SyImportOptions): Promise<SyImportResult> {
  const writtenMarkdownPaths: string[] = []
  const copiedAssets = new Set<string>()
  const assetsDirName = getWritingAssetsDirName(options.assetsDirName)
  let targetDir = options.targetDir

  try {
    const {
      plans,
      failedReports,
      notebookCount,
      discoveredDocumentCount,
    } = await collectImportPlans(
      options.dataRoot,
      options.targetDir,
      assetsDirName,
      options.signal,
      options.onProgress,
    )
    targetDir = options.targetDir

    throwIfAborted(options.signal)

    emitProgress(options.onProgress, {
      phase: 'loading_av',
      current: 0,
      total: plans.length,
    })
    const attributeViews = await loadAttributeViews(options.dataRoot, options.signal)

    throwIfAborted(options.signal)

    emitProgress(options.onProgress, {
      phase: 'indexing',
      current: 0,
      total: plans.length,
    })
    const blockIndex = new Map<string, BlockRefTarget>()

    for (let index = 0; index < plans.length; index += 1) {
      throwIfAborted(options.signal)
      const plan = plans[index]
      const { document } = await parseSyDocument(plan.syPath)

      const partialIndex = buildBlockIndex([{
        document,
        mdRelativePath: plan.mdRelativePath,
      }])
      for (const [blockId, target] of partialIndex) {
        blockIndex.set(blockId, target)
      }

      emitProgress(options.onProgress, {
        phase: 'indexing',
        current: index + 1,
        total: plans.length,
        currentTitle: plan.title,
      })
      await yieldToUi(index)
    }

    let assetCount = 0
    const documentReports: SyImportDocumentReport[] = [...failedReports]

    for (let index = 0; index < plans.length; index += 1) {
      throwIfAborted(options.signal)
      const plan = plans[index]
      const title = plan.title
      const newlyCopiedAssetKeys: string[] = []

      emitProgress(options.onProgress, {
        phase: 'importing',
        current: index + 1,
        total: plans.length,
        currentTitle: title,
      })

      try {
        const { document } = await parseSyDocument(plan.syPath)
        const parentDir = await dirname(plan.mdAbsolutePath)
        if (!await exists(parentDir)) {
          await mkdir(parentDir, { recursive: true })
        }

        const converted = convertSyDocumentToMarkdown(document, {
          blockIndex,
          attributeViews,
          currentMdPath: plan.mdRelativePath,
          assetOutputDir: plan.assetOutputDir,
        })

        const missingAssets: string[] = []
        for (const assetPath of converted.assetPaths) {
          const copyKey = `${plan.assetOutputDir}::${assetPath}`
          const copyResult = await copyAssetIfNeeded(
            assetPath,
            options.dataRoot,
            options.targetDir,
            plan.assetOutputDir,
            copiedAssets,
          )
          if (copyResult === 'copied') {
            assetCount += 1
            newlyCopiedAssetKeys.push(copyKey)
          } else if (copyResult === 'missing') {
            missingAssets.push(assetPath)
          }
        }

        const issues = mergeImportIssues(
          scanDocumentIssues(document, { blockIndex, attributeViews }),
          scanMarkdownIssues(
            converted.markdown,
            missingAssets,
            converted.invalidAssetPaths,
          ),
          converted.importIssues,
        )
        const status = classifyDocumentStatus(issues, false)

        try {
          await writeTextFileExclusive(plan.mdAbsolutePath, converted.markdown)
          writtenMarkdownPaths.push(plan.mdAbsolutePath)
        } catch (error) {
          throw new Error(
            `Failed to create imported note without overwriting ${plan.mdRelativePath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }

        documentReports.push({
          title,
          syPath: plan.syPath,
          mdRelativePath: plan.mdRelativePath,
          status,
          issues,
        })
      } catch (error) {
        const rollback = await rollbackCopiedAssets(
          newlyCopiedAssetKeys,
          options.targetDir,
          copiedAssets,
        )
        assetCount -= rollback.removedCount
        const errorMessage = error instanceof Error ? error.message : String(error)
        documentReports.push({
          title,
          syPath: plan.syPath,
          mdRelativePath: plan.mdRelativePath,
          status: 'failed',
          errorMessage: rollback.errors.length > 0
            ? `${errorMessage}; asset cleanup failed: ${rollback.errors.join(', ')}`
            : errorMessage,
          issues: [],
        })
      }

      await yieldToUi(index)
    }

    emitProgress(options.onProgress, {
      phase: 'done',
      current: documentReports.length,
      total: documentReports.length,
    })

    const result = buildImportResult(
      documentReports,
      assetCount,
      notebookCount,
      discoveredDocumentCount,
    )
    if (result.omittedDocumentCount > 0) {
      throw new Error(
        `SiYuan import omitted ${result.omittedDocumentCount} document(s) from the result report`,
      )
    }
    if (result.totalDocuments !== discoveredDocumentCount) {
      throw new Error(
        `SiYuan import document accounting mismatch: discovered ${discoveredDocumentCount}, `
        + `reported ${result.totalDocuments}`,
      )
    }
    return result
  } catch (error) {
    if (error instanceof SyImportAbortedError) {
      await rollbackWrittenMarkdown(writtenMarkdownPaths)
      if (copiedAssets.size > 0) {
        await rollbackCopiedAssets([...copiedAssets], targetDir, copiedAssets)
      }
    }
    throw error
  }
}
