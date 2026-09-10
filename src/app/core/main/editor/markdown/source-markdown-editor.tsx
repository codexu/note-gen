'use client'

import { PluginError } from '@notegen/plugin-api'

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search'
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  WidgetType,
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface SourceMarkdownRemoteCursor {
  deviceId: string
  label: string
  anchor: number
  head: number
}

interface SourceMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSelectionChange?: (selection: { from: number; to: number }) => void
  selection?: { from: number; to: number }
  remoteCursors?: readonly SourceMarkdownRemoteCursor[]
  onControllerChange?: (controller: SourceMarkdownEditorController | null) => void
  onUndoRedoChange?: (state: { undo: boolean; redo: boolean }) => void
  onViewStateChange?: (state: SourceMarkdownEditorViewState) => void
  onFocusChange?: (focused: boolean) => void
  initialScrollTop?: number
  editable: boolean
  showLineNumbers: boolean
  lineWrapping: boolean
  fontSize: number
  lineHeight: number
  ariaLabel: string
  className?: string
}

export interface SourceMarkdownEditorController {
  isComposing: () => boolean
  applyEdits: (edits: readonly { from: number; to: number; text: string }[]) => void
  setSelection: (from: number, to: number) => void
  isFocused: () => boolean
  undo: () => boolean
  redo: () => boolean
  getUndoRedoState: () => { undo: boolean; redo: boolean }
  openSearch: () => boolean
  find: (query: string) => boolean
  replaceValue: (
    value: string,
    selection?: { from: number; to: number }
  ) => void
}

export interface SourceMarkdownEditorViewState {
  selection: { from: number; to: number }
  scrollTop: number
}

const REMOTE_CURSOR_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2']

function remoteCursorColor(deviceId: string) {
  let hash = 0
  for (const character of deviceId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  return REMOTE_CURSOR_COLORS[Math.abs(hash) % REMOTE_CURSOR_COLORS.length]!
}

class RemoteCursorWidget extends WidgetType {
  constructor(
    private readonly deviceId: string,
    private readonly label: string,
    private readonly color: string,
  ) {
    super()
  }

  eq(other: WidgetType) {
    return other instanceof RemoteCursorWidget
      && other.deviceId === this.deviceId
      && other.label === this.label
      && other.color === this.color
  }

  toDOM() {
    const cursor = document.createElement('span')
    cursor.className = 'cm-self-hosted-remote-cursor'
    cursor.style.borderLeftColor = this.color
    cursor.setAttribute('aria-label', `${this.label} 的光标`)

    const label = document.createElement('span')
    label.className = 'cm-self-hosted-remote-cursor-label'
    label.style.backgroundColor = this.color
    label.textContent = this.label
    cursor.append(label)
    return cursor
  }
}

function createRemoteCursorDecorations(
  cursors: readonly SourceMarkdownRemoteCursor[],
  documentLength: number,
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  for (const cursor of cursors) {
    const anchor = Math.max(0, Math.min(cursor.anchor, documentLength))
    const head = Math.max(0, Math.min(cursor.head, documentLength))
    const color = remoteCursorColor(cursor.deviceId)
    const label = cursor.label.trim() || '其他设备'
    if (anchor !== head) {
      decorations.push(Decoration.mark({
        class: 'cm-self-hosted-remote-selection',
        attributes: {
          style: `background-color: color-mix(in srgb, ${color} 22%, transparent);`,
        },
      }).range(Math.min(anchor, head), Math.max(anchor, head)))
    }
    decorations.push(Decoration.widget({
      widget: new RemoteCursorWidget(cursor.deviceId, label, color),
      side: 1,
    }).range(head))
  }
  return Decoration.set(decorations, true)
}

const setRemoteCursors = StateEffect.define<readonly SourceMarkdownRemoteCursor[]>()

const remoteCursorDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setRemoteCursors)) {
        next = createRemoteCursorDecorations(effect.value, transaction.newDoc.length)
      }
    }
    return next
  },
  provide: field => EditorView.decorations.from(field),
})

