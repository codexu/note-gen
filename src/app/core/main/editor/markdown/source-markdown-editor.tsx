'use client'

import { PluginError } from '@notegen/plugin-api'

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  invertedEffects,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
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
  MapMode,
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
  placeholder as editorPlaceholder,
  WidgetType,
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { buildTextEdits } from '@/lib/agent/text-diff'

export interface SourceMarkdownRemoteCursor {
  deviceId: string
  label: string
  anchor: number
  head: number
}

interface SourceMarkdownEditorProps {
  language?: 'markdown' | 'css'
  placeholder?: string
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
  setEditable: (editable: boolean) => void
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

type SourceLineEnding = { position: number; ending: '\n' | '\r\n' | '\r' }

interface SourceSnapshot {
  value: string
  normalized: string
  endings: SourceLineEnding[]
  crlfPositions: { raw: number; normalized: number }[]
  preferredEnding: SourceLineEnding['ending']
}

// CodeMirror counts every line break as one position. Keep its coordinates
// separate from the exact Markdown string used by files, tools and history.
function createSourceSnapshot(value: string): SourceSnapshot {
  const endings: SourceLineEnding[] = []
  const crlfPositions: SourceSnapshot['crlfPositions'] = []
  const counts = new Map<SourceLineEnding['ending'], number>()
  let extraCharacters = 0
  const normalized = value.replace(/\r\n?|\n/g, (ending: string, raw: number) => {
    const position = raw - extraCharacters
    const lineEnding = ending as SourceLineEnding['ending']
    endings.push({ position, ending: lineEnding })
    counts.set(lineEnding, (counts.get(lineEnding) ?? 0) + 1)
    if (ending === '\r\n') {
      crlfPositions.push({ raw, normalized: position })
      extraCharacters++
    }
    return '\n'
  })
  let preferredEnding: SourceLineEnding['ending'] = '\n'
  let highestCount = 0
  for (const [ending, count] of counts) {
    if (count > highestCount) {
      preferredEnding = ending
      highestCount = count
    }
  }
  return { value, normalized, endings, crlfPositions, preferredEnding }
}

function precedingCrlf(snapshot: SourceSnapshot, position: number, coordinate: 'raw' | 'normalized') {
  let low = 0
  let high = snapshot.crlfPositions.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (snapshot.crlfPositions[middle][coordinate] < position) low = middle + 1
    else high = middle
  }
  return low
}

function toEditorPosition(snapshot: SourceSnapshot, position: number) {
  const bounded = Math.max(0, Math.min(position, snapshot.value.length))
  return bounded - precedingCrlf(snapshot, bounded, 'raw')
}

function toSourcePosition(snapshot: SourceSnapshot, position: number) {
  const bounded = Math.max(0, Math.min(position, snapshot.normalized.length))
  return bounded + precedingCrlf(snapshot, bounded, 'normalized')
}

const setSourceLineEndings = StateEffect.define<readonly SourceLineEnding[]>({
  map: (endings, changes) => endings.flatMap(({ position, ending }) => {
    const mapped = changes.mapPos(position, 1, MapMode.TrackAfter)
    return mapped === null ? [] : [{ position: mapped, ending }]
  }),
})

const sourceSnapshotField = StateField.define<SourceSnapshot>({
  create: state => createSourceSnapshot(state.doc.toString()),
  update(snapshot, transaction) {
    const overrides = transaction.effects.filter(effect => effect.is(setSourceLineEndings))
    if (!transaction.docChanged && overrides.length === 0) return snapshot
    const endings = new Map<number, SourceLineEnding['ending']>()
    for (const { position, ending } of snapshot.endings) {
      const mapped = transaction.changes.mapPos(position, 1, MapMode.TrackAfter)
      if (mapped !== null) endings.set(mapped, ending)
    }
    for (const effect of overrides) {
      for (const { position, ending } of effect.value) endings.set(position, ending)
    }
    return createSourceSnapshot(transaction.newDoc.toString().replace(/\n/g, (_match, position: number) => (
      endings.get(position) ?? snapshot.preferredEnding
    )))
  },
})

