'use client'

import { PluginError, PLUGIN_HTML_EXPORT_LIMITS, type PluginExportHtmlWarning } from '@notegen/plugin-api'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { StreamdownRenderer } from '@/components/markdown/streamdown-renderer'
import { createExportCodeHighlighter } from '@/lib/code-highlighter'

export type AdvancedHtmlWarning = PluginExportHtmlWarning

export interface AdvancedHtmlDocumentOptions {
  markdown: string
  title: string
  css?: string
  javascript?: string
  signal?: AbortSignal
  /** Returns an authorized raster data URI, never a filesystem or asset URL. */
  resolveImage?: (source: string) => Promise<string | undefined>
}

const RASTER_DATA_URI = /^data:image\/(?:png|jpeg|gif|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/
const CSS_URL = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g

// Export typography is independent of the current application theme and user CSS.
export const DOCUMENT_STYLES = `
@layer notegen-export {
:root { color-scheme: light; }
* { box-sizing: border-box; }
body.notegen-export {
  max-width: 800px; margin: 0 auto; padding: 40px 24px;
  background: #fff; color: #24292f;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  font-size: 16px; line-height: 1.7; overflow-wrap: anywhere;
}
.streamdown-document { width: 100%; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; font-weight: 600; margin: 1.5em 0 .75em; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
h4, h5, h6 { font-size: 1em; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
ul, ol { padding-left: 1.75em; } ul { list-style: disc; } ol { list-style: decimal; }
li > p { margin-bottom: .25em; }
.task-list-item { list-style: none; }
a { color: #0969da; text-decoration: underline; }
blockquote { border-left: 3px solid #d0d7de; margin-left: 0; padding-left: 1em; color: #57606a; }
pre, code, kbd { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
code { font-size: .9em; }
:not(pre) > code { background: #f1f3f5; border-radius: 4px; padding: .15em .3em; }
pre { padding: 16px; overflow-x: auto; background: var(--sdm-bg, #f6f8fa); color: var(--sdm-fg, inherit); border-radius: 6px; white-space: pre; }
pre code { white-space: inherit; }
[data-streamdown="code-block"] { margin-bottom: 1em; overflow: hidden; border: 1px solid #d0d7de; border-radius: 6px; }
[data-streamdown="code-block"] pre { margin: 0; border-radius: 0; }
[data-streamdown="code-block-header"] { padding: 6px 12px; font-size: .8em; background: #f6f8fa; }
[data-streamdown="code-block-body"] span { color: var(--sdm-c, inherit); background-color: var(--sdm-tbg, transparent); }
[data-streamdown="table-wrapper"] { overflow-x: auto; margin-bottom: 1em; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d0d7de; padding: 8px 10px; text-align: left; }
th { background: #f6f8fa; font-weight: 600; }
img, svg { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 2em 0; }
input[type="checkbox"] { margin-right: .5em; }
del { text-decoration: line-through; } strong { font-weight: 700; } em { font-style: italic; }
.katex-display { overflow-x: auto; overflow-y: hidden; }
@media (max-width: 600px) { body.notegen-export { padding: 24px 16px; } }
}
`

function assertBytes(value: string, limit: number) {
  if (new TextEncoder().encode(value).byteLength > limit) {
    throw new PluginError('QuotaExceeded', 'HTML export exceeds its byte limit')
  }
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof PluginError
    ? signal.reason
    : new PluginError('Cancelled', 'HTML export was cancelled')
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal)
}

function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(abortError(signal))
    signal.addEventListener('abort', cancelled, { once: true })
    work.then(value => {
      signal.removeEventListener('abort', cancelled)
      if (signal.aborted) reject(abortError(signal))
      else resolve(value)
    }, error => {
      signal.removeEventListener('abort', cancelled)
      reject(error)
    })
    if (signal.aborted) cancelled()
  })
}

function nextFrame(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancelled = () => {
      cancelAnimationFrame(frame)
      reject(signal ? abortError(signal) : new PluginError('Cancelled', 'HTML export was cancelled'))
    }
    const frame = requestAnimationFrame(() => {
      signal?.removeEventListener('abort', cancelled)
      resolve()
    })
    signal?.addEventListener('abort', cancelled, { once: true })
    if (signal?.aborted) cancelled()
  })
}

