import { createSpecStreamCompiler, type Spec } from '@json-render/core'
import { isChatResponseElementId, parseChatResponseElement, parseChatResponseSpec } from './response-catalog'
import { RESPONSE_LIMITS } from './response-limits'

interface JsonFrame {
  kind: 'object' | 'array'
  path: string[]
  start: number
  phase: 'key' | 'colon' | 'value' | 'separator'
  key?: string
  index: number
}

export interface ChatResponseStreamSnapshot { title: string; spec: Spec }

/** Adapt the existing streamed tool JSON into native SpecStream patches.
 * Only complete, schema-checked elements reach the compiler; fragments never execute actions.
 */
export function createChatResponseStream() {
  const compiler = createSpecStreamCompiler<Spec>({ elements: {} })
  const elementIds = new Set<string>()
  const frames: JsonFrame[] = []
  let input = ''
  let position = 0
  let stringStart = -1
  let stringIsKey = false
  let escaped = false
  let primitiveStart = -1
  let invalid = false
  let closed = false
  let dirty = false
  let title = ''

  const fail = () => { invalid = true; dirty = true }
  const valuePath = (frame?: JsonFrame) => frame
    ? [...frame.path, frame.kind === 'array' ? String(frame.index) : frame.key ?? ''] : []
  const complete = () => {
    const parent = frames.at(-1)
    if (parent) parent.phase = 'separator'
    else closed = true
  }
  const emit = (path: string[], start: number, end: number) => {
    const isTitle = path.length === 1 && path[0] === 'title'
    const isRoot = path.length === 2 && path[0] === 'spec' && path[1] === 'root'
    const isElement = path.length === 3 && path[0] === 'spec' && path[1] === 'elements'
    if (!isTitle && !isRoot && !isElement) return
    try {
      const value: unknown = JSON.parse(input.slice(start, end))
      if (isTitle && typeof value === 'string' && value.trim() && value.length <= 200) {
        title = value.trim()
        dirty = true
      } else if (isRoot && isChatResponseElementId(value)) {
        compiler.push(`${JSON.stringify({ op: 'add', path: '/root', value })}\n`)
        dirty = true
      } else if (isElement && isChatResponseElementId(path[2])) {
        const element = parseChatResponseElement(value)
        elementIds.add(path[2])
        if (elementIds.size > RESPONSE_LIMITS.elements) { fail(); return }
        compiler.push(`${JSON.stringify({ op: 'add', path: `/elements/${path[2]}`, value: element })}\n`)
        dirty = true
      }
    } catch {
      // A malformed element is withheld. The final tool validates the full original arguments.
    }
  }

  const push = (chunk: string) => {
    if (invalid || !chunk) return
    if (input.length + chunk.length > RESPONSE_LIMITS.specChars * 2 + 2_048) { fail(); return }
    input += chunk
    while (position < input.length && !invalid) {
      const char = input[position]
      const frame = frames.at(-1)
      if (stringStart >= 0) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') {
          if (stringIsKey) {
            try {
              const key: unknown = JSON.parse(input.slice(stringStart, position + 1))
              if (!frame || typeof key !== 'string' || key.length > 256) { fail(); break }
              frame.key = key
              frame.phase = 'colon'
            } catch { fail(); break }
          } else {
            emit(valuePath(frame), stringStart, position + 1)
            complete()
          }
          stringStart = -1
        }
        position += 1
        continue
      }
      if (primitiveStart >= 0) {
        if (!/[\s,}\]]/.test(char)) { position += 1; continue }
        emit(valuePath(frame), primitiveStart, position)
        primitiveStart = -1
        complete()
      }
      if (/[\t\n\r ]/.test(char)) { position += 1; continue }
      if (closed) { fail(); break }
      if (char === '"') {
        if (!frame || (frame.phase !== 'key' && frame.phase !== 'value')) { fail(); break }
        stringStart = position
        stringIsKey = frame.kind === 'object' && frame.phase === 'key'
      } else if (char === '{' || char === '[') {
        if ((frame && frame.phase !== 'value') || frames.length >= 64) { fail(); break }
        frames.push({ kind: char === '{' ? 'object' : 'array', path: valuePath(frame), start: position,
          phase: char === '{' ? 'key' : 'value', index: 0 })
      } else if (char === '}' || char === ']') {
        if (!frame || frame.kind !== (char === '}' ? 'object' : 'array')
          || frame.phase === 'colon' || (frame.kind === 'object' && frame.phase === 'value')) { fail(); break }
        frames.pop()
        emit(frame.path, frame.start, position + 1)
        complete()
      } else if (char === ':') {
        if (!frame || frame.kind !== 'object' || frame.phase !== 'colon') { fail(); break }
        frame.phase = 'value'
      } else if (char === ',') {
        if (!frame || frame.phase !== 'separator') { fail(); break }
        frame.phase = frame.kind === 'object' ? 'key' : 'value'
        frame.key = undefined
        frame.index += 1
      } else {
        if (!frame || frame.phase !== 'value') { fail(); break }
        primitiveStart = position
      }
      position += 1
    }
  }

  /** undefined means no changes, null means no publishable preview yet. */
  const snapshot = (): ChatResponseStreamSnapshot | null | undefined => {
    if (!dirty) return undefined
    dirty = false
    if (invalid) return null
    const partial = compiler.getResult()
    if (!partial.root || !Object.hasOwn(partial.elements, partial.root)) return null
    const seen = new Set<string>()
    const elements: Spec['elements'] = {}
    const visit = (id: string, depth: number): boolean => {
      if (!Object.hasOwn(partial.elements, id) || seen.has(id) || depth > RESPONSE_LIMITS.depth) return false
      const element = partial.elements[id]
      seen.add(id)
      const children = (element.children ?? []).filter(child => visit(child, depth + 1))
      elements[id] = { type: element.type, props: element.props, children }
      return true
    }
    visit(partial.root, 0)
    try {
      return { title, spec: parseChatResponseSpec({ root: partial.root, elements }) }
    } catch { return null }
  }

  return { push, snapshot }
}
