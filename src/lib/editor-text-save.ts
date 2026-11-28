import { exists, readTextFile, writeTextFile, type BaseDirectory } from '@tauri-apps/plugin-fs'

export interface EditorTextSaveState {
  content: string
  recovery?: { path: string; content: string }
}

interface EditorTextPath {
  path: string
  baseDir?: BaseDirectory
}

/** Keep the disk version and write the editor's version to a separate file on conflict. */
export async function saveEditorText(
  target: EditorTextPath,
  content: string,
  state: EditorTextSaveState,
  preserveSeparately = false,
): Promise<string | null> {
  const { path, baseDir } = target
  const options = { baseDir }
  const recovery = state.recovery
  if (recovery) {
    if (await exists(recovery.path, options) && await readTextFile(recovery.path, options) === recovery.content) {
      await writeTextFile(recovery.path, content, options)
      recovery.content = content
      return recovery.path
    }
  } else if (!preserveSeparately && await exists(path, options)) {
    const diskContent = await readTextFile(path, options)
    if (diskContent === state.content || diskContent === content) {
      if (diskContent !== content) await writeTextFile(path, content, options)
      state.content = content
      return null
    }
  }

  const nameOffset = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1
  const extensionOffset = path.lastIndexOf('.')
  const hasExtension = extensionOffset > nameOffset
  const stem = hasExtension ? path.slice(0, extensionOffset) : path
  const extension = hasExtension ? path.slice(extensionOffset) : '.md'
  const suffix = `.conflict-${crypto.randomUUID()}${extension}`
  const preferredName = stem.slice(nameOffset) + suffix
  const recoveryName = new TextEncoder().encode(preferredName).length <= 255
    ? preferredName
    : `notegen-conflict-${crypto.randomUUID()}.md`
  const recoveryPath = path.slice(0, nameOffset) + recoveryName
  await writeTextFile(recoveryPath, content, { ...options, createNew: true })
  state.recovery = { path: recoveryPath, content }
  return recoveryPath
}