function createEditorTheme(fontSize: number, lineHeight: number) {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'hsl(var(--foreground))',
      fontSize: `${fontSize}px`,
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      lineHeight: String(lineHeight),
      scrollbarGutter: 'stable',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '24px 16px',
      caretColor: 'hsl(var(--foreground))',
    },
    '.cm-line': {
      padding: '0',
    },
    '.cm-gutters': {
      minHeight: '100%',
      borderRight: '1px solid hsl(var(--border))',
      backgroundColor: 'color-mix(in oklab, hsl(var(--muted)) 20%, transparent)',
      color: 'hsl(var(--muted-foreground))',
    },
    '.cm-gutterElement': {
      paddingLeft: '8px',
      paddingRight: '12px',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'color-mix(in oklab, hsl(var(--muted)) 35%, transparent)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in oklab, hsl(var(--primary)) 24%, transparent) !important',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'hsl(var(--foreground))',
    },
    '.cm-self-hosted-remote-selection': {
      borderRadius: '2px',
    },
    '.cm-self-hosted-remote-cursor': {
      position: 'relative',
      zIndex: '2',
      display: 'inline-block',
      width: '0',
      height: '1.25em',
      marginLeft: '-1px',
      borderLeft: '2px solid',
      opacity: '0.5',
      pointerEvents: 'auto',
      transition: 'opacity 150ms ease',
      verticalAlign: 'text-bottom',
    },
    '.cm-self-hosted-remote-cursor:hover': {
      opacity: '1',
    },
    '.cm-self-hosted-remote-cursor-label': {
      position: 'absolute',
      bottom: 'calc(100% + 2px)',
      left: '-2px',
      maxWidth: '8rem',
      overflow: 'hidden',
      borderRadius: '4px 4px 4px 0',
      padding: '1px 5px',
      color: 'white',
      fontSize: '10px',
      fontWeight: '600',
      lineHeight: '16px',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  })
}

