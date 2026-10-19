import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { createLowlight } from 'lowlight'
import { getEditorViewportRoot } from './viewport-activation'
import { getCommonLowlight } from './code-block-languages'

type Lowlight = ReturnType<typeof createLowlight>

interface HighlightToken {
  classes: string[]
  text: string
}

interface ViewportLowlightState {
  decorations: DecorationSet
  blocks: ViewportCodeBlock[]
}

interface ViewportRange {
  from: number
  to: number
}

interface ViewportCodeBlock {
  node: ProseMirrorNode
  pos: number
}

const VIEWPORT_POSITION_OVERSCAN = 2_000
const HIGHLIGHT_CHARACTER_LIMIT = 20_000
const AUTO_HIGHLIGHT_CHARACTER_LIMIT = 5_000
const SCROLL_HIGHLIGHT_DELAY_MS = 100

function getStringClasses(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function flattenHighlightNodes(nodes: readonly unknown[], inheritedClasses: string[] = []): HighlightToken[] {
  const tokens: HighlightToken[] = []

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue

    const record = node as Record<string, unknown>
    const properties = record.properties && typeof record.properties === 'object'
      ? record.properties as Record<string, unknown>
      : null
    const classes = [
      ...inheritedClasses,
      ...getStringClasses(properties?.className),
    ]

    if (Array.isArray(record.children)) {
      tokens.push(...flattenHighlightNodes(record.children, classes))
    } else if (typeof record.value === 'string') {
      tokens.push({ classes, text: record.value })
    }
  }

  return tokens
}

function getHighlightTokens({
  node,
  lowlight,
  defaultLanguage,
  tokenCache,
}: {
  node: ProseMirrorNode
  lowlight: Lowlight
  defaultLanguage?: string | null
  tokenCache: WeakMap<ProseMirrorNode, HighlightToken[]>
}): HighlightToken[] {
  const cached = tokenCache.get(node)
  if (cached) return cached

  const text = node.textContent
  const language = typeof node.attrs.language === 'string' && node.attrs.language
    ? node.attrs.language
    : defaultLanguage
  let tokens: HighlightToken[] = []

  if (text.length <= HIGHLIGHT_CHARACTER_LIMIT) {
    try {
      const result = language && lowlight.registered(language)
        ? lowlight.highlight(language, text)
        : !language && text.length <= AUTO_HIGHLIGHT_CHARACTER_LIMIT
          ? lowlight.highlightAuto(text)
          : null
      if (result) tokens = flattenHighlightNodes(result.children)
    } catch {
      // Leave unsupported or invalid code readable without token decorations.
    }
  }

  // Content and language attributes belong to the immutable ProseMirror node.
  // Scrolling back to it or editing another paragraph can reuse the same tokens.
  tokenCache.set(node, tokens)
  return tokens
}

function getViewportCodeBlocks(doc: ProseMirrorNode, range: ViewportRange, name: string) {
  const blocks: ViewportCodeBlock[] = []
  if (range.to <= range.from) return blocks

  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (node.type.name === name) {
      blocks.push({ node, pos })
      return false
    }
    return !node.isTextblock
  })
  return blocks
}

function sameCodeBlocks(left: ViewportCodeBlock[], right: ViewportCodeBlock[]) {
  return left.length === right.length && left.every((block, index) => (
    block.node === right[index].node && block.pos === right[index].pos
  ))
}

function buildViewportDecorations({
  doc,
  blocks,
  lowlight,
  defaultLanguage,
  tokenCache,
}: {
  doc: ProseMirrorNode
  blocks: ViewportCodeBlock[]
  lowlight: Lowlight
  defaultLanguage?: string | null
  tokenCache: WeakMap<ProseMirrorNode, HighlightToken[]>
}) {
  const decorations: Decoration[] = []
  for (const { node, pos } of blocks) {
    let tokenFrom = pos + 1

    for (const token of getHighlightTokens({ node, lowlight, defaultLanguage, tokenCache })) {
      const tokenTo = tokenFrom + token.text.length
      if (token.classes.length > 0) {
        decorations.push(Decoration.inline(tokenFrom, tokenTo, {
          class: token.classes.join(' '),
        }))
      }
      tokenFrom = tokenTo
    }
  }

  return DecorationSet.create(doc, decorations)
}

