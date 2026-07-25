import fs from 'node:fs/promises'
import path from 'node:path'
import { open as fsOpen } from 'node:fs/promises'

async function toDirEntry(entryPath, name) {
  const stats = await fs.lstat(entryPath)
  return {
    name,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    isSymlink: stats.isSymbolicLink(),
  }
}

function createReadWriteHandle(fileHandle) {
  return {
    async read(buffer) {
      const result = await fileHandle.read(buffer, 0, buffer.length)
      if (result.bytesRead === 0) {
        return null
      }
      return result.bytesRead
    },
    async write(data) {
      const result = await fileHandle.write(data)
      return result.bytesWritten
    },
    async close() {
      await fileHandle.close()
    },
  }
}

export async function exists(targetPath) {
  try {
    await fs.lstat(targetPath)
    return true
  } catch {
    return false
  }
}

export async function lstat(targetPath) {
  const stats = await fs.lstat(targetPath)
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink: stats.isSymbolicLink(),
    size: stats.size,
  }
}

export async function stat(targetPath) {
  return lstat(targetPath)
}

export async function mkdir(targetPath, options = {}) {
  await fs.mkdir(targetPath, { recursive: Boolean(options.recursive) })
}

export async function readDir(targetPath) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  return Promise.all(entries.map(entry => toDirEntry(path.join(targetPath, entry.name), entry.name)))
}

export async function readTextFile(targetPath) {
  return fs.readFile(targetPath, 'utf8')
}

export async function remove(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true })
}

export async function open(targetPath, options = {}) {
  const flag = options.createNew ? 'wx' : options.write ? 'w' : 'r'
  const fileHandle = await fsOpen(targetPath, flag)
  return createReadWriteHandle(fileHandle)
}
