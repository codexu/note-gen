import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface AiSuggestionHighlightRange {
  from: number
  to: number
}

interface AiSuggestionHighlightState {
  from: number
  to: number
}

type AiSuggestionHighlightMeta =
  | { type: 'set'; range: AiSuggestionHighlightRange }
  | { type: 'clear' }

const emptyAiSuggestionHighlight: AiSuggestionHighlightState = {
  from: 0,
  to: 0,
}

export const aiSuggestionHighlightPluginKey = new PluginKey<AiSuggestionHighlightState>('aiSuggestionHighlight')

function normalizeHighlightRange(
  range: AiSuggestionHighlightRange,
  docSize: number,
): AiSuggestionHighlightState {
  const from = Math.max(0, Math.min(range.from, docSize))
  const to = Math.max(0, Math.min(range.to, docSize))

  if (from === to) {
    return emptyAiSuggestionHighlight
  }

  return {
    from: Math.min(from, to),
    to: Math.max(from, to),
  }
}

export function setAiSuggestionHighlight(editor: Editor, range?: AiSuggestionHighlightRange) {
  if (editor.isDestroyed || !range) {
    clearAiSuggestionHighlight(editor)
    return
  }

  const normalizedRange = normalizeHighlightRange(range, editor.state.doc.content.size)

  if (normalizedRange.from === normalizedRange.to) {
    clearAiSuggestionHighlight(editor)
    return
  }

  editor.view.dispatch(editor.state.tr.setMeta(aiSuggestionHighlightPluginKey, {
    type: 'set',
    range: normalizedRange,
  } satisfies AiSuggestionHighlightMeta))
}

export function clearAiSuggestionHighlight(editor: Editor) {
  if (editor.isDestroyed) {
    return
  }

  editor.view.dispatch(editor.state.tr.setMeta(aiSuggestionHighlightPluginKey, {
    type: 'clear',
  } satisfies AiSuggestionHighlightMeta))
}

export const AiSuggestionHighlight = Extension.create({
  name: 'aiSuggestionHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<AiSuggestionHighlightState>({
        key: aiSuggestionHighlightPluginKey,
        state: {
          init: () => emptyAiSuggestionHighlight,
          apply(tr, value) {
            const meta = tr.getMeta(aiSuggestionHighlightPluginKey) as AiSuggestionHighlightMeta | undefined

            if (meta?.type === 'clear') {
              return emptyAiSuggestionHighlight
            }

            if (meta?.type === 'set') {
              return normalizeHighlightRange(meta.range, tr.doc.content.size)
            }

            if (value.from === value.to || !tr.docChanged) {
              return value
            }

            return normalizeHighlightRange({
              from: tr.mapping.map(value.from, -1),
              to: tr.mapping.map(value.to, 1),
            }, tr.doc.content.size)
          },
        },
        props: {
          decorations(state) {
            const pluginState = aiSuggestionHighlightPluginKey.getState(state)

            if (!pluginState || pluginState.from === pluginState.to) {
              return DecorationSet.empty
            }

            return DecorationSet.create(state.doc, [
              Decoration.inline(pluginState.from, pluginState.to, {
                class: 'tiptap-ai-generated-highlight',
              }),
            ])
          },
        },
      }),
    ]
  },
})