function mapViewportDecorations(transaction: Transaction, state: ViewportLowlightState): ViewportLowlightState {
  const blocks: ViewportCodeBlock[] = []
  const removedDecorations: Decoration[] = []

  for (const block of state.blocks) {
    const mapped = transaction.mapping.mapResult(block.pos, 1)
    const pos = mapped.pos
    if (!mapped.deleted && pos < transaction.doc.content.size && transaction.doc.nodeAt(pos) === block.node) {
      blocks.push({ node: block.node, pos })
    } else {
      removedDecorations.push(...state.decorations.find(
        block.pos + 1,
        block.pos + block.node.nodeSize - 1,
      ))
    }
  }

  // Keep unchanged code highlighted in the input transaction itself. Only a
  // changed block loses its obsolete tokens until the next viewport update.
  return {
    blocks,
    decorations: state.decorations.remove(removedDecorations).map(transaction.mapping, transaction.doc),
  }
}

function getViewportRange(view: EditorView): ViewportRange {
  const root = getEditorViewportRoot(view.dom)
  const rootRect = root?.getBoundingClientRect() ?? view.dom.getBoundingClientRect()
  const editorRect = view.dom.getBoundingClientRect()
  const visibleLeft = Math.max(rootRect.left, editorRect.left)
  const visibleRight = Math.min(rootRect.right, editorRect.right)
  const visibleTop = Math.max(rootRect.top, editorRect.top)
  const visibleBottom = Math.min(rootRect.bottom, editorRect.bottom)
  if (
    rootRect.width <= 0
    || rootRect.height <= 0
    || editorRect.width <= 0
    || editorRect.height <= 0
    || visibleRight <= visibleLeft
    || visibleBottom <= visibleTop
  ) {
    return { from: 0, to: 0 }
  }
  const left = Math.min(visibleRight - 1, visibleLeft + 16)
  const topPosition = view.posAtCoords({ left, top: visibleTop + 1 })?.pos
  const bottomPosition = view.posAtCoords({ left, top: visibleBottom - 1 })?.pos
  const selectionPosition = view.state.selection.head
  const visibleFrom = topPosition ?? selectionPosition
  const visibleTo = bottomPosition ?? selectionPosition

  return {
    from: Math.max(0, Math.min(visibleFrom, visibleTo) - VIEWPORT_POSITION_OVERSCAN),
    to: Math.min(
      view.state.doc.content.size,
      Math.max(visibleFrom, visibleTo) + VIEWPORT_POSITION_OVERSCAN
    ),
  }
}

