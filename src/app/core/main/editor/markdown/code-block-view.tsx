'use client'

import type { Editor, NodeViewRendererProps } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { toast } from '@/hooks/use-toast'
import { ResponsiveSelect } from '@/components/responsive-select'
import useArticleStore from '@/stores/article'
import { CodeBlockPluginDiscovery, PluginCodeBlockPreview, useCodeBlockRenderer } from '@/components/plugins/plugin-code-block-preview'

const COPY_FEEDBACK_TIMEOUT_MS = 1200
const AUTO_LANGUAGE_VALUE = '__auto__'

interface CodeBlockLanguageOption {
  value: string
  label: string
  shortLabel: string
}

const CODE_BLOCK_LANGUAGE_OPTIONS: CodeBlockLanguageOption[] = [
  { value: AUTO_LANGUAGE_VALUE, label: 'Auto Detect', shortLabel: 'AUTO' },
  { value: 'plaintext', label: 'Plain Text', shortLabel: 'TXT' },
  { value: 'bash', label: 'Bash', shortLabel: 'BASH' },
  { value: 'shell', label: 'Shell', shortLabel: 'SH' },
  { value: 'c', label: 'C', shortLabel: 'C' },
  { value: 'cpp', label: 'C++', shortLabel: 'C++' },
  { value: 'csharp', label: 'C#', shortLabel: 'C#' },
  { value: 'css', label: 'CSS', shortLabel: 'CSS' },
  { value: 'diff', label: 'Diff', shortLabel: 'DIFF' },
  { value: 'go', label: 'Go', shortLabel: 'GO' },
  { value: 'graphql', label: 'GraphQL', shortLabel: 'GQL' },
  { value: 'html', label: 'HTML', shortLabel: 'HTML' },
  { value: 'ini', label: 'INI', shortLabel: 'INI' },
  { value: 'java', label: 'Java', shortLabel: 'JAVA' },
  { value: 'javascript', label: 'JavaScript', shortLabel: 'JS' },
  { value: 'json', label: 'JSON', shortLabel: 'JSON' },
  { value: 'kotlin', label: 'Kotlin', shortLabel: 'KT' },
  { value: 'less', label: 'Less', shortLabel: 'LESS' },
  { value: 'lua', label: 'Lua', shortLabel: 'LUA' },
  { value: 'makefile', label: 'Makefile', shortLabel: 'MAKE' },
  { value: 'markdown', label: 'Markdown', shortLabel: 'MD' },
  { value: 'objectivec', label: 'Objective-C', shortLabel: 'OBJC' },
  { value: 'perl', label: 'Perl', shortLabel: 'PERL' },
  { value: 'php', label: 'PHP', shortLabel: 'PHP' },
  { value: 'python', label: 'Python', shortLabel: 'PY' },
  { value: 'r', label: 'R', shortLabel: 'R' },
  { value: 'ruby', label: 'Ruby', shortLabel: 'RB' },
  { value: 'rust', label: 'Rust', shortLabel: 'RS' },
  { value: 'scss', label: 'SCSS', shortLabel: 'SCSS' },
  { value: 'sql', label: 'SQL', shortLabel: 'SQL' },
  { value: 'swift', label: 'Swift', shortLabel: 'SWIFT' },
  { value: 'typescript', label: 'TypeScript', shortLabel: 'TS' },
  { value: 'yaml', label: 'YAML', shortLabel: 'YAML' },
]

const CODE_BLOCK_LANGUAGE_BY_VALUE = new Map(
  CODE_BLOCK_LANGUAGE_OPTIONS.map((option) => [option.value, option])
)

function normalizeLanguage(language: unknown) {
  if (typeof language !== 'string') {
    return null
  }

  const trimmedLanguage = language.trim()
  return trimmedLanguage || null
}

function createCustomLanguageOption(language: string): CodeBlockLanguageOption {
  return {
    value: language,
    label: language,
    shortLabel: language.toUpperCase(),
  }
}

