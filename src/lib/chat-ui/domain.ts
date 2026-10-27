import type { Spec } from '@json-render/core'
import { readDir } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { getTags } from '@/db/tags'
import { getChatUiFields } from './catalog'
import type { ChatUiField, ChatUiValues } from './types'

type Option = { label: string; value: string }
export interface ChatUiDomainOptions { notes: Option[]; folders: Option[]; tags: Option[] }

export async function loadChatUiDomainOptions(types?: ChatUiField['type'][]): Promise<ChatUiDomainOptions> {
  const needsFiles = !types || types.some(type => type === 'NotePicker' || type === 'FolderPicker')
  const needsTags = !types || types.includes('TagPicker')
  const result: ChatUiDomainOptions = { notes: [], folders: [{ label: '.', value: '.' }], tags: [] }
  if (needsFiles) {
    let entryCount = 0
    const walk = async (relativePath: string, depth: number): Promise<void> => {
      if (depth > 32) throw new Error('Workspace directory depth exceeds the picker limit.')
      const options = await getFilePathOptions(relativePath)
      const entries = await readDir(options.path, options.baseDir ? { baseDir: options.baseDir } : undefined)
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.isSymlink) continue
        if (++entryCount > 25_000) throw new Error('Workspace is too large for this picker.')
        const path = relativePath ? `${relativePath}/${entry.name}` : entry.name
        if (entry.isDirectory) {
          result.folders.push({ label: path, value: path })
          await walk(path, depth + 1)
        } else if (entry.isFile && entry.name.endsWith('.md')) {
          result.notes.push({ label: path, value: path })
        }
      }
    }
    await walk('', 0)
  }
  if (needsTags) result.tags = (await getTags()).map(tag => ({ label: tag.name, value: String(tag.id) }))
  for (const entries of [result.notes, result.folders, result.tags]) entries.sort((a, b) => a.label.localeCompare(b.label))
  return result
}

export async function validateChatUiDomainValues(spec: Spec, values: ChatUiValues): Promise<Record<string, string>> {
  const fields = getChatUiFields(spec).filter(field => ['NotePicker', 'FolderPicker', 'TagPicker'].includes(field.type))
  if (!fields.length) return {}
  const options = await loadChatUiDomainOptions(fields.map(field => field.type))
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const allowed = new Set((field.type === 'NotePicker' ? options.notes : field.type === 'FolderPicker' ? options.folders : options.tags).map(option => option.value))
    const value = values[field.name]
    const selected = Array.isArray(value) ? value : value ? [value] : []
    if (selected.some(item => !allowed.has(item))) errors[field.name] = 'invalid'
  }
  return errors
}
