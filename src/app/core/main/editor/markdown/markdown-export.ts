'use client'

import { save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { JSONContent } from '@tiptap/core'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { StreamdownRenderer } from '@/components/markdown/streamdown-renderer'
import { checkIsTauri } from '@/lib/check'
import { resolveImagePathFromMarkdown } from '@/lib/markdown-image-path'
import { convertImageByWorkspace } from '@/lib/utils'
import { getFilePathOptions } from '@/lib/workspace'
import { shouldTransformImageSrcToWorkspaceAsset } from './image-src'
import { GitHubAlertBlockquote } from './github-alert-blockquote'

export type MarkdownExportFormat = 'markdown' | 'html' | 'json' | 'pdf'

export interface MarkdownExportSource {
  baseName: string
  markdown: string | (() => string | Promise<string>)
  json?: JSONContent | (() => JSONContent | Promise<JSONContent>)
  sourcePath?: string
}

export interface MarkdownExportOptions {
  onPdfRenderStart?: () => void
}

const IMAGE_LOAD_TIMEOUT_MS = 5000
const PRINT_FRAME_CLEANUP_DELAY_MS = 60000
const PRINT_EXPORT_STORE = 'print-export.json'
const PRINT_WINDOW_START_TIMEOUT_MS = 15000
const DIRECT_PDF_EXPORT_TIMEOUT_MS = 75000
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g

interface TauriPrintDocument {
  html: string
  outputPath?: string
  completionEvent?: string
}

const EXPORT_DOCUMENT_STYLES = `
  @page {
    size: A4;
    margin: 18mm 16mm 20mm;
  }

  :root {
    color-scheme: light;
  }

  html,
  body {
    width: auto !important;
    height: auto !important;
    min-height: 100% !important;
    margin: 0;
    padding: 0;
    overflow: visible !important;
    background: #ffffff !important;
    color: #24292f !important;
  }

  body.notegen-export {
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.65;
  }

  .notegen-export .streamdown-document {
    color: #24292f !important;
  }

  .notegen-export h1,
  .notegen-export h2,
  .notegen-export h3,
  .notegen-export h4,
  .notegen-export h5,
  .notegen-export h6 {
    break-after: avoid-page;
    color: #111827 !important;
  }

  .notegen-export h1 { font-size: 28px; }
  .notegen-export h2 { font-size: 22px; }
  .notegen-export h3 { font-size: 18px; }
  .notegen-export h4 { font-size: 16px; }

  .notegen-export p,
  .notegen-export li,
  .notegen-export blockquote {
    orphans: 3;
    widows: 3;
  }

  .notegen-export ul,
  .notegen-export ol,
  .notegen-export li {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .notegen-export a {
    color: #0969da !important;
    text-decoration: underline;
  }

  .notegen-export blockquote {
    border-left-color: #d0d7de !important;
    color: #57606a !important;
  }

  .notegen-export pre,
  .notegen-export table,
  .notegen-export img,
  .notegen-export .katex-display {
    break-inside: avoid-page;
  }

  .notegen-export pre {
    white-space: pre-wrap !important;
    overflow-wrap: anywhere;
    background: #f6f8fa !important;
    color: #24292f !important;
  }

  .notegen-export code {
    color: #24292f;
  }

  .notegen-export table {
    width: 100%;
    border-collapse: collapse;
  }

  .notegen-export th,
  .notegen-export td {
    border: 1px solid #d0d7de !important;
    padding: 8px 10px;
    overflow-wrap: anywhere;
  }

  .notegen-export th {
    background: #f6f8fa !important;
  }

  .notegen-export img,
  .notegen-export svg,
  .notegen-export canvas {
    max-width: 100%;
    height: auto;
  }

  @media print {
    body.notegen-export {
      max-width: none;
      padding: 0;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }

    .notegen-export [data-streamdown="table-wrapper"] {
      overflow: visible;
    }

    .notegen-export a {
      overflow-wrap: anywhere;
    }
  }
`

let markdownManager: MarkdownManager | null = null

export function sanitizeExportFileName(fileName: string) {
  return fileName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'document'
}

export function getMarkdownExportBaseName(filePath?: string) {
  const fileName = filePath
    ? filePath.split(/[\\/]/).pop() || filePath
    : 'document'

  return sanitizeExportFileName(fileName.replace(/\.[^/.\\]+$/, ''))
}

function ensureExtension(path: string, extension: string) {
  return path.toLowerCase().endsWith(`.${extension}`) ? path : `${path}.${extension}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  downloadBlob(new Blob([content], { type: mimeType }), filename)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function saveTextExport(
  content: string,
  filename: string,
  extension: string,
  mimeType: string,
  filterName: string,
) {
  if (checkIsTauri()) {
    const selectedPath = await save({
      title: '导出',
      defaultPath: filename,
      filters: [{ name: filterName, extensions: [extension] }],
    })

    if (!selectedPath) {
      return false
    }

    await writeTextFile(ensureExtension(selectedPath, extension), content)
    return true
  }

  downloadTextFile(content, filename, mimeType)
  return true
}

function getMarkdownManager() {
  if (!markdownManager) {
    markdownManager = new MarkdownManager({
      extensions: [
        GitHubAlertBlockquote,
        StarterKit.configure({ blockquote: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
      ],
      indentation: {
        style: 'space',
        size: 2,
      },
    })
  }

  return markdownManager
}

export function parseMarkdownToJson(markdown: string) {
  return getMarkdownManager().parse(markdown)
}

async function getValue<T>(value: T | (() => T | Promise<T>)) {
  if (typeof value === 'function') {
    return await (value as () => T | Promise<T>)()
  }

  return value
}

function sanitizeExportHtml(html: string) {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content
    .querySelectorAll('script, style, link, iframe, object, embed')
    .forEach((element) => element.remove())

  template.content.querySelectorAll<Element>('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith('on')) {
        element.removeAttribute(attribute.name)
      }
    })
  })

  return template.innerHTML
}

async function resolveMarkdownImageSources(html: string, sourcePath?: string) {
  const template = document.createElement('template')
  template.innerHTML = html
  const images = Array.from(template.content.querySelectorAll('img'))

  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute('src')
    if (!src || /^(?:data:|blob:)/i.test(src)) {
      return
    }

    if (sourcePath && shouldTransformImageSrcToWorkspaceAsset(src)) {
      const fullRelativePath = resolveImagePathFromMarkdown(sourcePath, src)
      image.setAttribute('src', await convertImageByWorkspace(fullRelativePath))
      return
    }

    try {
      const response = await fetch(new URL(src, document.baseURI))
      if (response.ok) {
        image.setAttribute('src', await blobToDataUrl(await response.blob()))
      }
    } catch {
      // Keep remote images when CORS or the network prevents embedding them.
    }
  }))

  return template.innerHTML
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function waitForTimeout(timeoutMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, timeoutMs)
  })
}

async function waitForImage(image: HTMLImageElement) {
  image.loading = 'eager'

  if (image.complete) {
    return
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      image.onload = () => resolve()
      image.onerror = () => resolve()
    }),
    waitForTimeout(IMAGE_LOAD_TIMEOUT_MS),
  ])
}

async function waitForDocumentResources(frameDocument: Document) {
  await Promise.all(Array.from(frameDocument.images).map(waitForImage))
  await frameDocument.fonts?.ready
}

export async function renderMarkdownToHtml(markdown: string, sourcePath?: string) {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = '800px'
  container.style.pointerEvents = 'none'
  container.setAttribute('aria-hidden', 'true')
  document.body.appendChild(container)

  const root = createRoot(container)

  try {
    flushSync(() => {
      root.render(createElement(StreamdownRenderer, {
        interactiveCodeBlocks: false,
        markdown,
      }))
    })
    await waitForAnimationFrame()

    return await resolveMarkdownImageSources(
      sanitizeExportHtml(container.innerHTML),
      sourcePath,
    )
  } finally {
    root.unmount()
    container.remove()
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read export asset'))
    reader.readAsDataURL(blob)
  })
}

async function inlineCssAssetUrls(
  css: string,
  baseUrl: string,
  assetCache: Map<string, Promise<string>>,
) {
  const matches = Array.from(css.matchAll(CSS_URL_PATTERN))
  if (matches.length === 0) {
    return css
  }

  let output = ''
  let offset = 0

  for (const match of matches) {
    const index = match.index ?? 0
    const rawUrl = match[2].trim()
    output += css.slice(offset, index)

    if (/^(?:data:|blob:|#)/i.test(rawUrl)) {
      output += match[0]
      offset = index + match[0].length
      continue
    }

    let absoluteUrl: string
    try {
      absoluteUrl = new URL(rawUrl, baseUrl).href
    } catch {
      output += match[0]
      offset = index + match[0].length
      continue
    }

    let dataUrlPromise = assetCache.get(absoluteUrl)
    if (!dataUrlPromise) {
      dataUrlPromise = fetch(absoluteUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Unable to load export asset: ${absoluteUrl}`)
          }
          return response.blob()
        })
        .then(blobToDataUrl)
      assetCache.set(absoluteUrl, dataUrlPromise)
    }

    try {
      output += `url("${await dataUrlPromise}")`
    } catch {
      output += `url("${absoluteUrl}")`
    }
    offset = index + match[0].length
  }

  return output + css.slice(offset)
}

