import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
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
}

interface ViewportRange {
  from: number
  to: number
}

const VIEWPORT_POSITION_OVERSCAN = 2_000
const HIGHLIGHT_CHARACTER_LIMIT = 20_000
const AUTO_HIGHLIGHT_CHARACTER_LIMIT = 5_000

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

function buildViewportDecorations({
  doc,
  from,
  to,
  name,
  lowlight,
  defaultLanguage,
}: {
  doc: ProseMirrorNode
  from: number
  to: number
  name: string
  lowlight: Lowlight
  defaultLanguage?: string | null
}) {
  if (to <= from) return DecorationSet.empty

  const decorations: Decoration[] = []
  const registeredLanguages = new Set(lowlight.listLanguages())

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== name) return true
    if (node.textContent.length > HIGHLIGHT_CHARACTER_LIMIT) return false

    const language = typeof node.attrs.language === 'string' && node.attrs.language
      ? node.attrs.language
      : defaultLanguage

    const languageIsRegistered = Boolean(
      language && (registeredLanguages.has(language) || lowlight.registered(language))
    )
    let result: ReturnType<Lowlight['highlight']> | null = null
    try {
      result = languageIsRegistered && language
        ? lowlight.highlight(language, node.textContent)
        : !language && node.textContent.length <= AUTO_HIGHLIGHT_CHARACTER_LIMIT
          ? lowlight.highlightAuto(node.textContent)
          : null
    } catch {
      result = null
    }
    if (!result) return false
    let tokenFrom = pos + 1

    for (const token of flattenHighlightNodes(result.children)) {
      const tokenTo = tokenFrom + token.text.length
      if (token.classes.length > 0) {
        decorations.push(Decoration.inline(tokenFrom, tokenTo, {
          class: token.classes.join(' '),
        }))
      }
      tokenFrom = tokenTo
    }

    return false
  })

  return DecorationSet.create(doc, decorations)
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
  let lowlight: Lowlight | null = null

  return new Plugin<ViewportLowlightState>({
    key: pluginKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty }),
      apply: (transaction, pluginState, _oldState, newState) => {
        const viewportRange = transaction.getMeta(pluginKey) as ViewportRange | undefined
        if (viewportRange) {
          if (!lowlight) {
            return { decorations: DecorationSet.empty }
          }

          return {
            decorations: buildViewportDecorations({
              doc: newState.doc,
              ...viewportRange,
              name,
              lowlight,
              defaultLanguage,
            }),
          }
        }

        return transaction.docChanged
          ? { decorations: DecorationSet.empty }
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

        scrollRoot?.removeEventListener('scroll', scheduleUpdate)
        rootResizeObserver?.disconnect()
        scrollRoot = nextScrollRoot
        scrollRoot?.addEventListener('scroll', scheduleUpdate, { passive: true })
        if (scrollRoot) rootResizeObserver?.observe(scrollRoot)
      }

      function updateDecorations() {
        frameId = null
        if (!hasPaintedBasicDocument) return

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

        lastDoc = editorView.state.doc
        lastRange = range
        editorView.dispatch(
          editorView.state.tr
            .setMeta(pluginKey, range)
            .setMeta('addToHistory', false)
        )
      }

      function scheduleUpdate() {
        if (frameId !== null) cancelAnimationFrame(frameId)
        frameId = requestAnimationFrame(updateDecorations)
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
          scrollRoot?.removeEventListener('scroll', scheduleUpdate)
          rootResizeObserver?.disconnect()
          window.removeEventListener('resize', scheduleUpdate)
        },
      }
    },
  })
}