/** Shared renderer; image embedding and document serialization remain caller policies. */
export async function renderMarkdownExportFragment(
  markdown: string,
  options: { deferImages?: boolean; signal?: AbortSignal } = {},
) {
  const controller = new AbortController()
  const cancelled = () => controller.abort(options.signal ? abortError(options.signal) : new PluginError('Cancelled', 'HTML export was cancelled'))
  options.signal?.addEventListener('abort', cancelled, { once: true })
  if (options.signal?.aborted) cancelled()
  const timeout = setTimeout(() => controller.abort(new PluginError('Timeout', 'Markdown rendering timed out')), PLUGIN_HTML_EXPORT_LIMITS.renderTimeoutMs)
  const signal = controller.signal
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;pointer-events:none'
  container.setAttribute('aria-hidden', 'true')
  document.body.appendChild(container)
  const root = createRoot(container)
  const highlighter = createExportCodeHighlighter()

  try {
    checkAbort(signal)
    flushSync(() => root.render(createElement(StreamdownRenderer, {
      markdown,
      interactiveCodeBlocks: false,
      deferImages: options.deferImages,
      exportCodeHighlighter: highlighter.plugin,
    })))
    // Streamdown lazy-loads code bodies. An initially empty pending queue does
    // not mean those bodies have mounted and requested their highlighting yet.
    const awaitingCodeBodies = () => Array.from(container.querySelectorAll('[data-streamdown="code-block-body"]')).some(block => {
      const code = block.querySelector('code')
      const lines = code ? Array.from(code.children) : []
      const source = lines.length
        ? lines.map(line => line.textContent === '\n' ? '' : line.textContent ?? '').join('\n')
        : code?.textContent ?? ''
      return !highlighter.hasRequested(source.replace(/\n+$/, ''), block.getAttribute('data-language') || 'text')
    })
    do {
      await nextFrame(signal)
      await abortable(highlighter.waitForIdle(), signal)
      flushSync(() => undefined)
    } while (highlighter.hasPending() || awaitingCodeBodies())
    await nextFrame(signal)
    flushSync(() => undefined)
    checkAbort(signal)
    return { html: container.innerHTML, highlightFallback: highlighter.didFallback() }
  } finally {
    highlighter.dispose()
    root.unmount()
    container.remove()
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancelled)
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

function safeWarningSource(source: string) {
  if (/^(?:[/\\]|[a-z][a-z0-9+.-]*:)/i.test(source) && !/^https?:\/\//i.test(source)) return undefined
  return source.slice(0, 256) || undefined
}

type AddWarning = (warning: AdvancedHtmlWarning) => void

async function resolveExportImages(
  template: HTMLTemplateElement,
  options: AdvancedHtmlDocumentOptions,
  signal: AbortSignal,
  warn: AddWarning,
) {
  const images = Array.from(template.content.querySelectorAll('img'))
  let totalBytes = 0
  let embeddedImages = 0
  const resolved = new Map<string, string | undefined>()

  for (const image of images) {
    checkAbort(signal)
    const source = image.getAttribute('data-notegen-export-src') ?? ''
    image.removeAttribute('data-notegen-export-src')
    if (/^https?:\/\//i.test(source)) {
      image.setAttribute('src', source)
      warn({ code: 'asset-not-embedded', message: 'A remote image requires a network connection when the exported file is opened', source: safeWarningSource(source) })
      continue
    }

    let dataUrl = source.startsWith('data:') ? source : resolved.get(source)
    if (embeddedImages < PLUGIN_HTML_EXPORT_LIMITS.images && !source.startsWith('data:') && !resolved.has(source) && source && options.resolveImage) {
      dataUrl = await abortable(options.resolveImage(source), signal)
      resolved.set(source, dataUrl)
    }
    const match = dataUrl?.match(RASTER_DATA_URI)
    if (match) {
      const base64 = match[1]
      const bytes = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
      if (embeddedImages < PLUGIN_HTML_EXPORT_LIMITS.images && bytes <= PLUGIN_HTML_EXPORT_LIMITS.imageBytes && totalBytes + bytes <= PLUGIN_HTML_EXPORT_LIMITS.imageTotalBytes) {
        totalBytes += bytes
        embeddedImages++
        image.setAttribute('src', dataUrl!)
        continue
      }
    }
    image.replaceWith(document.createTextNode(`[${image.getAttribute('alt') || 'image'}]`))
    warn({ code: 'asset-not-embedded', message: 'A local image could not be embedded with the current attachment permissions or size limits', source: safeWarningSource(source) })
  }
}

async function collectMathStyles(signal: AbortSignal, warn: AddWarning) {
  const chunks: string[] = []
  const fontCache = new Map<string, Promise<string>>()
  const visit = async (rules: CSSRuleList, baseUrl: string) => {
    for (const rule of Array.from(rules)) {
      checkAbort(signal)
      if (rule instanceof CSSStyleRule && rule.selectorText.includes('.katex')) {
        chunks.push(rule.cssText)
      } else if (rule instanceof CSSFontFaceRule && /KaTeX_/i.test(rule.style.getPropertyValue('font-family'))) {
        let css = rule.cssText
        let complete = true
        for (const match of Array.from(css.matchAll(CSS_URL))) {
          const url = new URL(match[2], baseUrl)
          // Only bundled application fonts may be fetched; never follow document or custom CSS URLs.
          if (url.origin !== location.origin || url.protocol !== location.protocol || url.host !== location.host || !url.pathname.startsWith('/_next/')) {
            complete = false
            break
          }
          let font = fontCache.get(url.href)
          if (!font) {
            font = fetch(url, { signal, credentials: 'omit', redirect: 'error' }).then(async response => {
              if (!response.ok) throw new Error('Bundled font is unavailable')
              const bytes = new Uint8Array(await response.arrayBuffer())
              if (bytes.length > PLUGIN_HTML_EXPORT_LIMITS.imageBytes) throw new Error('Bundled font exceeds its size limit')
              let binary = ''
              for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
              const mime = /\.woff2$/i.test(url.pathname) ? 'font/woff2'
                : /\.woff$/i.test(url.pathname) ? 'font/woff'
                  : /\.ttf$/i.test(url.pathname) ? 'font/ttf' : 'application/octet-stream'
              return `data:${mime};base64,${btoa(binary)}`
            })
            fontCache.set(url.href, font)
          }
          try { css = css.replace(match[0], `url("${await abortable(font, signal)}")`) }
          catch {
            checkAbort(signal)
            complete = false
            break
          }
        }
        if (complete) chunks.push(css)
        else warn({ code: 'asset-not-embedded', message: 'A bundled math font could not be embedded' })
      } else if ('cssRules' in rule && !(rule instanceof CSSImportRule)) {
        await visit((rule as CSSGroupingRule).cssRules, baseUrl)
      }
    }
  }

  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode instanceof Element ? sheet.ownerNode : null
    const href = sheet.href || owner?.getAttribute('data-href') || owner?.getAttribute('data-n-href')
    if (!href) continue
    const url = new URL(href, document.baseURI)
    if (url.origin !== location.origin || url.protocol !== location.protocol || url.host !== location.host || !url.pathname.startsWith('/_next/')) continue
    let rules: CSSRuleList
    try { rules = sheet.cssRules } catch { continue }
    await visit(rules, url.href)
  }
  if (!chunks.length) warn({ code: 'asset-not-embedded', message: 'The bundled math stylesheet was unavailable' })
  return chunks.join('\n')
}

export async function buildAdvancedHtmlDocument(options: AdvancedHtmlDocumentOptions): Promise<{
  html: string
  warnings: AdvancedHtmlWarning[]
}> {
  assertBytes(options.markdown, PLUGIN_HTML_EXPORT_LIMITS.markdownBytes)
  if ((options.css?.length ?? 0) > PLUGIN_HTML_EXPORT_LIMITS.codeCharacters || (options.javascript?.length ?? 0) > PLUGIN_HTML_EXPORT_LIMITS.codeCharacters) {
    throw new PluginError('QuotaExceeded', 'Custom export code is limited to 10,000 characters per field')
  }
  const controller = new AbortController()
  const cancelled = () => controller.abort(new PluginError('Cancelled', 'HTML export was cancelled'))
  options.signal?.addEventListener('abort', cancelled, { once: true })
  if (options.signal?.aborted) cancelled()
  const timeout = setTimeout(() => controller.abort(new PluginError('Timeout', 'HTML rendering timed out')), PLUGIN_HTML_EXPORT_LIMITS.renderTimeoutMs)
  const warnings: AdvancedHtmlWarning[] = []
  let warningOverflow = false
  const warn: AddWarning = warning => {
    if (warnings.some(item => item.code === warning.code && item.message === warning.message && item.source === warning.source)) return
    if (warnings.length < 32) warnings.push(warning)
    else warningOverflow = true
  }

  try {
    const { html: fragment, highlightFallback } = await renderMarkdownExportFragment(options.markdown, { deferImages: true, signal: controller.signal })
    if (highlightFallback) warn({ code: 'highlight-fallback', message: 'Some code blocks were exported without syntax highlighting' })
    const template = document.createElement('template')
    template.innerHTML = fragment
    // Streamdown renders Markdown strong emphasis as a styled span. Export a
    // semantic element so standalone HTML and rich-text paste both retain it
    // without depending on the application's utility stylesheet.
    for (const span of template.content.querySelectorAll('span[data-streamdown="strong"]')) {
      const strong = document.createElement('strong')
      for (const attribute of Array.from(span.attributes)) strong.setAttribute(attribute.name, attribute.value)
      strong.append(...Array.from(span.childNodes))
      span.replaceWith(strong)
    }
    // Streamdown separates code lines using spans and utility CSS. Preserve
    // actual line breaks in standalone HTML without copying the app stylesheet.
    for (const code of template.content.querySelectorAll('[data-streamdown="code-block-body"] code')) {
      const lines = Array.from(code.children)
      lines.forEach((line, index) => {
        if (line.textContent === '\n') line.textContent = ''
        if (index < lines.length - 1) line.after(document.createTextNode('\n'))
      })
    }
    for (const element of template.content.querySelectorAll('script,style,link,iframe,object,embed,audio,video,source,base,meta,form')) element.remove()
    for (const element of template.content.querySelectorAll('*')) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name) || ['src', 'srcset', 'poster'].includes(attribute.name)) element.removeAttribute(attribute.name)
      }
    }
    if (template.content.querySelector('code.language-mermaid, [data-language="mermaid"]') || /(?:^|\n)\s*(?:`{3,}|~{3,})\s*mermaid\b/i.test(options.markdown)) {
      warn({ code: 'unsupported-content', message: 'Mermaid diagrams are preserved as code blocks' })
    }
    await resolveExportImages(template, options, controller.signal, warn)
    const mathStyles = template.content.querySelector('.katex') ? await collectMathStyles(controller.signal, warn) : ''
    checkAbort(controller.signal)
    // Data resources preserve raw-text end markers and Unicode without evaluating custom code in NoteGen.
    const customCss = options.css ? `\n<link rel="stylesheet" href="data:text/css;charset=utf-8;base64,${utf8Base64(options.css)}">` : ''
    const mathCss = mathStyles ? `\n<link rel="stylesheet" href="data:text/css;charset=utf-8;base64,${utf8Base64(`@layer notegen-export {\n${mathStyles}\n}`)}">` : ''
    const customScript = options.javascript ? `\n<script src="data:text/javascript;charset=utf-8;base64,${utf8Base64(options.javascript)}"></script>` : ''
    const html = `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.title)}</title><style>${DOCUMENT_STYLES}</style>${mathCss}${customCss}</head><body class="notegen-export">${template.innerHTML}${customScript}</body></html>`
    assertBytes(html, PLUGIN_HTML_EXPORT_LIMITS.exportBytes)
    if (warningOverflow) warnings.splice(31, 1, { code: 'additional-warnings', message: 'Additional export warnings were omitted' })
    return { html, warnings }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancelled)
  }
}
