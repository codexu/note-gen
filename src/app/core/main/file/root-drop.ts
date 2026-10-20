import type { BaseDirectory, WriteFileOptions } from '@tauri-apps/plugin-fs'
import { debugSyncPath } from '@/lib/sync/remote-file'

type FilePathOptions = {
  path: string
  baseDir?: BaseDirectory
}

type RootDropDeps = {
  fileName: string
  getFilePathOptions: (relativePath: string) => Promise<FilePathOptions>
  writeTextFile?: (path: string, content: string, options?: WriteFileOptions) => Promise<void>
  writeFile?: (path: string, content: Uint8Array, options?: WriteFileOptions) => Promise<void>
}

type RootDropPayload =
  | {
      kind: 'text'
      content: string
    }
  | {
      kind: 'binary'
      content: Uint8Array
    }

export function sanitizeDroppedFileName(fileName: string) {
  return fileName
}

export async function writeDroppedFileToRoot(deps: RootDropDeps, payload: RootDropPayload) {
  const sanitizedFileName = sanitizeDroppedFileName(deps.fileName)
  debugSyncPath('rootDrop.writeFile', {
    originalFileName: deps.fileName,
    writtenFileName: sanitizedFileName,
  })
  const pathOptions = await deps.getFilePathOptions(sanitizedFileName)

  if (payload.kind === 'text') {
    await deps.writeTextFile?.(pathOptions.path, payload.content, pathOptions.baseDir ? { baseDir: pathOptions.baseDir } : undefined)
  } else {
    await deps.writeFile?.(pathOptions.path, payload.content, pathOptions.baseDir ? { baseDir: pathOptions.baseDir } : undefined)
  }

  return sanitizedFileName
}