export function createViewportLowlightPlugin({
  name,
  defaultLanguage,
  shouldHighlight,
}: {
  name: string
  defaultLanguage?: string | null
  shouldHighlight?: () => boolean
}) {
  const pluginKey = new PluginKey<ViewportLowlightState>('viewportLowlight')
  const tokenCache = new WeakMap<ProseMirrorNode, HighlightToken[]>()
  let lowlight: Lowlight | null = null

  return new Plugin<ViewportLowlightState>({
    key: pluginKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, blocks: [] }),
      apply: (transaction, pluginState) => {
        const prepared = transaction.getMeta(pluginKey) as ViewportLowlightState | undefined
        if (prepared) return prepared
        return transaction.docChanged
          ? mapViewportDecorations(transaction, pluginState)
          : pluginState
      },
    },
    props: {
      decorations(state) {
        return pluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
    view: (editorView) => {
      let scrollRoot: Element | null = null
      let frameId: number | null = null
      let initialFrameId: number | null = null
      let scrollTimer: number | null = null
      let hasPaintedBasicDocument = false
      let isDestroyed = false
      let isLoadingLowlight = false
      let lastDoc: ProseMirrorNode | null = null
      let lastRange: ViewportRange | null = null
      const rootResizeObserver = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleUpdate)

      function refreshScrollRoot() {
        const nextScrollRoot = getEditorViewportRoot(editorView.dom)
        if (nextScrollRoot === scrollRoot) return

        clearScrollUpdate()
        scrollRoot?.removeEventListener('scroll', scheduleScrollUpdate)
        rootResizeObserver?.disconnect()
        scrollRoot = nextScrollRoot
        scrollRoot?.addEventListener('scroll', scheduleScrollUpdate, { passive: true })
        if (scrollRoot) rootResizeObserver?.observe(scrollRoot)
      }

      function updateDecorations() {
        frameId = null
        if (isDestroyed || editorView.isDestroyed || !hasPaintedBasicDocument) return

        // EditorView is created on a detached element and moved into EditorContent
        // afterwards, so resolve the actual scroll root lazily.
        refreshScrollRoot()
        if (shouldHighlight && !shouldHighlight()) return

        if (!lowlight) {
          if (!isLoadingLowlight) {
            isLoadingLowlight = true
            void getCommonLowlight()
              .then((loadedLowlight) => {
                if (isDestroyed) return
                lowlight = loadedLowlight
                lastDoc = null
                scheduleUpdate()
              })
              .catch(() => {
                isLoadingLowlight = false
              })
          }
          return
        }

        const range = getViewportRange(editorView)
        if (
          lastDoc === editorView.state.doc
          && lastRange?.from === range.from
          && lastRange.to === range.to
        ) {
          return
        }

        const doc = editorView.state.doc
        lastDoc = doc
        lastRange = range
        const blocks = getViewportCodeBlocks(doc, range, name)
        const current = pluginKey.getState(editorView.state)
        if (current && sameCodeBlocks(current.blocks, blocks)) return

        const prepared: ViewportLowlightState = {
          blocks,
          decorations: buildViewportDecorations({
            doc,
            blocks,
            lowlight,
            defaultLanguage,
            tokenCache,
          }),
        }
        editorView.dispatch(
          editorView.state.tr
            .setMeta(pluginKey, prepared)
            .setMeta('addToHistory', false)
        )
      }

      function scheduleUpdate() {
        if (isDestroyed || editorView.isDestroyed) return
        if (frameId !== null) return
        frameId = requestAnimationFrame(updateDecorations)
      }

      function clearScrollUpdate() {
        if (scrollTimer === null) return
        window.clearTimeout(scrollTimer)
        scrollTimer = null
      }

      function scheduleScrollUpdate() {
        if (isDestroyed || editorView.isDestroyed) return
        clearScrollUpdate()
        // Moving token decorations updates editable DOM. Wait for scrolling to
        // settle; content edits and selection changes keep their normal frame.
        scrollTimer = window.setTimeout(() => {
          scrollTimer = null
          scheduleUpdate()
        }, SCROLL_HIGHLIGHT_DELAY_MS)
      }

      window.addEventListener('resize', scheduleUpdate, { passive: true })
      // Let the basic document paint before adding token decorations.
      initialFrameId = requestAnimationFrame(() => {
        initialFrameId = requestAnimationFrame(() => {
          initialFrameId = null
          hasPaintedBasicDocument = true
          scheduleUpdate()
        })
      })

      return {
        update: (view, previousState) => {
          if (
            view.state.doc !== previousState.doc
            || !view.state.selection.eq(previousState.selection)
          ) {
            scheduleUpdate()
          }
        },
        destroy: () => {
          isDestroyed = true
          if (frameId !== null) cancelAnimationFrame(frameId)
          if (initialFrameId !== null) cancelAnimationFrame(initialFrameId)
          clearScrollUpdate()
          scrollRoot?.removeEventListener('scroll', scheduleScrollUpdate)
          rootResizeObserver?.disconnect()
          window.removeEventListener('resize', scheduleUpdate)
          lastDoc = null
          lastRange = null
        },
      }
    },
  })
}