async function collectExportStyles() {
  const assetCache = new Map<string, Promise<string>>()
  const styleChunks: string[] = []

  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(styleSheet.cssRules).map((rule) => rule.cssText).join('\n')
      styleChunks.push(await inlineCssAssetUrls(
        css,
        styleSheet.href || document.baseURI,
        assetCache,
      ))
    } catch {
      // Cross-origin stylesheets cannot expose cssRules. Streamdown's local styles remain available.
    }
  }

  styleChunks.push(EXPORT_DOCUMENT_STYLES)
  return styleChunks.join('\n')
}

function buildHtmlDocument(title: string, body: string, styles: string) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body class="notegen-export">
${body}
</body>
</html>`
}

export async function buildMarkdownExportDocument(source: MarkdownExportSource) {
  const fileName = getMarkdownExportBaseName(source.baseName)
  const markdown = await getValue(source.markdown)
  const [body, styles] = await Promise.all([
    renderMarkdownToHtml(markdown, source.sourcePath),
    collectExportStyles(),
  ])

  return buildHtmlDocument(fileName, body, styles)
}

function createPrintFrame(html: string) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '210mm'
  iframe.style.height = '297mm'
  iframe.style.border = '0'
  iframe.style.pointerEvents = 'none'
  document.body.appendChild(iframe)

  const frameDocument = iframe.contentDocument
  if (!frameDocument) {
    iframe.remove()
    throw new Error('无法创建 PDF 打印页面')
  }

  frameDocument.open()
  frameDocument.write(html)
  frameDocument.close()

  return iframe
}

async function openTauriPrintWindow(html: string, title: string, outputPath?: string) {
  const [{ once }, { WebviewWindow }, { Store }] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/plugin-store'),
  ])
  const documentKey = `document-${crypto.randomUUID()}`
  const windowLabel = `pdf-print-${crypto.randomUUID()}`
  const completionEvent = outputPath ? `pdf-export-result-${crypto.randomUUID()}` : undefined
  const store = await Store.load(PRINT_EXPORT_STORE)
  await store.set(documentKey, {
    html,
    outputPath,
    completionEvent,
  } satisfies TauriPrintDocument)
  await store.save()

  return await new Promise<boolean>((resolve, reject) => {
    let settled = false
    let removeCompletionListener: (() => void) | undefined
    const timeout = window.setTimeout(() => {
      void finishWithError(new Error(outputPath ? 'PDF 导出超时' : 'PDF 打印窗口启动超时'))
    }, outputPath ? DIRECT_PDF_EXPORT_TIMEOUT_MS : PRINT_WINDOW_START_TIMEOUT_MS)

    const removeStoredDocument = async () => {
      await store.delete(documentKey)
      await store.save()
    }

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      removeCompletionListener?.()
      resolve(result)
    }

    const finishWithError = async (reason: unknown) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      removeCompletionListener?.()
      await removeStoredDocument().catch(() => undefined)
      reject(reason instanceof Error ? reason : new Error(String(reason)))
    }

    void (async () => {
      if (completionEvent) {
        removeCompletionListener = await once<{ success: boolean; error?: string }>(completionEvent, (event) => {
          if (event.payload.success) {
            finish(true)
          } else {
            void finishWithError(new Error(event.payload.error || '原生 PDF 导出失败'))
          }
        })
      }

      const printWindow = new WebviewWindow(windowLabel, {
        url: `/print?key=${encodeURIComponent(documentKey)}`,
        title: outputPath ? `${title} - 正在导出 PDF` : `${title} - PDF 打印预览`,
        width: 900,
        height: 700,
        center: true,
        visible: !outputPath,
      })

      await printWindow.once('tauri://created', () => {
        if (!outputPath) finish(true)
      })
      await printWindow.once<string>('tauri://error', (event) => {
        void finishWithError(new Error(`PDF 打印窗口启动失败：${event.payload}`))
      })
    })().catch((reason: unknown) => {
      void finishWithError(reason)
    })
  })
}

async function notifyPdfRenderStart(options?: MarkdownExportOptions) {
  options?.onPdfRenderStart?.()
  await waitForAnimationFrame()
}

async function printExportDocument(source: MarkdownExportSource, options?: MarkdownExportOptions) {
  const fileName = getMarkdownExportBaseName(source.baseName)

  if (checkIsTauri()) {
    const { platform } = await import('@tauri-apps/plugin-os')
    let outputPath: string | undefined

    if (platform() === 'macos') {
      const selectedPath = await save({
        title: '导出 PDF',
        defaultPath: `${fileName}.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      })

      if (!selectedPath) return false
      outputPath = ensureExtension(selectedPath, 'pdf')
    }

    await notifyPdfRenderStart(options)
    return await openTauriPrintWindow(
      await buildMarkdownExportDocument(source),
      fileName,
      outputPath,
    )
  }

  await notifyPdfRenderStart(options)
  const html = await buildMarkdownExportDocument(source)

  const iframe = createPrintFrame(html)

  try {
    const frameDocument = iframe.contentDocument
    const printWindow = iframe.contentWindow
    if (!frameDocument || !printWindow || typeof printWindow.print !== 'function') {
      throw new Error('当前平台不支持系统 PDF 打印')
    }

    await waitForDocumentResources(frameDocument)
    await waitForAnimationFrame()

    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      iframe.remove()
    }

    printWindow.addEventListener('afterprint', cleanup, { once: true })
    window.setTimeout(cleanup, PRINT_FRAME_CLEANUP_DELAY_MS)
    printWindow.focus()
    printWindow.print()
    return true
  } catch (error) {
    iframe.remove()
    throw error
  }
}

