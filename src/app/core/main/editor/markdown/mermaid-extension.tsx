'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Code, Check } from 'lucide-react'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useViewportActivation } from './viewport-activation'
import { updateNodeViewOnMarkupChange } from './node-view-update'
import { detectMermaidDiagramType, mermaidTokenizer } from './markdown-tokenizers'

type MermaidApi = (typeof import('mermaid'))['default']

let mermaidPromise: Promise<MermaidApi> | null = null
let mermaidRenderId = 0
let mermaidRenderQueue = Promise.resolve()

async function getMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        fontFamily: 'inherit',
      })
      return mermaid
    })
  }

  return await mermaidPromise
}

async function renderMermaid(
  code: string,
  shouldRender: () => boolean
): Promise<string | null> {
  const render = async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    if (!shouldRender()) return null

    const mermaid = await getMermaid()
    if (!shouldRender()) return null

    const id = `mermaid-${++mermaidRenderId}`
    return (await mermaid.render(id, code)).svg
  }
  const result = mermaidRenderQueue.then(render, render)

  mermaidRenderQueue = result.then(() => undefined, () => undefined)
  return await result
}

// Diagram type configuration with icons
const DIAGRAM_TYPES = [
  { type: 'flowchart', labelKey: 'flowchart', icon: 'GitBranch' },
  { type: 'sequence', labelKey: 'sequence', icon: 'GitCommit' },
  { type: 'classDiagram', labelKey: 'classDiagram', icon: 'Layers' },
  { type: 'stateDiagram', labelKey: 'stateDiagram', icon: 'Activity' },
  { type: 'er', labelKey: 'erDiagram', icon: 'Database' },
  { type: 'gantt', labelKey: 'gantt', icon: 'Calendar' },
  { type: 'pie', labelKey: 'pie', icon: 'PieChart' },
  { type: 'journey', labelKey: 'journey', icon: 'Map' },
]

// Detect diagram type from code
const detectDiagramType = detectMermaidDiagramType

// Mermaid Diagram View Component
function MermaidDiagramView({ node, updateAttributes }: ReactNodeViewProps) {
  const t = useTranslations('editor.mermaid')

  const [isEditing, setIsEditing] = useState(false)
  const [code, setCode] = useState(node.attrs.code || '')
  const [diagramType, setDiagramType] = useState(node.attrs.type || 'flowchart')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const renderVersionRef = useRef(0)
  const { elementRef, isActive, activate } = useViewportActivation<HTMLDivElement>()

  const renderDiagram = useCallback(async () => {
    const renderVersion = ++renderVersionRef.current
    if (!code.trim()) {
      setSvg('')
      setError(null)
      setIsRendering(false)
      return
    }

    setError(null)
    setIsRendering(true)

    try {
      const renderedSvg = await renderMermaid(
        code,
        () => renderVersionRef.current === renderVersion
      )
      if (renderedSvg === null || renderVersionRef.current !== renderVersion) return
      setSvg(renderedSvg)
    } catch (err) {
      if (renderVersionRef.current !== renderVersion) return
      const message = err instanceof Error ? err.message : t('renderError')
      setError(message)
      setSvg('')
    } finally {
      if (renderVersionRef.current === renderVersion) {
        setIsRendering(false)
      }
    }
  }, [code, t])

  useEffect(() => {
    if (!isActive || isEditing) return

    void renderDiagram()
    return () => {
      renderVersionRef.current++
    }
  }, [isActive, isEditing, renderDiagram])

  useEffect(() => {
    if (isEditing) return

    setCode(node.attrs.code || '')
    setDiagramType(node.attrs.type || 'flowchart')
  }, [isEditing, node.attrs.code, node.attrs.type])

  useEffect(() => {
    const detected = detectDiagramType(code)
    if (detected !== diagramType) {
      setDiagramType(detected)
    }
  }, [code, diagramType])

  const handleUpdate = () => {
    updateAttributes({ code, type: diagramType })
    activate()
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleUpdate()
    }
    if (e.key === 'Escape') {
      setCode(node.attrs.code || '')
      setIsEditing(false)
    }
  }

  const getLabel = (key: string) => {
    return t(`diagramTypes.${key}`)
  }

  return (
    <NodeViewWrapper className="mermaid-diagram-wrapper my-4">
      <div ref={elementRef}>
        {!isEditing && !isActive ? (
          <div
            className="min-h-40 cursor-pointer rounded-lg border bg-card p-4"
            onClick={() => {
              activate()
              setIsEditing(true)
            }}
          >
            <Skeleton className="h-32 w-full" />
          </div>
        ) : null}

        {/* Preview Mode */}
        {!isEditing && isActive && (
          <div
            className="mermaid-preview rounded-lg border border-border bg-card overflow-x-auto cursor-pointer"
            onClick={() => setIsEditing(true)}
          >
            {error ? (
              <div className="p-4 text-sm text-destructive">
                <p className="font-medium">{t('renderError')}</p>
                <p className="mt-1">{error}</p>
                <p className="mt-2 text-muted-foreground">{t('clickToEdit')}</p>
              </div>
            ) : svg ? (
              <div
                className="mermaid-svg flex justify-center p-4"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : isRendering ? (
              <div className="p-4">
                <Skeleton className="h-32 w-full" />
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <span>{t('clickToAdd')}</span>
              </div>
            )}

            <div className="mermaid-overlay absolute right-2 top-2 opacity-0 transition-opacity hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsEditing(true)
                }}
              >
                <Code data-icon="inline-start" />
              </Button>
            </div>
          </div>
        )}

        {/* Edit Mode */}
        {isEditing && (
          <div className="mermaid-editor rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b bg-muted/50 p-2">
              <ResponsiveSelect
                title={t('title')}
                value={diagramType}
                onValueChange={setDiagramType}
                className="h-8 w-35 text-xs"
                options={DIAGRAM_TYPES.map(item => ({
                  value: item.type,
                  label: getLabel(item.type),
                }))}
              />

              <div className="flex-1" />

              <Button
                variant="ghost"
                size="icon"
                onClick={handleUpdate}
                title={t('done')}
              >
                <Check data-icon="inline-start" />
              </Button>
            </div>

            <Textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              onCopyCapture={(event) => {
                // Keep the textarea's native selection. The outer editor's copy
                // handlers serialize its own selection, which can be a different block.
                event.stopPropagation()
              }}
              rows={8}
              maxRows={20}
              className="min-h-48 rounded-none border-0 font-mono shadow-none focus-visible:ring-0"
              placeholder={t('placeholder')}
              spellCheck={false}
            />

            {error && (
              <div className="border-t bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

// Mermaid Code Block Extension
export const MermaidDiagram = Node.create({
  name: 'mermaidDiagram',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: '',
      },
      type: {
        default: 'flowchart',
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="mermaid-diagram"]' },
      { tag: 'pre[data-mermaid]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid-diagram' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidDiagramView, { update: updateNodeViewOnMarkupChange })
  },

  markdownTokenName: 'mermaid',

  markdownTokenizer: mermaidTokenizer,

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return `\n\`\`\`mermaid\n${node.attrs?.code ?? ''}\n\`\`\`\n`
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    const code = token.content || ''
    const type = detectDiagramType(code)
    return {
      type: 'mermaidDiagram',
      attrs: { code, type },
    }
  },
})

export default MermaidDiagram
