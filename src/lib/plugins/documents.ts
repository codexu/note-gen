import MarkdownIt from 'markdown-it'
import { create } from 'zustand'
import { PluginError, validatePluginRenderDocumentOptions, PLUGIN_DOCUMENT_LIMITS, type PluginRenderDocumentOptions, type PluginRenderedDocument } from '@notegen/plugin-api'

const MAX_DOCUMENT_BYTES = PLUGIN_DOCUMENT_LIMITS.htmlBytes
const MAX_CSS_BYTES = PLUGIN_DOCUMENT_LIMITS.cssBytes
const MAX_ELEMENTS = 2000
const properties = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-indent',
  'white-space', 'white-space-collapse', 'text-wrap', 'text-wrap-mode', 'text-wrap-style',
  'word-break', 'overflow-wrap', 'vertical-align',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width', 'border-radius', 'border-collapse',
  // CSSOM expands supported shorthands (including border and white-space) before iteration.
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat',
  'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness',
  'width', 'max-width', 'min-width', 'height', 'max-height', 'box-sizing', 'list-style-type',
])
const shorthandSamples = {
  border: '1px solid #000',
  'border-top': '1px solid #000',
  'border-right': '1px solid #000',
  'border-bottom': '1px solid #000',
  'border-left': '1px solid #000',
  'border-color': '#000',
  'border-style': 'solid',
  'border-width': '1px',
  'border-radius': '1px',
  margin: '1px',
  padding: '1px',
  'text-decoration': 'underline solid #000',
  'white-space': 'pre-wrap',
  'text-wrap': 'wrap',
} as const
let expandedProperties: ReadonlySet<string> | undefined

function articleProperties(): ReadonlySet<string> {
  if (expandedProperties) return expandedProperties
  const allowed = new Set(properties)
  // The CSSOM may expose a supported shorthand as extra longhands. Learn those
  // names from the same parser used for article rules so browser versions agree.
  for (const [property, value] of Object.entries(shorthandSamples)) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`.article { ${property}: ${value}; }`)
    const rule = sheet.cssRules[0]
    if (rule instanceof CSSStyleRule) for (const name of Array.from(rule.style)) allowed.add(name)
  }
  expandedProperties = allowed
  return allowed
}

