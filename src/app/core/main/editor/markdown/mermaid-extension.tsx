'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import mermaid from 'mermaid'
import { Code, Check } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'inherit',
})

// Diagram type configuration with icons
const DIAGRAM_TYPES = [
  { type: 'flowchart', labelKey: 'flowchart', icon: 'GitBranch', alias: ['flowchart', 'flowchart-v2', 'graph', 'td', 'graph TD', 'graph BT', 'graph LR', 'graph RL'] },
  { type: 'sequence', labelKey: 'sequence', icon: 'GitCommit', alias: ['sequence', 'sequenceDiagram'] },
  { type: 'classDiagram', labelKey: 'classDiagram', icon: 'Layers', alias: ['class', 'classDiagram'] },
  { type: 'stateDiagram', labelKey: 'stateDiagram', icon: 'Activity', alias: ['state', 'stateDiagram', 'stateDiagram-v2'] },
  { type: 'er', labelKey: 'erDiagram', icon: 'Database', alias: ['er', 'erDiagram'] },
  { type: 'gantt', labelKey: 'gantt', icon: 'Calendar', alias: ['gantt'] },
  { type: 'pie', labelKey: 'pie', icon: 'PieChart', alias: ['pie'] },
  { type: 'journey', labelKey: 'journey', icon: 'Map', alias: ['journey', 'gitGraph'] },
]

// Detect diagram type from code
function detectDiagramType(code: string): string {
  const trimmed = code.trim()
  for (const config of DIAGRAM_TYPES) {
    // Check first line for type specification
    const firstLine = trimmed.split('\n')[0]?.toLowerCase() || ''
    if (config.alias?.some((alias: string) => firstLine.startsWith(alias) || firstLine === alias)) {
      return config.type
    }
  }
  return 'flowchart'
}

// Mermaid Diagram View Component
function MermaidDiagramView({ node, updateAttributes }: ReactNodeViewProps) {
  const t = useTranslations('editor.mermaid')

  const [isEditing, setIsEditing] = useState(false)
  const [code, setCode] = useState(node.attrs.code || '')
  const [diagramType, setDiagramType] = useState(node.attrs.type || 'flowchart')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const renderDiagram = useCallback(async () => {
    if (!code.trim()) {
      setSvg('')
      setError(null)
      return
    }

    setError(null)

    try {
      mermaid.parse(code)
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const { svg: renderedSvg } = await mermaid.render(id, code)
      setSvg(renderedSvg)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('renderError')
      setError(message)
      setSvg('')
    }
  }, [code, t])

  useEffect(() => {
    renderDiagram()
  }, [])

  useEffect(() => {
    const detected = detectDiagramType(code)
    if (detected !== diagramType) {
      setDiagramType(detected)
    }
  }, [code, diagramType])

  // 退出编辑模式后刷新预览
  useEffect(() => {
    if (!isEditing) {
      renderDiagram()
    }
  }, [isEditing])

  const handleUpdate = () => {
    updateAttributes({ code, type: diagramType })
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
      {/* Preview Mode */}
      {!isEditing && (
        <div
          className="mermaid-preview rounded-lg border border-border bg-card overflow-x-auto cursor-pointer"
          onClick={() => setIsEditing(true)}
        >
          {error ? (
            <div className="p-4 text-red-500 text-sm">
              <p className="font-medium">{t('renderError')}</p>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-muted-foreground">{t('clickToEdit')}</p>
            </div>
          ) : svg ? (
            <div
              ref={containerRef}
              className="mermaid-svg p-4 flex justify-center"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <span>{t('clickToAdd')}</span>
            </div>
          )}

          <div className="mermaid-overlay opacity-0 hover:opacity-100 transition-opacity absolute top-2 right-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                setIsEditing(true)
              }}
            >
              <Code className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Edit Mode */}
      {isEditing && (
        <div className="mermaid-editor rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 p-2 border-b bg-muted/50">
            <Select value={diagramType} onValueChange={setDiagramType}>
              <SelectTrigger className="w-35 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIAGRAM_TYPES.map((item) => (
                  <SelectItem key={item.type} value={item.type}>
                    {getLabel(item.type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex-1" />

            <Button
              variant="ghost"
              size="icon"
              onClick={handleUpdate}
              title={t('done')}
            >
              <Check className="size-4" />
            </Button>
          </div>

          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-48 p-3 font-mono text-sm bg-background resize-y focus:outline-none"
            placeholder={t('placeholder')}
            spellCheck={false}
          />

          {error && (
            <div className="px-3 py-2 text-xs text-red-500 bg-red-50 border-t">
              {error}
            </div>
          )}
        </div>
      )}
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
    return ReactNodeViewRenderer(MermaidDiagramView)
  },

  markdownTokenName: 'mermaid',

  markdownTokenizer: {
    name: 'mermaid',
    level: 'block',
    start: (src: string) => {
      const match = src.match(/^```mermaid\r?\n/)
      return match ? (match.index ?? -1) : -1
    },
    tokenize: (src, tokens, lexer) => {
      const match = /^```mermaid\r?\n([\s\S]*?)\r?\n```/.exec(src)
      if (!match) return undefined

      const code = match[1]
      const type = detectDiagramType(code)

      return {
        type: 'mermaid',
        raw: match[0],
        content: code,
        attrs: { type },
        tokens: lexer.blockTokens(match[1]),
      }
    },
  },

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