export function SourceMarkdownEditor({
  value,
  onChange,
  onSelectionChange,
  selection,
  remoteCursors = [],
  onControllerChange,
  onUndoRedoChange,
  onViewStateChange,
  onFocusChange,
  initialScrollTop = 0,
  editable,
  showLineNumbers,
  lineWrapping,
  fontSize,
  lineHeight,
  ariaLabel,
  className,
}: SourceMarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onControllerChangeRef = useRef(onControllerChange)
  const onUndoRedoChangeRef = useRef(onUndoRedoChange)
  const onViewStateChangeRef = useRef(onViewStateChange)
  const onFocusChangeRef = useRef(onFocusChange)
  const appliedValueRef = useRef(value)
  const isApplyingExternalValueRef = useRef(false)
  const editableCompartmentRef = useRef(new Compartment())
  const gutterCompartmentRef = useRef(new Compartment())
  const wrappingCompartmentRef = useRef(new Compartment())
  const themeCompartmentRef = useRef(new Compartment())
  const attributesCompartmentRef = useRef(new Compartment())

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    onControllerChangeRef.current = onControllerChange
  }, [onControllerChange])

  useEffect(() => {
    onUndoRedoChangeRef.current = onUndoRedoChange
  }, [onUndoRedoChange])

  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange
  }, [onViewStateChange])

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange
  }, [onFocusChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const initialSelectionFrom = Math.max(0, Math.min(selection?.from ?? 0, value.length))
    const initialSelectionTo = Math.max(
      initialSelectionFrom,
      Math.min(selection?.to ?? initialSelectionFrom, value.length)
    )

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        selection: { anchor: initialSelectionFrom, head: initialSelectionTo },
        extensions: [
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown(),
          remoteCursorDecorations,
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          editableCompartmentRef.current.of([
            EditorState.readOnly.of(!editable),
            EditorView.editable.of(editable),
          ]),
          gutterCompartmentRef.current.of(
            showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []
          ),
          wrappingCompartmentRef.current.of(lineWrapping ? EditorView.lineWrapping : []),
          themeCompartmentRef.current.of(createEditorTheme(fontSize, lineHeight)),
          attributesCompartmentRef.current.of(EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            autocapitalize: 'off',
            autocomplete: 'off',
            spellcheck: 'false',
          })),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet) {
              const selection = update.state.selection.main
              onSelectionChangeRef.current?.({ from: selection.from, to: selection.to })
            }
            if (!update.docChanged) return

            onUndoRedoChangeRef.current?.({
              undo: undoDepth(update.state) > 0,
              redo: redoDepth(update.state) > 0,
            })
            if (isApplyingExternalValueRef.current) return

            const nextValue = update.state.doc.toString()
            appliedValueRef.current = nextValue
            onChangeRef.current(nextValue)
          }),
        ],
      }),
    })

    viewRef.current = view
    const handleFocus = () => onFocusChangeRef.current?.(true)
    const handleBlur = () => onFocusChangeRef.current?.(false)
    view.contentDOM.addEventListener('focus', handleFocus)
    view.contentDOM.addEventListener('blur', handleBlur)
    let restoreScrollFrame = window.requestAnimationFrame(() => {
      restoreScrollFrame = 0
      view.scrollDOM.scrollTop = initialScrollTop
    })
    const getUndoRedoState = () => ({
      undo: undoDepth(view.state) > 0,
      redo: redoDepth(view.state) > 0,
    })
    onControllerChangeRef.current?.({
      isFocused: () => view.hasFocus,
      undo: () => {
        const didUndo = undo(view)
        if (didUndo) view.focus()
        return didUndo
      },
      redo: () => {
        const didRedo = redo(view)
        if (didRedo) view.focus()
        return didRedo
      },
      getUndoRedoState,
      openSearch: () => openSearchPanel(view),
      find: (query) => {
        const normalizedQuery = query.trim().toLocaleLowerCase()
        if (!normalizedQuery) return false

        const index = view.state.doc.toString().toLocaleLowerCase().indexOf(normalizedQuery)
        if (index < 0) return false

        view.dispatch({
          selection: { anchor: index, head: index + query.trim().length },
          scrollIntoView: true,
        })
        view.focus()
        return true
      },
      replaceValue: (nextValue, nextSelection) => {
        const selectionFrom = Math.max(
          0,
          Math.min(nextSelection?.from ?? view.state.selection.main.from, nextValue.length)
        )
        const selectionTo = Math.max(
          selectionFrom,
          Math.min(nextSelection?.to ?? selectionFrom, nextValue.length)
        )
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: nextValue },
          selection: { anchor: selectionFrom, head: selectionTo },
          annotations: isolateHistory.of('full'),
        })
      },
      isComposing: () => view.composing,
      applyEdits: edits => {
        if (view.composing || view.state.facet(EditorState.readOnly)) throw new PluginError('EditorBusy', 'The source editor is composing or read-only')
        view.dispatch({ changes: edits.map(edit => ({ from: edit.from, to: edit.to, insert: edit.text })), annotations: isolateHistory.of('full') })
      },
      setSelection: (from, to) => {
        view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
        view.focus()
      },
    })
    onUndoRedoChangeRef.current?.(getUndoRedoState())
    const initialSelection = view.state.selection.main
    onSelectionChangeRef.current?.({
      from: initialSelection.from,
      to: initialSelection.to,
    })
    return () => {
      view.contentDOM.removeEventListener('focus', handleFocus)
      view.contentDOM.removeEventListener('blur', handleBlur)
      if (restoreScrollFrame) window.cancelAnimationFrame(restoreScrollFrame)
      const finalSelection = view.state.selection.main
      onViewStateChangeRef.current?.({
        selection: { from: finalSelection.from, to: finalSelection.to },
        scrollTop: view.scrollDOM.scrollTop,
      })
      onControllerChangeRef.current?.(null)
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: [
        editableCompartmentRef.current.reconfigure([
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
        ]),
        gutterCompartmentRef.current.reconfigure(
          showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []
        ),
        wrappingCompartmentRef.current.reconfigure(lineWrapping ? EditorView.lineWrapping : []),
        themeCompartmentRef.current.reconfigure(createEditorTheme(fontSize, lineHeight)),
        attributesCompartmentRef.current.reconfigure(EditorView.contentAttributes.of({
          'aria-label': ariaLabel,
          autocapitalize: 'off',
          autocomplete: 'off',
          spellcheck: 'false',
        })),
      ],
    })
  }, [ariaLabel, editable, fontSize, lineHeight, lineWrapping, showLineNumbers])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const valueChanged = appliedValueRef.current !== value
    const currentSelection = view.state.selection.main
    const requestedSelection = selection ?? currentSelection
    const nextSelectionFrom = Math.max(0, Math.min(requestedSelection.from, value.length))
    const nextSelectionTo = Math.max(
      nextSelectionFrom,
      Math.min(requestedSelection.to, value.length)
    )
    const selectionChanged = (
      currentSelection.from !== nextSelectionFrom
      || currentSelection.to !== nextSelectionTo
    )
    if (!valueChanged && !selectionChanged) return

    if (!valueChanged) {
      view.dispatch({ selection: { anchor: nextSelectionFrom, head: nextSelectionTo } })
      return
    }

    const currentLength = view.state.doc.length
    isApplyingExternalValueRef.current = true
    try {
      view.dispatch({
        changes: { from: 0, to: currentLength, insert: value },
        selection: { anchor: nextSelectionFrom, head: nextSelectionTo },
        annotations: Transaction.addToHistory.of(false),
      })
      appliedValueRef.current = value
    } finally {
      isApplyingExternalValueRef.current = false
    }
  }, [selection, value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setRemoteCursors.of(remoteCursors) })
  }, [remoteCursors])

  return (
    <div
      ref={containerRef}
      className={cn('h-full min-h-0 w-full overflow-hidden', className)}
    />
  )
}
