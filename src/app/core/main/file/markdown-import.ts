import { exists, mkdir, readDir, remove } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { copyFileExclusive } from '../../../../lib/fs/exclusive-file.ts'

interface MarkdownImportEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
}

interface MarkdownImportFileSystem {
  readDir(path: string): Promise<MarkdownImportEntry[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  join(...paths: string[]): Promise<string>
  copyFileExclusive(sourcePath: string, targetPath: string): Promise<void>
  removeFile(path: string): Promise<void>
  removeDirectory(path: string): Promise<void>
}

const tauriFileSystem: MarkdownImportFileSystem = {
  readDir,
  exists,
  mkdir: path => mkdir(path, { recursive: true }),
  join,
  copyFileExclusive,
  removeFile: path => remove(path),
  removeDirectory: path => remove(path),
}

interface ImportTransaction {
  files: string[]
  directories: string[]
}

function createImportTransaction(): ImportTransaction {
  return {
    files: [],
    directories: [],
  }
}

async function rollbackImport(
  transaction: ImportTransaction,
  fileSystem: MarkdownImportFileSystem,
): Promise<string[]> {
  const errors: string[] = []

  for (const file of [...transaction.files].reverse()) {
    try {
      await fileSystem.removeFile(file)
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const directory of [...transaction.directories].reverse()) {
    try {
      await fileSystem.removeDirectory(directory)
    } catch (error) {
      errors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return errors
}

async function ensureTargetDirectory(
  targetDir: string,
  relativePath: string,
  transaction: ImportTransaction,
  fileSystem: MarkdownImportFileSystem,
): Promise<void> {
  let currentPath = targetDir
  const segments = relativePath.split(/[\\/]/).filter(Boolean)

  for (const segment of segments) {
    currentPath = await fileSystem.join(currentPath, segment)
    if (await fileSystem.exists(currentPath)) {
      continue
    }

    await fileSystem.mkdir(currentPath)
    transaction.directories.push(currentPath)
  }
}

async function copyRecursively(
  sourceDir: string,
  targetDir: string,
  relativePath: string,
  transaction: ImportTransaction,
  fileSystem: MarkdownImportFileSystem,
): Promise<number> {
  let copiedCount = 0
  const entries = await fileSystem.readDir(sourceDir)

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const sourcePath = await fileSystem.join(sourceDir, entry.name)
    const nextRelativePath = relativePath
      ? await fileSystem.join(relativePath, entry.name)
      : entry.name
    const targetPath = await fileSystem.join(targetDir, nextRelativePath)

    if (entry.isDirectory) {
      copiedCount += await copyRecursively(
        sourcePath,
        targetDir,
        nextRelativePath,
        transaction,
        fileSystem,
      )
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

    await ensureTargetDirectory(targetDir, relativePath, transaction, fileSystem)

    await fileSystem.copyFileExclusive(sourcePath, targetPath)
    transaction.files.push(targetPath)
    copiedCount += 1
  }

  return copiedCount
}

export async function importMarkdownDirectory(
  sourceDir: string,
  targetDir: string,
  fileSystem: MarkdownImportFileSystem = tauriFileSystem,
): Promise<number> {
  const transaction = createImportTransaction()

  try {
    return await copyRecursively(sourceDir, targetDir, '', transaction, fileSystem)
  } catch (error) {
    const rollbackErrors = await rollbackImport(transaction, fileSystem)
    const message = error instanceof Error ? error.message : String(error)
    if (rollbackErrors.length > 0) {
      throw new Error(`${message}; rollback failed: ${rollbackErrors.join(', ')}`)
    }
    throw error
  }
}
