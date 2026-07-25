import { open, remove } from '@tauri-apps/plugin-fs'

const COPY_BUFFER_BYTES = 1024 * 1024

interface ExclusiveFileHandle {
  read(buffer: Uint8Array): Promise<number | null>
  write(data: Uint8Array): Promise<number>
  close(): Promise<void>
}

interface ExclusiveFileSystem {
  open(
    path: string,
    options: { read?: boolean; write?: boolean; createNew?: boolean },
  ): Promise<ExclusiveFileHandle>
  remove(path: string): Promise<void>
}

const tauriFileSystem: ExclusiveFileSystem = { open, remove }

export function shouldCleanupExclusiveTarget(createdTarget: boolean, completed: boolean): boolean {
  return createdTarget && !completed
}

export function assertDistinctCopyPaths(sourcePath: string, targetPath: string): void {
  if (sourcePath === targetPath) {
    throw new Error('Refusing to copy a file onto itself')
  }
}

async function writeAll(file: ExclusiveFileHandle, data: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < data.length) {
    const bytesWritten = await file.write(data.subarray(offset))
    if (bytesWritten <= 0) {
      throw new Error('Failed to make progress while writing file')
    }
    offset += bytesWritten
  }
}

export async function copyFileExclusive(
  sourcePath: string,
  targetPath: string,
  fileSystem: ExclusiveFileSystem = tauriFileSystem,
): Promise<void> {
  assertDistinctCopyPaths(sourcePath, targetPath)

  const source = await fileSystem.open(sourcePath, { read: true })
  let target: ExclusiveFileHandle | null = null
  let createdTarget = false
  let completed = false

  try {
    target = await fileSystem.open(targetPath, { write: true, createNew: true })
    createdTarget = true
    const buffer = new Uint8Array(COPY_BUFFER_BYTES)

    while (true) {
      const bytesRead = await source.read(buffer)
      if (bytesRead === null) {
        break
      }
      if (bytesRead > 0) {
        await writeAll(target, buffer.subarray(0, bytesRead))
      }
    }

    await target.close()
    target = null
    completed = true
  } finally {
    await source.close().catch(() => {})
    if (target) {
      await target.close().catch(() => {})
    }
    if (shouldCleanupExclusiveTarget(createdTarget, completed)) {
      await fileSystem.remove(targetPath).catch(() => {})
    }
  }
}

export async function writeTextFileExclusive(
  path: string,
  content: string,
  fileSystem: ExclusiveFileSystem = tauriFileSystem,
): Promise<void> {
  let file: ExclusiveFileHandle | null = null
  let createdTarget = false
  let completed = false

  try {
    file = await fileSystem.open(path, { write: true, createNew: true })
    createdTarget = true
    await writeAll(file, new TextEncoder().encode(content))
    await file.close()
    file = null
    completed = true
  } finally {
    if (file) {
      await file.close().catch(() => {})
    }
    if (shouldCleanupExclusiveTarget(createdTarget, completed)) {
      await fileSystem.remove(path).catch(() => {})
    }
  }
}