export async function exportMarkdownSource(
  format: MarkdownExportFormat,
  source: MarkdownExportSource,
  options?: MarkdownExportOptions,
) {
  const fileName = getMarkdownExportBaseName(source.baseName)

  if (format === 'markdown') {
    return await saveTextExport(
      await getValue(source.markdown),
      `${fileName}.md`,
      'md',
      'text/markdown',
      'Markdown Files',
    )
  }

  if (format === 'html') {
    return await saveTextExport(
      await buildMarkdownExportDocument(source),
      `${fileName}.html`,
      'html',
      'text/html',
      'HTML Files',
    )
  }

  if (format === 'json') {
    const jsonContent = source.json
      ? await getValue(source.json)
      : getMarkdownManager().parse(await getValue(source.markdown))

    return await saveTextExport(
      JSON.stringify(jsonContent, null, 2),
      `${fileName}.json`,
      'json',
      'application/json',
      'JSON Files',
    )
  }

  return await printExportDocument(source, options)
}

export async function exportMarkdownFile(
  format: MarkdownExportFormat,
  filePath: string,
  options?: MarkdownExportOptions,
) {
  const pathOptions = await getFilePathOptions(filePath)
  const readMarkdown = () => (
    pathOptions.baseDir
      ? readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      : readTextFile(pathOptions.path)
  )

  return await exportMarkdownSource(format, {
    baseName: filePath,
    markdown: readMarkdown,
    sourcePath: filePath,
  }, options)
}