function getLanguageOption(language: string | null) {
  if (!language) {
    return CODE_BLOCK_LANGUAGE_BY_VALUE.get(AUTO_LANGUAGE_VALUE) ?? CODE_BLOCK_LANGUAGE_OPTIONS[0]
  }

  return CODE_BLOCK_LANGUAGE_BY_VALUE.get(language) ?? createCustomLanguageOption(language)
}

function isSelectAllShortcut(event: KeyboardEvent<HTMLElement>) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'a'
  )
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.inset = '0 auto auto 0'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command failed')
    }
  } finally {
    document.body.removeChild(textArea)
  }
}

export interface CodeBlockViewProps {
  editor: Editor
  node: ProseMirrorNode
  getPos: NodeViewRendererProps['getPos']
  updateAttributes(attributes: Record<string, unknown>): void
  element: HTMLDivElement
  initialShowSource: boolean
  shouldRevealSource(): boolean
  onSourceVisibilityChange(visible: boolean): void
}

export function CodeBlockView({ editor, node, updateAttributes, getPos, element, initialShowSource, shouldRevealSource, onSourceVisibilityChange }: CodeBlockViewProps) {
  const focusFrameRef = useRef<number | null>(null)
  const focusEpochRef = useRef(0)
  const lifetimeRef = useRef({ active: true })
  useEffect(() => {
    const lifetime = { active: true }
    lifetimeRef.current = lifetime
    const unsubscribe = useArticleStore.subscribe((state, previous) => {
      if (state.activeFilePath === previous.activeFilePath && state.activeTabId === previous.activeTabId) return
      focusEpochRef.current += 1
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
    })
    return () => {
      lifetime.active = false
      unsubscribe()
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
    }
  }, [editor])
  const [copied, setCopied] = useState(false)
  const language = normalizeLanguage(node.attrs.language)
  const selectedLanguageValue = language ?? AUTO_LANGUAGE_VALUE
  const selectedLanguageOption = getLanguageOption(language)
  const languageOptions = CODE_BLOCK_LANGUAGE_BY_VALUE.has(selectedLanguageValue)
    ? CODE_BLOCK_LANGUAGE_OPTIONS
    : [selectedLanguageOption, ...CODE_BLOCK_LANGUAGE_OPTIONS]
  const codeText = node.textContent
  const { providers, provider, select } = useCodeBlockRenderer(language ?? '')
  const [showSource, setShowSource] = useState(() => initialShowSource || shouldRevealSource())
  const sourceVisible = !providers.length || !provider || showSource
  useLayoutEffect(() => {
    onSourceVisibilityChange(sourceVisible)
  }, [onSourceVisibilityChange, sourceVisible])
  const handleShowSource = useCallback((value: boolean, focus = false) => {
    if (editor.isDestroyed) return
    if (!value) editor.commands.blur()
    setShowSource(value)
    if (value && focus && editor.isEditable) {
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = window.requestAnimationFrame(() => {
        focusFrameRef.current = null
        if (editor.isDestroyed) return
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (typeof pos !== 'number') return
        const { from, to } = editor.state.selection
        const selection = from > pos && to < pos + node.nodeSize ? { from, to } : pos + 1
        editor.chain().setTextSelection(selection).focus().run()
      })
    }
  }, [editor, getPos, node.nodeSize])

  useLayoutEffect(() => {
    if (!provider) return
    // Restoring focus must preserve the default preview. Reveal source only when
    // the selection moves into the block or the user starts editing its text.
    const revealSelection = () => {
      if (!provider || editor.isDestroyed) return
      const pos = typeof getPos === 'function' ? getPos() : undefined
      const { from, to } = editor.state.selection
      if (editor.isFocused && typeof pos === 'number' && from < pos + node.nodeSize && to > pos) setShowSource(true)
    }
    const dom = element
    editor.on('selectionUpdate', revealSelection)
    dom.addEventListener('beforeinput', revealSelection, true)
    dom.addEventListener('paste', revealSelection, true)
    dom.addEventListener('drop', revealSelection, true)
    // React controls or the renderer provider can arrive after the selection
    // event. Only catch up an actual selection change made after creation.
    if (shouldRevealSource()) revealSelection()
    return () => {
      editor.off('selectionUpdate', revealSelection)
      dom.removeEventListener('beforeinput', revealSelection, true)
      dom.removeEventListener('paste', revealSelection, true)
      dom.removeEventListener('drop', revealSelection, true)
    }
  }, [editor, element, getPos, node.nodeSize, provider, shouldRevealSource])

  useEffect(() => {
    if (!copied) {
      return
    }

    const timeout = window.setTimeout(() => {
      setCopied(false)
    }, COPY_FEEDBACK_TIMEOUT_MS)

    return () => window.clearTimeout(timeout)
  }, [copied])

  const restoreEditorFocus = useCallback((isCurrent = () => lifetimeRef.current.active) => {
    if (!isCurrent()) return
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (!isCurrent() || editor.isDestroyed) return
      editor.commands.focus()
    })
  }, [editor])

  const selectCodeBlockContent = useCallback(() => {
    if (editor.isDestroyed) return
    const pos = typeof getPos === 'function' ? getPos() : null

    if (typeof pos !== 'number') {
      editor.commands.focus()
      return
    }

    const { doc, tr } = editor.state
    const from = pos + 1
    const to = pos + node.nodeSize - 1

    editor.view.dispatch(
      tr
        .setSelection(TextSelection.create(doc, from, to))
        .scrollIntoView()
    )
    editor.view.focus()
  }, [editor, getPos, node.nodeSize])

  const handleToolbarKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!isSelectAllShortcut(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    selectCodeBlockContent()
  }, [selectCodeBlockContent])

  const handleLanguageChange = useCallback((value: string) => {
    updateAttributes({
      language: value === AUTO_LANGUAGE_VALUE ? null : value,
    })
    restoreEditorFocus()
  }, [restoreEditorFocus, updateAttributes])

  const handleCopy = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const lifetime = lifetimeRef.current
    const focusEpoch = focusEpochRef.current
    const documentSnapshot = editor.state.doc
    const path = useArticleStore.getState().activeFilePath
    const isCurrent = () => lifetime.active && focusEpoch === focusEpochRef.current && !editor.isDestroyed
      && editor.state.doc === documentSnapshot && useArticleStore.getState().activeFilePath === path
      && Boolean(element.isConnected && element.getClientRects().length)

    try {
      await writeClipboardText(codeText)
      if (!isCurrent()) return
      setCopied(true)
      toast({
        title: '复制成功',
        description: '已复制代码块内容',
      })
    } catch {
      if (!isCurrent()) return
      toast({
        title: '复制失败',
        description: '无法复制代码块内容',
        variant: 'destructive',
      })
    } finally {
      restoreEditorFocus(isCurrent)
    }
  }, [codeText, editor, element, restoreEditorFocus])

  return (
    <>
      {sourceVisible ? (
        <div
          className="code-block-toolbar"
          contentEditable={false}
          onKeyDown={handleToolbarKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ResponsiveSelect
            title="选择代码块语言"
            value={selectedLanguageValue}
            onValueChange={handleLanguageChange}
            className="code-block-language-trigger"
            triggerContent={<span className="code-block-language-trigger-label" title={selectedLanguageOption.label}>{selectedLanguageOption.shortLabel}</span>}
            options={languageOptions.map(option => ({
              value: option.value,
              label: (
                <span className="code-block-language-option">
                  <span className="code-block-language-option-code">{option.shortLabel}</span>
                  <span>{option.label}</span>
                </span>
              ),
            }))}
          />
          {!providers.length ? <CodeBlockPluginDiscovery language={language ?? ''} active compact /> : null}
          <button
            type="button"
            className="code-block-copy-button"
            title={copied ? '已复制' : '复制代码块'}
            aria-label={copied ? '已复制代码块' : '复制代码块'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleCopy}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      ) : null}
      {providers.length ? <PluginCodeBlockPreview
        source={codeText} language={language ?? ''} providers={providers} provider={provider} select={select}
        active showSource={sourceVisible} onShowSource={handleShowSource}
      /> : null}
    </>
  )
}
