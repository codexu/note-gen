import {
  PluginError,
  PLUGIN_DOCUMENT_LIMITS,
  PLUGIN_HTML_EXPORT_LIMITS,
  validatePluginClipboardContent,
  validatePluginExportFileOptions,
  validatePluginExportHtmlOptions,
  validatePluginCopyHtmlOptions,
  resolveMarkdownAttachmentPath,
  type PluginClipboardContent,
  type PluginExportFileOptions,
  type PluginExportFileResult,
  type PluginExportHtmlOptions,
  type PluginExportHtmlResult,
  type PluginCopyHtmlOptions,
  type PluginCopyHtmlResult,
  type EditorTextSnapshot,
  type PluginAttachment,
  type PluginPermissionName,
} from '@notegen/plugin-api'
import { writeHtml, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { checkIsTauri } from '@/lib/check'
import { buildPluginHtmlFile, getPluginDocument, limitDocumentText, sanitizeDocumentHtml } from './documents'
import { requirePluginUserAction } from './user-actions'
import { platform } from '@tauri-apps/plugin-os'
import { buildAdvancedHtmlDocument } from '@/lib/markdown/export-document'
import { buildAdvancedRichText } from '@/lib/markdown/export-rich-text'

const exportDialogs = new Set<AbortSignal>()
const htmlExports = new Set<AbortSignal>()
// Native save dialogs have no deadline; HTML generation has its own bounded render deadline.
export function isPluginExportDialogOpen(owner: AbortSignal): boolean { return exportDialogs.has(owner) || htmlExports.has(owner) }

interface HtmlExportServices {
  capture: (options: PluginExportHtmlOptions) => Promise<{ snapshot: EditorTextSnapshot; path?: string }>
  guard: (permission?: PluginPermissionName, path?: string) => Promise<void>
  readAttachment: (path: string) => Promise<PluginAttachment>
}

function exportFileName(path?: string) {
  const name = (path?.split('/').pop() || 'document').replace(/\.md$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'document'
  return `${name}.html`
}

/** The host owns content and attachment bytes for every HTML output transaction. */
export async function exportPluginHtml(
  pluginId: string,
  owner: AbortSignal,
  value: PluginExportHtmlOptions,
  services: HtmlExportServices,
): Promise<PluginExportHtmlResult> {
  const options = validatePluginExportHtmlOptions(value)
  const result = await outputPluginHtml(pluginId, owner, options, services, 'file')
  return { editorId: result.editorId, documentId: result.documentId, revision: result.revision, saved: result.completed, warnings: result.warnings }
}

export async function copyPluginHtml(
  pluginId: string,
  owner: AbortSignal,
  value: PluginCopyHtmlOptions,
  services: HtmlExportServices,
): Promise<PluginCopyHtmlResult> {
  const options = validatePluginCopyHtmlOptions(value)
  const result = await outputPluginHtml(pluginId, owner, options, services, options.format)
  return { editorId: result.editorId, documentId: result.documentId, revision: result.revision, copied: true, warnings: result.warnings }
}

async function outputPluginHtml(
  pluginId: string,
  owner: AbortSignal,
  options: PluginExportHtmlOptions | PluginCopyHtmlOptions,
  services: HtmlExportServices,
  output: 'file' | 'source' | 'rich-text',
) {
  requirePluginUserAction(pluginId)
  if (!checkIsTauri() || ['ios', 'android'].includes(platform())) {
    throw new PluginError('UnavailableOnPlatform', 'HTML output requires the desktop app')
  }
  if (htmlExports.has(owner) || exportDialogs.has(owner)) {
    throw new PluginError('QuotaExceeded', 'Only one HTML output may run per plugin')
  }
  htmlExports.add(owner)
  const permission = output === 'file' ? 'files.export' : 'clipboard.write'
  const usedAttachments = new Set<string>()
  const imageCache = new Map<string, Promise<string | undefined>>()
  let imageBytes = 0
  try {
    await services.guard('editor.read')
    await services.guard(permission)
    const { snapshot, path } = await services.capture(options)
    if (new TextEncoder().encode(snapshot.text).byteLength > PLUGIN_HTML_EXPORT_LIMITS.markdownBytes) {
      throw new PluginError('QuotaExceeded', 'The Markdown source exceeds the HTML export limit')
    }
    const identity = { editorId: snapshot.editorId, documentId: snapshot.documentId, revision: snapshot.revision }
    let selectedPath: string | null = null
    if (output === 'file') {
      exportDialogs.add(owner)
      try {
        const requestedName = ('fileName' in options && options.fileName) || exportFileName(path)
        selectedPath = await save({
          defaultPath: /\.html$/i.test(requestedName) ? requestedName : `${requestedName}.html`,
          filters: [{ name: 'HTML', extensions: ['html'] }],
        })
      } finally { exportDialogs.delete(owner) }
      if (!selectedPath) return { ...identity, completed: false, warnings: [] }
      await services.guard('editor.read')
      await services.guard(permission)
    }

    const readImage = async (source: string): Promise<string | undefined> => {
      const relativePath = path ? resolveMarkdownAttachmentPath(path, source) : null
      if (!relativePath) return undefined
      const extension = relativePath.split('.').pop()?.toLowerCase()
      const mime = extension === 'jpg' || extension === 'jpeg' ? 'jpeg'
        : extension === 'png' || extension === 'gif' || extension === 'webp' ? extension : null
      if (!mime) return undefined
      try {
        const attachment = await services.readAttachment(relativePath)
        if (!attachment.base64 || attachment.size > PLUGIN_HTML_EXPORT_LIMITS.imageBytes
          || attachment.size + imageBytes > PLUGIN_HTML_EXPORT_LIMITS.imageTotalBytes) return undefined
        imageBytes += attachment.size
        usedAttachments.add(relativePath)
        return `data:image/${mime};base64,${attachment.base64}`
      } catch (error) {
        if (error instanceof PluginError && ['Cancelled', 'WorkspaceChanged'].includes(error.code)) throw error
        await services.guard('editor.read')
        await services.guard(permission)
        return undefined
      }
    }
    const generated = await buildAdvancedHtmlDocument({
      markdown: snapshot.text,
      title: (path?.split('/').pop() || 'document').replace(/\.md$/i, ''),
      css: options.css,
      // Scripts are never executed or included in rich-text clipboard output.
      javascript: output === 'rich-text' ? undefined : options.javascript,
      signal: owner,
      resolveImage: source => {
        let pending = imageCache.get(source)
        if (!pending) {
          if (imageCache.size >= PLUGIN_HTML_EXPORT_LIMITS.images) return Promise.resolve(undefined)
          pending = readImage(source)
          imageCache.set(source, pending)
        }
        return pending
      },
    })
    const rich = output === 'rich-text' ? await buildAdvancedRichText(generated.html, {
      css: options.css, javascript: options.javascript, signal: owner,
    }) : undefined
    // Preserve the rich-text-specific notices even when many missing images
    // have already filled the renderer's warning budget.
    const warnings = [...(rich?.warnings ?? []), ...generated.warnings]
    if (warnings.length > 32) {
      warnings.splice(31, warnings.length - 31, { code: 'additional-warnings', message: 'Additional export warnings were omitted' })
    }
    const data = rich?.html ?? generated.html
    const bytes = new TextEncoder().encode(data)
    if (bytes.byteLength > PLUGIN_HTML_EXPORT_LIMITS.exportBytes || (rich && new TextEncoder().encode(rich.text).byteLength > PLUGIN_HTML_EXPORT_LIMITS.exportBytes)) {
      throw new PluginError('QuotaExceeded', 'The generated HTML exceeds the output limit')
    }
    await services.guard('editor.read')
    await services.guard(permission)
    for (const attachment of usedAttachments) await services.guard('attachments.read', attachment)
    await services.guard(permission)
    requirePluginUserAction(pluginId)
    try {
      if (output === 'file' && selectedPath) await writeFile(/\.html$/i.test(selectedPath) ? selectedPath : `${selectedPath}.html`, bytes)
      else if (rich) await writeHtml(rich.html, rich.text)
      else await writeText(generated.html)
    } catch (error) {
      await services.guard(permission)
      if (output === 'file') {
        const code = /no space|disk full|enospc/i.test(String(error)) ? 'NoSpace' : 'RuntimeFailure'
        throw new PluginError(code, 'Unable to save the exported HTML file')
      }
      throw new PluginError('RuntimeFailure', 'Unable to write HTML to the clipboard')
    }
    return { ...identity, completed: true, warnings }
  } finally {
    htmlExports.delete(owner)
    imageCache.clear()
    usedAttachments.clear()
  }
}

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
    if (exportDialogs.has(owner) || htmlExports.has(owner)) throw new PluginError('QuotaExceeded', 'Only one export dialog per plugin may be open')
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
