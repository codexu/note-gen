import { CODE_BLOCK_LIMITS } from './code-block-contract'

const SVG_NS = 'http://www.w3.org/2000/svg'
const elements = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath', 'clipPath', 'mask', 'marker', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feFlood', 'feComposite', 'feMerge', 'feMergeNode'])
const attributes = new Set(['id', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'textLength', 'lengthAdjust', 'dominant-baseline', 'alignment-baseline', 'dx', 'dy', 'rotate', 'preserveAspectRatio', 'clip-path', 'clipPathUnits', 'mask', 'maskUnits', 'filter', 'filterUnits', 'stdDeviation', 'in', 'in2', 'result', 'mode', 'type', 'values', 'flood-color', 'flood-opacity', 'operator', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform', 'marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient', 'vector-effect', 'visibility', 'display', 'color', 'text-decoration'])
const styleProperties = new Set(['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline', 'color', 'background', 'background-color', 'text-decoration'])
function safePaint(value: string) {
  // Only local fragment paint servers; no CSS escapes, external URLs or imports.
  return !/[\\<>@]/.test(value) && !/url\s*\(/i.test(value.replace(/url\(\s*(['"]?)#[A-Za-z0-9_.:-]+\1\s*\)/gi, ''))
}

/** Rebuild a static allowlisted SVG, then display as an image, never host HTML. */
export function sanitizeCodeBlockSvg(source: string): string {
  if (new TextEncoder().encode(source).length > CODE_BLOCK_LIMITS.resultBytes || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Invalid or oversized SVG')
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg' || parsed.documentElement.namespaceURI !== SVG_NS) throw new Error('Invalid SVG')
  const output = document.implementation.createDocument(SVG_NS, 'svg')
  let count = 0
  const copy = (sourceElement: Element, target: Element, depth: number) => {
    if (++count > 20_000 || depth > 80) throw new Error('SVG complexity limit exceeded')
    for (const attribute of Array.from(sourceElement.attributes)) {
      if (attribute.name === 'style') {
        const style = document.createElement('span').style
        style.cssText = attribute.value
        const accepted: string[] = []
        for (let index = 0; index < style.length; index++) {
          const name = style[index]
          const value = style.getPropertyValue(name)
          if (styleProperties.has(name) && safePaint(value) && (name !== 'background' || CSS.supports('color', value))) accepted.push(`${name}:${value}`)
        }
        if (accepted.length) target.setAttribute('style', accepted.join(';'))
      } else if ((attribute.localName === 'href') && /^#[A-Za-z0-9_.:-]+$/.test(attribute.value)) {
        target.setAttribute('href', attribute.value)
      } else if (!attribute.namespaceURI && attributes.has(attribute.name) && safePaint(attribute.value)) {
        target.setAttribute(attribute.name, attribute.value)
      }
    }
    for (const child of Array.from(sourceElement.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) target.appendChild(output.createTextNode(child.textContent ?? ''))
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element
        if (element.namespaceURI !== SVG_NS || !elements.has(element.localName)) continue
        const next = output.createElementNS(SVG_NS, element.localName)
        copy(element, next, depth + 1)
        target.appendChild(next)
      }
    }
  }
  copy(parsed.documentElement, output.documentElement, 0)
  const root = output.documentElement
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number)
  if (viewBox && (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0)) throw new Error('Invalid SVG viewBox')
  const dimension = (name: string, fallback: number) => {
    const raw = root.getAttribute(name)
    if (!raw || raw.endsWith('%')) return fallback
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(raw)) throw new Error('Invalid SVG dimensions')
    return Number.parseFloat(raw)
  }
  const width = dimension('width', viewBox?.[2] ?? 300)
  const height = dimension('height', viewBox?.[3] ?? 150)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) throw new Error('SVG dimensions exceed the limit')
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  return new XMLSerializer().serializeToString(output)
}

export interface CodeBlockImage { dataUrl: string; bytes: number }
export function normalizeCodeBlockOutput(result: unknown): CodeBlockImage {
  if (!result || typeof result !== 'object' || !('type' in result)) throw new Error('Invalid renderer result')
  if (result.type === 'svg' && 'svg' in result && typeof result.svg === 'string') {
    const svg = sanitizeCodeBlockSvg(result.svg)
    return { dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, bytes: new TextEncoder().encode(svg).length }
  }
  if (result.type === 'png' && 'bytes' in result && result.bytes instanceof Uint8Array) {
    const bytes = result.bytes
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length > CODE_BLOCK_LIMITS.resultBytes || bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) throw new Error('Invalid or oversized PNG')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR' || String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4)) !== 'IEND') throw new Error('Invalid PNG structure')
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) throw new Error('PNG dimensions exceed the limit')
    let binary = ''
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
    return { dataUrl: `data:image/png;base64,${btoa(binary)}`, bytes: bytes.length }
  }
  throw new Error('Renderer must return SVG or PNG')
}
