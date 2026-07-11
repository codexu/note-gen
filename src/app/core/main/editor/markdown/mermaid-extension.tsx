'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import mermaid from 'mermaid'
import { Code, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MermaidLightbox } from './mermaid-lightbox'

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
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [code, setCode] = useState(node.attrs.code || '')
  const [diagramType, setDiagramType] = useState(node.attrs.type || 'flowchart')
  const [pngUrl, setPngUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const codeRef = useRef(code)
  codeRef.current = code

  const svgToPng = useCallback((svgStr: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      // 解析 SVG，补全缺失的 width/height（mermaid 有时只有 viewBox）
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgStr, 'image/svg+xml')
      const svgEl = doc.documentElement
      let w = parseFloat(svgEl.getAttribute('width') || '0')
      let h = parseFloat(svgEl.getAttribute('height') || '0')
      if (!w || !h) {
        const vb = svgEl.getAttribute('viewBox')?.split(/[\s,]+/)
        w = parseFloat(vb?.[2] || '800')
        h = parseFloat(vb?.[3] || '600')
        svgEl.setAttribute('width', String(w))
        svgEl.setAttribute('height', String(h))
      }
      const fixedSvg = new XMLSerializer().serializeToString(doc)
      const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(fixedSvg)))}`
      const img = new Image()
      img.onload = () => {
        const scale = 2
        const pw = (img.naturalWidth || w) * scale
        const ph = (img.naturalHeight || h) * scale
        const canvas = document.createElement('canvas')
        canvas.width = pw
        canvas.height = ph
        const ctx = canvas.getContext('2d')!
        ctx.scale(scale, scale)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, pw / scale, ph / scale)
        ctx.drawImage(img, 0, 0, pw / scale, ph / scale)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('svg load failed'))
      img.src = url
    })
  }, [])

  const renderDiagram = useCallback(async (src: string) => {
    if (!src.trim()) {
      setPngUrl('')
      setError(null)
      return
    }
    setError(null)
    try {
      await mermaid.parse(src)
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const { svg: renderedSvg } = await mermaid.render(id, src)
      const png = await svgToPng(renderedSvg)
      setPngUrl(png)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('renderError')
      setError(message)
      setPngUrl('')
    }
  }, [t, svgToPng])

  // 初始渲染
  useEffect(() => {
    if (node.attrs.code) renderDiagram(node.attrs.code)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动识别图表类型
  useEffect(() => {
    const detected = detectDiagramType(code)
    if (detected !== diagramType) setDiagramType(detected)
  }, [code, diagramType])

  // 编辑模式下实时预览（防抖 600ms）
  useEffect(() => {
    if (!isEditing) return
    const src = codeRef.current
    const timer = setTimeout(() => renderDiagram(src), 600)
    return () => clearTimeout(timer)
  }, [code, isEditing, renderDiagram])

  // 退出编辑后渲染
  useEffect(() => {
    if (!isEditing) renderDiagram(codeRef.current)
  }, [isEditing, renderDiagram])

  const handleUpdate = () => {
    const current = codeRef.current
    updateAttributes({ code: current, type: diagramType })
    setIsEditing(false)
    renderDiagram(current)
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
      {lightboxOpen && pngUrl && (
        <MermaidLightbox pngUrl={pngUrl} onClose={() => setLightboxOpen(false)} />
      )}

      {/* Preview Mode */}
      {!isEditing && (
        <div
          className={`mermaid-preview relative rounded-lg border border-border bg-white overflow-x-auto ${pngUrl ? 'cursor-zoom-in' : 'cursor-text'}`}
          onClick={() => pngUrl ? setLightboxOpen(true) : setIsEditing(true)}
        >
          {error ? (
            <div className="p-4 text-red-500 text-sm">
              <p className="font-medium">{t('renderError')}</p>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-muted-foreground">{t('clickToEdit')}</p>
            </div>
          ) : pngUrl ? (
            <div
              ref={containerRef}
              className="p-4 flex justify-center"
            >
              <img src={pngUrl} alt="mermaid diagram" className="max-w-full h-auto" />
            </div>
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
              title={t('clickToEdit')}
            >
              <Code className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Edit Mode */}
      {isEditing && (
        <div className="mermaid-editor rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50">
            <span className="text-xs text-muted-foreground font-mono">mermaid</span>
            <Button variant="ghost" size="icon" onClick={handleUpdate} title={t('done')}>
              <Check className="size-4" />
            </Button>
          </div>

          <textarea
            autoFocus
            value={code}
            onChange={(e) => {
              let val = e.target.value
              const fenceMatch = val.match(/^```mermaid\r?\n([\s\S]*?)\r?\n```\s*$/)
              if (fenceMatch) val = fenceMatch[1]
              setCode(val)
            }}
            onKeyDown={handleKeyDown}
            className="w-full h-48 p-3 font-mono text-sm bg-background resize-y focus:outline-none"
            placeholder="粘贴 mermaid 代码，自动识别类型并渲染"
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
