export type EditorShortcutGroup =
  | 'basic'
  | 'format'
  | 'ai'
  | 'table'
  | 'insert'

export interface EditorShortcutDefinition {
  id: string
  group: EditorShortcutGroup
  defaultShortcut: string
  alternateDefaultShortcuts?: string[]
  suggestedShortcut?: string
  selectionRequired?: boolean
}

export const editorShortcutDefinitions = [
  { id: 'undo', group: 'basic', defaultShortcut: 'Mod+Z' },
  { id: 'redo', group: 'basic', defaultShortcut: 'Shift+Mod+Z', alternateDefaultShortcuts: ['Mod+Y'] },
  { id: 'setParagraph', group: 'basic', defaultShortcut: 'Mod+Alt+0' },
  { id: 'toggleHeading1', group: 'basic', defaultShortcut: 'Mod+Alt+1' },
  { id: 'toggleHeading2', group: 'basic', defaultShortcut: 'Mod+Alt+2' },
  { id: 'toggleHeading3', group: 'basic', defaultShortcut: 'Mod+Alt+3' },
  { id: 'toggleHeading4', group: 'basic', defaultShortcut: 'Mod+Alt+4' },
  { id: 'toggleHeading5', group: 'basic', defaultShortcut: 'Mod+Alt+5' },
  { id: 'toggleHeading6', group: 'basic', defaultShortcut: 'Mod+Alt+6' },
  { id: 'openSearch', group: 'basic', defaultShortcut: 'Mod+F' },
  { id: 'openSlashCommand', group: 'basic', defaultShortcut: 'Mod+/' },
  { id: 'toggleOutline', group: 'basic', defaultShortcut: 'Shift+Mod+O' },

  { id: 'toggleBold', group: 'format', defaultShortcut: 'Mod+B' },
  { id: 'toggleItalic', group: 'format', defaultShortcut: 'Mod+I' },
  { id: 'toggleStrike', group: 'format', defaultShortcut: 'Shift+Mod+S' },
  { id: 'toggleUnderline', group: 'format', defaultShortcut: 'Mod+U' },
  { id: 'toggleInlineCode', group: 'format', defaultShortcut: 'Mod+E' },
  { id: 'toggleHighlight', group: 'format', defaultShortcut: 'Shift+Mod+H' },
  { id: 'openLinkInput', group: 'format', defaultShortcut: 'Mod+K', selectionRequired: true },
  { id: 'toggleBlockquote', group: 'format', defaultShortcut: 'Shift+Mod+B' },
  { id: 'toggleBulletList', group: 'format', defaultShortcut: 'Shift+Mod+8' },
  { id: 'toggleOrderedList', group: 'format', defaultShortcut: 'Shift+Mod+7' },
  { id: 'toggleTaskList', group: 'format', defaultShortcut: 'Shift+Mod+9' },
  { id: 'toggleCodeBlock', group: 'format', defaultShortcut: 'Mod+Alt+C' },

  { id: 'openAiMenu', group: 'ai', defaultShortcut: 'Mod+J', selectionRequired: true },
  { id: 'aiContinue', group: 'ai', defaultShortcut: 'Shift+Mod+J' },
  { id: 'aiPolish', group: 'ai', defaultShortcut: '', suggestedShortcut: 'Mod+Alt+P', selectionRequired: true },
  { id: 'aiConcise', group: 'ai', defaultShortcut: '', suggestedShortcut: 'Mod+Alt+N', selectionRequired: true },
  { id: 'aiExpand', group: 'ai', defaultShortcut: '', suggestedShortcut: 'Mod+Alt+X', selectionRequired: true },
  { id: 'aiTranslate', group: 'ai', defaultShortcut: '', suggestedShortcut: 'Shift+Mod+Alt+T', selectionRequired: true },
  { id: 'acceptAiSuggestion', group: 'ai', defaultShortcut: 'Mod+Enter' },
  { id: 'rejectAiSuggestion', group: 'ai', defaultShortcut: 'Escape' },
  { id: 'abortAiGeneration', group: 'ai', defaultShortcut: 'Mod+.' },

  { id: 'insertTable', group: 'table', defaultShortcut: 'Mod+Alt+T' },
  { id: 'addColumnBefore', group: 'table', defaultShortcut: '', suggestedShortcut: 'Shift+Mod+Alt+L' },
  { id: 'addColumnAfter', group: 'table', defaultShortcut: '', suggestedShortcut: 'Shift+Mod+Alt+R' },
  { id: 'addRowBefore', group: 'table', defaultShortcut: '', suggestedShortcut: 'Shift+Mod+Alt+U' },
  { id: 'addRowAfter', group: 'table', defaultShortcut: '', suggestedShortcut: 'Shift+Mod+Alt+D' },
  { id: 'deleteColumn', group: 'table', defaultShortcut: '', suggestedShortcut: 'Mod+Alt+Backspace' },
  { id: 'deleteRow', group: 'table', defaultShortcut: '', suggestedShortcut: 'Shift+Mod+Alt+Backspace' },
  { id: 'deleteTable', group: 'table', defaultShortcut: '', suggestedShortcut: 'Mod+Alt+Delete' },
  { id: 'alignLeft', group: 'table', defaultShortcut: 'Shift+Mod+L' },
  { id: 'alignCenter', group: 'table', defaultShortcut: 'Shift+Mod+E' },
  { id: 'alignRight', group: 'table', defaultShortcut: 'Shift+Mod+R' },

  { id: 'insertImage', group: 'insert', defaultShortcut: 'Shift+Mod+I' },
  { id: 'insertInlineMath', group: 'insert', defaultShortcut: 'Mod+Alt+M' },
  { id: 'insertBlockMath', group: 'insert', defaultShortcut: 'Shift+Mod+Alt+M' },
  { id: 'insertMermaid', group: 'insert', defaultShortcut: 'Mod+Alt+D' },
  { id: 'insertHorizontalRule', group: 'insert', defaultShortcut: 'Mod+Alt+-' },
] as const satisfies readonly EditorShortcutDefinition[]

export type EditorShortcutCommandId = typeof editorShortcutDefinitions[number]['id']

export interface EditorShortcut {
  id: EditorShortcutCommandId
  value: string
}

export const defaultEditorShortcuts: EditorShortcut[] = editorShortcutDefinitions.map((definition) => ({
  id: definition.id,
  value: definition.defaultShortcut,
}))

export function getEditorShortcutDefinition(id: EditorShortcutCommandId) {
  return editorShortcutDefinitions.find((definition) => definition.id === id)
}

export function getEditorShortcutDefaultsToBlock(id: EditorShortcutCommandId) {
  const definition = getEditorShortcutDefinition(id)
  if (!definition) {
    return []
  }

  return [
    definition.defaultShortcut,
    ...('alternateDefaultShortcuts' in definition ? definition.alternateDefaultShortcuts : []),
  ].filter(Boolean)
}