function isSafeArticleProperty(property: string, value: string): boolean {
  // Border shorthands reset border-image-source to none. Do not allow an image
  // source here, even if this browser exposes the reset as a separate longhand.
  return articleProperties().has(property)
    && (property !== 'border-image-source' || value.trim().toLowerCase() === 'none')
}
const tags = new Set(['ARTICLE', 'SECTION', 'DIV', 'SPAN', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'PRE', 'CODE', 'KBD', 'STRONG', 'EM', 'MARK', 'S', 'DEL', 'HR', 'BR', 'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SUP', 'SUB'])
const rasterDataUrl = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/
const safeLink = /^(?:https?:\/\/|mailto:|#)/i

export function limitDocumentText(value: unknown, limit = MAX_DOCUMENT_BYTES): asserts value is string {
  if (typeof value !== 'string') throw new PluginError('InvalidPath', 'Expected document text')
  if (new TextEncoder().encode(value).byteLength > limit) throw new PluginError('QuotaExceeded', 'Document exceeds its byte limit')
}

/** CSS is intentionally a small, portable article subset. Never execute imports or load CSS assets. */
export function parseArticleStyles(css: string): CSSStyleRule[] {
  limitDocumentText(css, MAX_CSS_BYTES)
  if (/[\\<>@]|url\s*\(|expression\s*\(|var\s*\(/i.test(css)) throw new PluginError('InvalidPath', 'Article CSS cannot contain imports, escapes, assets or variables')
  const sheet = new CSSStyleSheet()
  try { sheet.replaceSync(css) }
  catch { throw new PluginError('InvalidPath', 'Invalid article CSS') }
  const rules = Array.from(sheet.cssRules)
  if (rules.length > 100) throw new PluginError('QuotaExceeded', 'Article CSS has too many rules')
  if (css.trim() && !rules.length) throw new PluginError('InvalidPath', 'No valid article style rules were found')
  return rules.map(rule => {
    if (!(rule instanceof CSSStyleRule)) throw new PluginError('InvalidPath', 'Only article style rules are supported')
    // Ban selector lists nested in functions and sibling/ancestor escapes. Every
    // selector must address the root or its descendants, never the app shell.
    for (const selector of rule.selectorText.split(',')) {
      if (!/^\.article(?:\s+[a-zA-Z0-9 .#\[\]="'_*:-]+)?$/.test(selector.trim()) || /[():]/.test(selector)) {
        throw new PluginError('InvalidPath', 'Selectors must start with .article and target its descendants')
      }
    }
    for (const property of Array.from(rule.style)) {
      if (!isSafeArticleProperty(property, rule.style.getPropertyValue(property))) {
        throw new PluginError('InvalidPath', `Unsupported article CSS property: ${property}`)
      }
    }
    return rule
  })
}

/** Safe fragments for clipboard and document frames. No executable markup or implicit network access. */
export function sanitizeDocumentHtml(html: string, preserveImageSources = false): string {
  limitDocumentText(html)
  const template = document.createElement('template')
  template.innerHTML = html
  const elements = Array.from(template.content.querySelectorAll('*'))
  if (elements.length > MAX_ELEMENTS) throw new PluginError('QuotaExceeded', 'Document has too many elements')
  for (const element of elements) {
    if (!tags.has(element.tagName)) { element.remove(); continue }
    for (const attr of Array.from(element.attributes)) {
      if (attr.name === 'style') {
        const style = (element as HTMLElement).style
        for (const property of Array.from(style)) {
          const value = style.getPropertyValue(property)
          if (!isSafeArticleProperty(property, value) || /[\\<>]|url\s*\(|expression\s*\(|var\s*\(/i.test(value)) style.removeProperty(property)
        }
      } else if (attr.name === 'href' && element.tagName === 'A' && safeLink.test(attr.value)) {
        continue
      } else if (attr.name === 'src' && element.tagName === 'IMG' && (preserveImageSources || rasterDataUrl.test(attr.value) || /^https?:\/\//i.test(attr.value))) {
        continue
      } else if (['alt', 'title', 'colspan', 'rowspan', 'start'].includes(attr.name)) {
        continue
      } else if (attr.name === 'class' && attr.value.length <= 256 && /^[\w -]+$/.test(attr.value)) {
        continue
      } else if (attr.name === 'id' && attr.value.length <= 160 && /^[a-zA-Z][\w-]*$/.test(attr.value)) {
        continue
      } else element.removeAttribute(attr.name)
    }
  }
  return template.innerHTML
}

const BASE_CSS = `.article { color: #262626; background-color: #fff; font-size: 16px; line-height: 1.8; overflow-wrap: anywhere; }
.article h1 { font-size: 28px; font-weight: bold; margin-top: 24px; margin-bottom: 16px; }
.article h2 { font-size: 23px; font-weight: bold; margin-top: 24px; margin-bottom: 12px; }
.article h3 { font-size: 19px; font-weight: bold; margin-top: 20px; margin-bottom: 10px; }
.article p { margin-top: 0; margin-bottom: 16px; }
.article blockquote { margin: 16px 0; padding: 12px 16px; border-left: 3px solid #aaa; background-color: #f5f5f5; }
.article pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background-color: #f5f5f5; }
.article code { font-family: monospace; }
.article img { max-width: 100%; height: auto; }
.article table { width: 100%; border-collapse: collapse; }
.article th, .article td { border: 1px solid #ddd; padding: 8px; }
.article a { color: #2563eb; }`

interface OwnedDocument { owner: AbortSignal; pluginId: string; value: PluginRenderedDocument }
export const usePluginDocuments = create<{ entries: Record<string, OwnedDocument> }>(() => ({ entries: {} }))
export function getPluginDocument(pluginId: string, id: string, owner?: AbortSignal): PluginRenderedDocument {
  const entry = usePluginDocuments.getState().entries[id]
  if (!entry || entry.pluginId !== pluginId || entry.owner.aborted || owner && owner !== entry.owner) throw new PluginError('NotFound', 'Document is expired or belongs to another plugin')
  return entry.value
}
export function releasePluginDocument(pluginId: string, id: string, owner: AbortSignal): void {
  const entry = usePluginDocuments.getState().entries[id]
  if (!entry || entry.pluginId !== pluginId || entry.owner !== owner) return
  usePluginDocuments.setState(state => ({ entries: Object.fromEntries(Object.entries(state.entries).filter(([key]) => key !== id)) }))
}
export function clearPluginDocuments(pluginId: string, owner: AbortSignal): void {
  usePluginDocuments.setState(state => ({ entries: Object.fromEntries(Object.entries(state.entries).filter(([, entry]) => entry.pluginId !== pluginId || entry.owner !== owner)) }))
}

async function renderPluginDocumentContent(pluginId: string, owner: AbortSignal, options: PluginRenderDocumentOptions, guard: () => Promise<void>): Promise<PluginRenderedDocument> {
  options = validatePluginRenderDocumentOptions(options)
  if (options.title !== undefined) limitDocumentText(options.title, 240)
  if (options.target !== undefined && !['html', 'wechat'].includes(options.target)) throw new PluginError('InvalidPath', 'Unknown document target')
  const rules = [...parseArticleStyles(BASE_CSS), ...parseArticleStyles(options.css ?? '')]
  const warnings: PluginRenderedDocument['warnings'][number][] = []
  const parser = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true })
  const template = document.createElement('template')
  // Preserve image references only inside this inert fragment, until explicit
  // attachment mappings have been applied. Sanitize again before creating a frame.
  template.innerHTML = `<article class="article">${sanitizeDocumentHtml(typeof options.markdown === 'string' ? parser.render(options.markdown) : options.html ?? '', true)}</article>`
  const images = new Map<string, string>()
  if (options.images !== undefined) {
    if (!Array.isArray(options.images) || options.images.length > 32) throw new PluginError('InvalidPath', 'Invalid image list')
    for (const image of options.images) {
      limitDocumentText(image.source, 1024); limitDocumentText(image.dataUrl, 256 * 1024)
      if (!rasterDataUrl.test(image.dataUrl)) throw new PluginError('InvalidPath', 'Only raster image data URLs are supported')
      images.set(image.source, image.dataUrl)
      images.set(parser.normalizeLink(image.source), image.dataUrl)
    }
  }
  for (const image of template.content.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? ''
    const resolved = images.get(src) ?? src
    if (rasterDataUrl.test(resolved) || /^https?:\/\//i.test(resolved)) {
      image.setAttribute('src', resolved)
      if (/^https?:\/\//i.test(resolved)) warnings.push({ code: 'image-unresolved', message: 'Remote images are preserved for export but not loaded in the preview', source: src })
    }
    else {
      image.replaceWith(document.createTextNode(`[${image.getAttribute('alt') || src}]`))
      warnings.push({ code: 'image-unresolved', message: 'Local image requires an explicit image mapping before export', source: src })
    }
  }
  if (options.target === 'wechat') {
    let index = 0
    const refs: string[] = []
    for (const link of template.content.querySelectorAll('a')) {
      const href = link.getAttribute('href') ?? ''
      if (!/^https?:\/\//i.test(href)) continue
      const span = document.createElement('span')
      span.textContent = `${link.textContent} [${++index}]`
      link.replaceWith(span)
      refs.push(`[${index}] ${href}`)
    }
    if (refs.length) {
      const paragraph = document.createElement('p'); paragraph.textContent = refs.join('\n')
      template.content.querySelector('article')?.append(paragraph)
      warnings.push({ code: 'external-link', message: 'External links were converted to numbered references' })
    }
    if (/```\s*mermaid\b|\$\$/.test(options.markdown ?? '')) warnings.push({ code: 'unsupported-content', message: 'Diagrams and math remain text; convert them to images before publishing' })
  }
  await guard()
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:375px;height:800px;visibility:hidden;pointer-events:none'
  const body = sanitizeDocumentHtml(template.innerHTML)
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); owner.removeEventListener('abort', cancelled); frame.onload = null }
      const cancelled = () => { cleanup(); reject(new PluginError('Cancelled', 'Document rendering was cancelled')) }
      const timeout = window.setTimeout(() => { cleanup(); reject(new PluginError('Timeout', 'Document rendering timed out')) }, 5000)
      frame.onload = () => { cleanup(); resolve() }
      owner.addEventListener('abort', cancelled, { once: true })
      if (owner.aborted) { cancelled(); return }
      // Scripts, remote images and every other network resource are blocked even
      // though the host needs same-origin access to measure computed styles.
      frame.srcdoc = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>${rules.map(rule => rule.cssText).join('\n')}</style></head><body>${body}</body></html>`
      document.body.appendChild(frame)
    })
    await guard()
    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) throw new PluginError('RuntimeFailure', 'Document frame is unavailable')
    const nodes = Array.from(doc.querySelectorAll<HTMLElement>('.article, .article *'))
    if (nodes.length > MAX_ELEMENTS) throw new PluginError('QuotaExceeded', 'Document has too many elements')
    for (const node of nodes) {
      const matched = new Set<string>()
      for (const rule of rules) if (node.matches(rule.selectorText)) for (const property of Array.from(rule.style)) matched.add(property)
      const computed = win.getComputedStyle(node)
      for (const property of matched) {
        // Keep percentage-based sizing responsive in both preview widths.
        if (['width', 'max-width', 'min-width', 'height', 'max-height'].includes(property)) {
          const value = winningStyleValue(rules, node, property)
          if (value) node.style.setProperty(property, value)
        } else node.style.setProperty(property, computed.getPropertyValue(property))
      }
    }
    const article = doc.querySelector('.article')
    const html = sanitizeDocumentHtml(article?.outerHTML ?? '')
    limitDocumentText(html)
    await guard()
    const existing = Object.values(usePluginDocuments.getState().entries).filter(entry => entry.pluginId === pluginId && entry.owner === owner)
    if (existing.length >= PLUGIN_DOCUMENT_LIMITS.documents) throw new PluginError('QuotaExceeded', 'Release old documents before rendering more')
    const value: PluginRenderedDocument = { id: crypto.randomUUID(), title: options.title ?? '', html, text: article ? extractText(article).trim() : '', warnings: warnings.slice(0, 32).map(warning => warning.source === undefined ? warning : { ...warning, source: warning.source.slice(0, 256) }) }
    usePluginDocuments.setState(state => ({ entries: { ...state.entries, [value.id]: { pluginId, owner, value } } }))
    return value
  } finally { frame.remove() }
}

export function buildPluginHtmlFile(value: PluginRenderedDocument): string {
  const title = (value.title ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body>${value.html}</body></html>`
}

function extractText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : null
  if (element?.tagName === 'BR') return '\n'
  const text = Array.from(node.childNodes).map(extractText).join('')
  return element && /^(?:P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|TR)$/.test(element.tagName) ? text + '\n' : text
}

const rendering = new Set<AbortSignal>()
export async function renderPluginDocument(pluginId: string, owner: AbortSignal, options: PluginRenderDocumentOptions, guard: () => Promise<void>): Promise<PluginRenderedDocument> {
  if (rendering.has(owner)) throw new PluginError('QuotaExceeded', 'Only one document render per plugin may run at once')
  rendering.add(owner)
  try { return await renderPluginDocumentContent(pluginId, owner, options, guard) }
  finally { rendering.delete(owner) }
}

/** Match specificity for our restricted descendant selector grammar. */
function winningStyleValue(rules: CSSStyleRule[], node: Element, property: string): string {
  let score = [-1, -1, -1, -1, -1]
  let value = ''
  rules.forEach((rule, order) => {
    const candidate = rule.style.getPropertyValue(property)
    if (!candidate) return
    for (const selector of rule.selectorText.split(',')) {
      if (!node.matches(selector)) continue
      const stripped = selector.replace(/\[[^\]]*\]/g, '')
      const next = [rule.style.getPropertyPriority(property) === 'important' ? 1 : 0,
        (stripped.match(/#/g) ?? []).length,
        (stripped.match(/\./g) ?? []).length + (selector.match(/\[/g) ?? []).length,
        (stripped.match(/(?:^|\s)[a-zA-Z][\w-]*/g) ?? []).length, order]
      const different = next.findIndex((part, index) => part !== score[index])
      if (different < 0 || next[different] > score[different]) { score = next; value = candidate }
    }
  })
  return value
}
