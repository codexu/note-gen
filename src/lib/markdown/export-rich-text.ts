'use client'

import { PluginError, PLUGIN_HTML_EXPORT_LIMITS, type PluginExportHtmlWarning } from '@notegen/plugin-api'
import { DOCUMENT_STYLES } from './export-document'

// Only properties which can be serialized without fetching resources and have
// reasonable support in rich-text destinations are carried into the clipboard.
const portableProperties = [
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-indent',
  'white-space', 'word-break', 'overflow-wrap', 'vertical-align',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-color', 'border-top-style', 'border-top-width',
  'border-right-color', 'border-right-style', 'border-right-width',
  'border-bottom-color', 'border-bottom-style', 'border-bottom-width',
  'border-left-color', 'border-left-style', 'border-left-width',
  'border-collapse', 'border-radius', 'width', 'max-width', 'height', 'list-style-type',
] as const
const portableSet = new Set<string>(portableProperties)
const shorthandProperties: Record<string, readonly string[]> = {
  background: ['background-color'],
  font: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  border: ['border-top-color', 'border-top-style', 'border-top-width', 'border-right-color', 'border-right-style', 'border-right-width', 'border-bottom-color', 'border-bottom-style', 'border-bottom-width', 'border-left-color', 'border-left-style', 'border-left-width'],
  'border-top': ['border-top-color', 'border-top-style', 'border-top-width'],
  'border-right': ['border-right-color', 'border-right-style', 'border-right-width'],
  'border-bottom': ['border-bottom-color', 'border-bottom-style', 'border-bottom-width'],
  'border-left': ['border-left-color', 'border-left-style', 'border-left-width'],
  'list-style': ['list-style-type'],
}
const allowedTags = new Set(['ARTICLE', 'SECTION', 'DIV', 'SPAN', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'PRE', 'CODE', 'KBD', 'STRONG', 'EM', 'MARK', 'S', 'DEL', 'HR', 'BR', 'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SUP', 'SUB'])
const droppedTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'SOURCE', 'BASE', 'META', 'FORM', 'SVG'])
const safeImage = /^(?:data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+=*|https?:\/\/[^\s]+)$/i
const safeLink = /^(?:https?:\/\/|mailto:|#)/i
const unsafeCss = /[\\<>@]|url\s*\(|(?:image-set|cross-fade|element|expression|var)\s*\(/i
const maxElements = 12_000

function assertCurrent(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof PluginError ? signal.reason : new PluginError('Cancelled', 'HTML copy was cancelled')
}

function portableDeclarations(style: CSSStyleDeclaration, property: string): Array<readonly [string, string, string]> {
  const value = style.getPropertyValue(property)
  if (!value || unsafeCss.test(value)) return []
  const names = portableSet.has(property) ? [property] : shorthandProperties[property] ?? []
  return names.flatMap(name => {
    const resolved = style.getPropertyValue(name)
    return resolved && !unsafeCss.test(resolved) ? [[name, resolved, style.getPropertyPriority(property)] as const] : []
  })
}

/** Retain a portable CSS subset and report every rule we cannot safely carry. */
function portableStyles(css: string | undefined): { css: string; omitted: boolean } {
  if (!css?.trim()) return { css: '', omitted: false }
  if (unsafeCss.test(css)) return { css: '', omitted: true }
  const sheet = new CSSStyleSheet()
  try { sheet.replaceSync(css) } catch { return { css: '', omitted: true } }
  const rawRules = Array.from(css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g))
  let omitted = sheet.cssRules.length === 0 || rawRules.length !== sheet.cssRules.length
  const result: string[] = []
  for (const [index, rule] of Array.from(sheet.cssRules).entries()) {
    if (!(rule instanceof CSSStyleRule)) { omitted = true; continue }
    // CSSOM silently drops invalid or unsupported declarations. Surface that
    // loss instead of reporting that the template was reproduced completely.
    for (const declaration of (rawRules[index]?.[1] ?? '').split(';')) {
      const name = declaration.split(':', 1)[0]?.trim()
      if (name && !rule.style.getPropertyValue(name)) omitted = true
    }
    // Pseudo selectors, escapes, attribute selectors and advanced functions can
    // depend on app state or fail in destinations; omit instead of overclaiming.
    if (!/^[a-zA-Z0-9_\-#.\s,*>+~]+$/.test(rule.selectorText)) { omitted = true; continue }
    const declarations: string[] = []
    for (const property of Array.from(rule.style)) {
      const values = portableDeclarations(rule.style, property)
      if (!values.length) { omitted = true; continue }
      const backgroundImage = rule.style.getPropertyValue('background-image')
      if (property === 'background' && backgroundImage && backgroundImage !== 'none') omitted = true
      for (const [name, value, priority] of values) declarations.push(`${name}: ${value}${priority ? ' !important' : ''}`)
    }
    if (!declarations.length) { omitted = true; continue }
    const selector = rule.selectorText.split(',').map(part => {
      const value = part.trim().replace(/^body(?=\.|\s|$)/i, '.notegen-export')
      return value.startsWith('.notegen-export') ? value : `.notegen-export ${value}`
    }).join(', ')
    result.push(`${selector} { ${declarations.join('; ')}; }`)
  }
  return { css: result.join('\n'), omitted }
}

function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  // Nodes belong to the sandbox frame's realm, whose Element constructor is
  // different from the host window's Element constructor.
  if (node.nodeType !== Node.ELEMENT_NODE) return Array.from(node.childNodes).map(plainText).join('')
  const element = node as Element
  if (element.tagName === 'BR') return '\n'
  if (element.tagName === 'IMG') return element.getAttribute('alt') ? `[${element.getAttribute('alt')}]` : '[image]'
  const content = Array.from(node.childNodes).map(plainText).join('')
  if (element.tagName === 'TD' || element.tagName === 'TH') return `${content}\t`
  if (element.tagName === 'LI') return `• ${content}\n`
  return /^(?:P|DIV|SECTION|ARTICLE|H[1-6]|LI|PRE|BLOCKQUOTE|TR|HR)$/.test(element.tagName) ? `${content}\n` : content
}

/** The source is the already sanitized, host-built standalone document, not user markup. */
export async function buildAdvancedRichText(html: string, options: {
  css?: string; javascript?: string; signal?: AbortSignal
}): Promise<{ html: string; text: string; warnings: PluginExportHtmlWarning[] }> {
  assertCurrent(options.signal)
  const warnings: PluginExportHtmlWarning[] = []
  const warn = (code: PluginExportHtmlWarning['code'], message: string) => {
    if (!warnings.some(item => item.code === code)) warnings.push({ code, message })
  }
  if (options.javascript?.trim()) warn('rich-text-script-omitted', 'JavaScript is not included in rich text')
  const styles = portableStyles(options.css)
  if (styles.omitted) warn('rich-text-css-omitted', 'Some CSS is not supported in rich text')
  const marker = '<body class="notegen-export">'
  const start = html.indexOf(marker)
  const end = html.lastIndexOf('</body></html>')
  if (start < 0 || end < start) throw new PluginError('RuntimeFailure', 'Generated HTML body is unavailable')
  const template = document.createElement('template')
  template.innerHTML = html.slice(start + marker.length, end)
  if (template.content.querySelectorAll('*').length > maxElements) throw new PluginError('QuotaExceeded', 'Rich text has too many elements')

  // KaTeX relies on MathML/SVG and embedded fonts that arbitrary rich-text
  // destinations do not preserve. Keep the original TeX text instead of a
  // visually misleading or silently empty result.
  for (const math of Array.from(template.content.querySelectorAll('.katex'))) {
    const text = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent || math.textContent || ''
    const replacement = document.createElement('span')
    replacement.textContent = text
    math.replaceWith(replacement)
    warn('rich-text-math-fallback', 'Formulas are preserved as text in rich text')
  }
  for (const input of Array.from(template.content.querySelectorAll('input'))) {
    if (input.type === 'checkbox') input.replaceWith(document.createTextNode(input.checked || input.hasAttribute('checked') ? '☑ ' : '☐ '))
    else { input.remove(); warn('rich-text-content-omitted', 'Unsupported interactive content was omitted') }
  }
  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    if (!element.isConnected && !template.content.contains(element)) continue
    if (element.tagName.toUpperCase() === 'SVG') {
      // The clipboard target may not support SVG. Keep any visible label/text
      // as ordinary text instead of discarding it with the graphic.
      const labels = Array.from(element.querySelectorAll('text, title, desc')).map(node => node.textContent?.trim()).filter(Boolean)
      if (labels.length) element.replaceWith(document.createTextNode([...new Set(labels)].join(' ')))
      else element.remove()
      warn('rich-text-content-omitted', 'SVG graphics were simplified for rich text')
      continue
    }
    if (droppedTags.has(element.tagName)) { element.remove(); warn('rich-text-content-omitted', 'Unsupported content was omitted'); continue }
    if (!allowedTags.has(element.tagName)) { element.replaceWith(...Array.from(element.childNodes)); warn('rich-text-content-omitted', 'Unsupported content was simplified'); continue }
    const originalStyle = (element as HTMLElement).style
    const tokenColor = originalStyle?.getPropertyValue('--sdm-c')?.trim()
    const inline = Array.from(originalStyle ?? []).flatMap(property => {
      if (property.startsWith('--') || ['content-visibility', 'contain-intrinsic-size'].includes(property)) return []
      const values = portableDeclarations(originalStyle, property)
      if (!values.length) {
        warn('rich-text-css-omitted', 'Some inline CSS is not supported in rich text')
        return []
      }
      return values
    })
    for (const attr of Array.from(element.attributes)) {
      if (attr.name === 'data-streamdown' && /^[a-z0-9-]+$/.test(attr.value)) continue
      if (attr.name === 'class' && /^[\w -]{1,256}$/.test(attr.value)) continue
      if (attr.name === 'href' && element.tagName === 'A' && safeLink.test(attr.value)) continue
      if (attr.name === 'src' && element.tagName === 'IMG' && safeImage.test(attr.value)) continue
      if (['alt', 'title', 'colspan', 'rowspan', 'start'].includes(attr.name)) continue
      if (attr.name === 'href' || attr.name === 'src') warn('rich-text-content-omitted', 'Some links or media were omitted')
      element.removeAttribute(attr.name)
    }
    for (const [property, value, priority] of inline) (element as HTMLElement).style.setProperty(property, value, priority)
    if (tokenColor && /^#[0-9a-f]{3,8}$/i.test(tokenColor)) (element as HTMLElement).style.color = tokenColor
  }
  assertCurrent(options.signal)
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:800px;visibility:hidden;pointer-events:none'
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancelled); frame.onload = null }
      const cancelled = () => { cleanup(); reject(new PluginError('Cancelled', 'HTML copy was cancelled')) }
      const timeout = window.setTimeout(() => { cleanup(); reject(new PluginError('Timeout', 'Rich-text rendering timed out')) }, PLUGIN_HTML_EXPORT_LIMITS.renderTimeoutMs)
      frame.onload = () => { cleanup(); resolve() }
      options.signal?.addEventListener('abort', cancelled, { once: true })
      if (options.signal?.aborted) { cancelled(); return }
      const defaults = DOCUMENT_STYLES.replaceAll('body.notegen-export', '.notegen-export')
      // Inline CSS is filtered above; CSP blocks all network access and scripts.
      frame.srcdoc = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>${defaults}\n${styles.css}</style></head><body><article class="notegen-export">${template.innerHTML}</article></body></html>`
      document.body.appendChild(frame)
    })
    assertCurrent(options.signal)
    const doc = frame.contentDocument
    const win = frame.contentWindow
    const root = doc?.querySelector<HTMLElement>('.notegen-export')
    if (!doc || !win || !root) throw new PluginError('RuntimeFailure', 'Rich-text rendering is unavailable')
    const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
    for (const node of nodes) {
      assertCurrent(options.signal)
      const computed = win.getComputedStyle(node)
      const values = portableProperties.map(property => [property, computed.getPropertyValue(property)] as const)
      node.removeAttribute('style')
      for (const [property, value] of values) {
        if (value && !unsafeCss.test(value)) node.style.setProperty(property, value)
      }
      node.removeAttribute('data-streamdown')
    }
    const result = root.outerHTML
    const text = plainText(root).replace(/\t+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (new TextEncoder().encode(result).byteLength > PLUGIN_HTML_EXPORT_LIMITS.exportBytes) throw new PluginError('QuotaExceeded', 'Rich text exceeds its byte limit')
    return { html: result, text, warnings }
  } finally { frame.remove() }
}