// Record only affected line endings alongside CodeMirror's text history. This
// also makes a pure CRLF/LF change undoable without saving full file snapshots.
const sourceLineEndingHistory = invertedEffects.of(transaction => {
  const overrides = new Map<number, SourceLineEnding['ending']>()
  for (const effect of transaction.effects) {
    if (effect.is(setSourceLineEndings)) {
      for (const { position, ending } of effect.value) overrides.set(position, ending)
    }
  }
  if (!transaction.docChanged && overrides.size === 0) return []
  const restore: SourceLineEnding[] = []
  for (const entry of transaction.startState.field(sourceSnapshotField).endings) {
    const mapped = transaction.changes.mapPos(entry.position, 1, MapMode.TrackAfter)
    if (mapped === null || (overrides.has(mapped) && overrides.get(mapped) !== entry.ending)) restore.push(entry)
  }
  return restore.length ? [setSourceLineEndings.of(restore)] : []
})

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
  language = 'markdown',
  placeholder,
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
  const languageCompartmentRef = useRef(new Compartment())
  const placeholderCompartmentRef = useRef(new Compartment())
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
    const initialSnapshot = createSourceSnapshot(value)
    const initialSelectionFrom = toEditorPosition(initialSnapshot, selection?.from ?? 0)
    const initialSelectionTo = Math.max(
      initialSelectionFrom,
      toEditorPosition(initialSnapshot, selection?.to ?? selection?.from ?? 0)
    )

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: initialSnapshot.normalized,
        selection: { anchor: initialSelectionFrom, head: initialSelectionTo },
        extensions: [
          EditorState.transactionFilter.of(transaction => (
            (transaction.docChanged || transaction.effects.some(effect => effect.is(setSourceLineEndings)))
            && transaction.startState.facet(EditorState.readOnly)
            && !isApplyingExternalValueRef.current
          ) ? [] : transaction),
          highlightSpecialChars(),
          sourceSnapshotField.init(() => initialSnapshot),
          sourceLineEndingHistory,
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageCompartmentRef.current.of(language === 'css' ? css() : markdown()),
          placeholderCompartmentRef.current.of(placeholder ? editorPlaceholder(placeholder) : []),
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
            const snapshot = update.state.field(sourceSnapshotField)
            const rawChanged = snapshot.value !== update.startState.field(sourceSnapshotField).value
            appliedValueRef.current = snapshot.value
            if (update.selectionSet || rawChanged) {
              const selection = update.state.selection.main
              onSelectionChangeRef.current?.({
                from: toSourcePosition(snapshot, selection.from),
                to: toSourcePosition(snapshot, selection.to),
              })
            }
            if (!rawChanged) return

            onUndoRedoChangeRef.current?.({
              undo: undoDepth(update.state) > 0,
              redo: redoDepth(update.state) > 0,
            })
            if (isApplyingExternalValueRef.current) return

            onChangeRef.current(snapshot.value)
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
      undo: !view.state.facet(EditorState.readOnly) && undoDepth(view.state) > 0,
      redo: !view.state.facet(EditorState.readOnly) && redoDepth(view.state) > 0,
    })
    const dispatchSourceValue = (nextValue: string, nextSelection?: { from: number; to: number }) => {
      const before = view.state.field(sourceSnapshotField)
      const after = createSourceSnapshot(nextValue)
      const changes = buildTextEdits(before.normalized, after.normalized)
      view.dispatch({
        changes: changes.map(edit => ({ from: edit.from, to: edit.to, insert: edit.text })),
        effects: setSourceLineEndings.of(after.endings),
        ...(nextSelection ? { selection: {
          anchor: toEditorPosition(after, nextSelection.from),
          head: toEditorPosition(after, nextSelection.to),
        } } : {}),
        annotations: isolateHistory.of('full'),
      })
      if (view.state.field(sourceSnapshotField).value !== nextValue) {
        throw new PluginError('EditorBusy', 'The source editor did not accept the edit')
      }
    }
    onControllerChangeRef.current?.({
      setEditable: (nextEditable) => {
        view.dispatch({ effects: editableCompartmentRef.current.reconfigure([
          EditorState.readOnly.of(!nextEditable), EditorView.editable.of(nextEditable),
        ]) })
      },
      isFocused: () => view.hasFocus,
      undo: () => {
        if (view.state.facet(EditorState.readOnly)) return false
        const didUndo = undo(view)
        if (didUndo) view.focus()
        return didUndo
      },
      redo: () => {
        if (view.state.facet(EditorState.readOnly)) return false
        const didRedo = redo(view)
        if (didRedo) view.focus()
        return didRedo
      },
      getUndoRedoState,
      openSearch: () => openSearchPanel(view),
      find: (query) => {
        const normalizedText = createSourceSnapshot(query.trim()).normalized
        const normalizedQuery = normalizedText.toLocaleLowerCase()
        if (!normalizedQuery) return false

        const index = view.state.doc.toString().toLocaleLowerCase().indexOf(normalizedQuery)
        if (index < 0) return false

        view.dispatch({
          selection: { anchor: index, head: index + normalizedText.length },
          scrollIntoView: true,
        })
        view.focus()
        return true
      },
      replaceValue: (nextValue, nextSelection) => {
        if (view.state.facet(EditorState.readOnly)) throw new PluginError('EditorBusy', 'The source editor is read-only')
        const before = view.state.field(sourceSnapshotField)
        const selectionFrom = Math.max(
          0,
          Math.min(nextSelection?.from ?? toSourcePosition(before, view.state.selection.main.from), nextValue.length)
        )
        const selectionTo = Math.max(
          selectionFrom,
          Math.min(nextSelection?.to ?? selectionFrom, nextValue.length)
        )
        dispatchSourceValue(nextValue, { from: selectionFrom, to: selectionTo })
      },
      isComposing: () => view.composing,
      applyEdits: edits => {
        if (view.composing || view.state.facet(EditorState.readOnly)) throw new PluginError('EditorBusy', 'The source editor is composing or read-only')
        const before = view.state.field(sourceSnapshotField).value
        const parts: string[] = []
        let offset = 0
        for (const edit of [...edits].sort((left, right) => left.from - right.from || left.to - right.to)) {
          if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to)
            || edit.from < offset || edit.to < edit.from || edit.to > before.length) {
            throw new RangeError('Invalid or overlapping source edit range')
          }
          parts.push(before.slice(offset, edit.from), edit.text)
          offset = edit.to
        }
        parts.push(before.slice(offset))
        dispatchSourceValue(parts.join(''))
      },
      setSelection: (from, to) => {
        const snapshot = view.state.field(sourceSnapshotField)
        view.dispatch({ selection: {
          anchor: toEditorPosition(snapshot, from), head: toEditorPosition(snapshot, to),
        }, scrollIntoView: true })
        view.focus()
      },
    })
    onUndoRedoChangeRef.current?.(getUndoRedoState())
    const initialSelection = view.state.selection.main
    onSelectionChangeRef.current?.({
      from: toSourcePosition(initialSnapshot, initialSelection.from),
      to: toSourcePosition(initialSnapshot, initialSelection.to),
    })
    return () => {
      view.contentDOM.removeEventListener('focus', handleFocus)
      view.contentDOM.removeEventListener('blur', handleBlur)
      if (restoreScrollFrame) window.cancelAnimationFrame(restoreScrollFrame)
      const finalSelection = view.state.selection.main
      const finalSnapshot = view.state.field(sourceSnapshotField)
      onViewStateChangeRef.current?.({
        selection: {
          from: toSourcePosition(finalSnapshot, finalSelection.from),
          to: toSourcePosition(finalSnapshot, finalSelection.to),
        },
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
        languageCompartmentRef.current.reconfigure(language === 'css' ? css() : markdown()),
        placeholderCompartmentRef.current.reconfigure(placeholder ? editorPlaceholder(placeholder) : []),
      ],
    })
  }, [language, placeholder])

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
    const currentSnapshot = view.state.field(sourceSnapshotField)
    const nextSnapshot = valueChanged ? createSourceSnapshot(value) : currentSnapshot
    const currentSelection = view.state.selection.main
    const requestedSelection = selection ?? {
      from: toSourcePosition(currentSnapshot, currentSelection.from),
      to: toSourcePosition(currentSnapshot, currentSelection.to),
    }
    const nextSelectionFrom = toEditorPosition(nextSnapshot, requestedSelection.from)
    const nextSelectionTo = Math.max(
      nextSelectionFrom,
      toEditorPosition(nextSnapshot, requestedSelection.to)
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
        changes: { from: 0, to: currentLength, insert: nextSnapshot.normalized },
        effects: setSourceLineEndings.of(nextSnapshot.endings),
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
    const snapshot = view.state.field(sourceSnapshotField)
    view.dispatch({ effects: setRemoteCursors.of(remoteCursors.map(cursor => ({
      ...cursor,
      anchor: toEditorPosition(snapshot, cursor.anchor),
      head: toEditorPosition(snapshot, cursor.head),
    }))) })
  }, [remoteCursors])

  return (
    <div
      ref={containerRef}
      className={cn('h-full min-h-0 w-full overflow-hidden', className)}
    />
  )
}
