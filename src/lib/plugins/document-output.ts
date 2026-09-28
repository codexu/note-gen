import { PluginError, PLUGIN_DOCUMENT_LIMITS, validatePluginClipboardContent, validatePluginExportFileOptions, type PluginClipboardContent, type PluginExportFileOptions, type PluginExportFileResult } from '@notegen/plugin-api'
import { writeHtml, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { checkIsTauri } from '@/lib/check'
import { buildPluginHtmlFile, getPluginDocument, limitDocumentText, sanitizeDocumentHtml } from './documents'
import { requirePluginUserAction } from './user-actions'
import { platform } from '@tauri-apps/plugin-os'

const exportDialogs = new Set<AbortSignal>()
export function isPluginExportDialogOpen(owner: AbortSignal): boolean { return exportDialogs.has(owner) }

export async function writePluginClipboard(pluginId: string, owner: AbortSignal, content: PluginClipboardContent, guard: () => Promise<void>): Promise<void> {
  requirePluginUserAction(pluginId)
  content = validatePluginClipboardContent(content)
  const resolved = 'documentId' in content ? getPluginDocument(pluginId, content.documentId, owner) : content
  limitDocumentText(resolved.text)
  const html = resolved.html === undefined ? undefined : sanitizeDocumentHtml(resolved.html)
  await guard()
  requirePluginUserAction(pluginId)
  if (checkIsTauri()) {
    if (html !== undefined && ['ios', 'android'].includes(platform())) throw new PluginError('UnavailableOnPlatform', 'Rich-text clipboard is only supported on desktop')
    await guard()
    if (html === undefined) await writeText(resolved.text)
    else await writeHtml(html, resolved.text)
  } else {
    if (!navigator.clipboard) throw new PluginError('UnavailableOnPlatform', 'Clipboard is unavailable')
    if (html === undefined) await navigator.clipboard.writeText(resolved.text)
    else if (typeof ClipboardItem !== 'undefined') await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([resolved.text], { type: 'text/plain' }) })])
    else throw new PluginError('UnavailableOnPlatform', 'Rich-text clipboard is unavailable')
  }
}

export async function exportPluginFile(pluginId: string, owner: AbortSignal, options: PluginExportFileOptions, guard: () => Promise<void>): Promise<PluginExportFileResult> {
  requirePluginUserAction(pluginId)
  options = validatePluginExportFileOptions(options)
  let bytes: Uint8Array
  if ('documentId' in options) {
    bytes = new TextEncoder().encode(buildPluginHtmlFile(getPluginDocument(pluginId, options.documentId, owner)))
  } else {
    if (typeof options.mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(options.mimeType)) throw new PluginError('InvalidPath', 'Invalid export MIME type')
    if ('text' in options) { limitDocumentText(options.text, PLUGIN_DOCUMENT_LIMITS.exportBytes); bytes = new TextEncoder().encode(options.text) }
    else {
      limitDocumentText(options.base64, 1400 * 1024)
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(options.base64)) throw new PluginError('InvalidPath', 'Invalid base64 file')
      bytes = Uint8Array.from(atob(options.base64), char => char.charCodeAt(0))
    }
  }
  if (bytes.length > 1024 * 1024) throw new PluginError('QuotaExceeded', 'Export is limited to 1 MiB')
  await guard()
  requirePluginUserAction(pluginId)
  if (checkIsTauri()) {
    if (['ios', 'android'].includes(platform())) throw new PluginError('UnavailableOnPlatform', 'File export currently requires desktop')
    if (exportDialogs.has(owner)) throw new PluginError('QuotaExceeded', 'Only one export dialog per plugin may be open')
    exportDialogs.add(owner)
    let path: string | null
    try { path = await save({ defaultPath: options.fileName }) }
    finally { exportDialogs.delete(owner) }
    if (!path) return { saved: false }
    // Recheck authorization after the save dialog; switching workspace, stopping
    // the plugin or revoking its grant must prevent the pending write.
    await guard()
    await writeFile(path, bytes)
    return { saved: true }
  }
  throw new PluginError('UnavailableOnPlatform', 'File export requires a native save dialog')
}
