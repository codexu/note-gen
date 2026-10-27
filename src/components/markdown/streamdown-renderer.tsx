'use client'

import { createMathPlugin } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import { createContext, useContext, useMemo, type ComponentProps } from 'react'
import {
  Streamdown,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type AnimateOptions,
  type Components,
  type ControlsConfig,
  type CodeHighlighterPlugin,
  type PluginConfig,
  type StreamdownTranslations,
} from 'streamdown'
import { normalizeLatexForKatex } from '@/lib/latex'
import { cn } from '@/lib/utils'
import { normalizeTextColor } from '@/lib/text-colors'
import { codeHighlighter } from '@/lib/code-highlighter'
import type { AgentArtifactPaths } from '@/lib/agent/artifacts'
import { ArtifactLink, ArtifactLinksContext, EMPTY_ARTIFACT_LINKS, artifactLinkIndex } from './artifact-link'
import { remarkArtifacts } from './remark-artifacts'
import 'katex/dist/katex.min.css'
import 'streamdown/styles.css'
import './streamdown-renderer.css'

interface StreamdownRendererProps {
  markdown: string
  streaming?: boolean
  className?: string
  interactiveCodeBlocks?: boolean
  interactive?: boolean
  translations?: Partial<StreamdownTranslations>
  artifacts?: AgentArtifactPaths
  /** Export images stay inert until the caller resolves their sources. */
  deferImages?: boolean
  exportCodeHighlighter?: CodeHighlighterPlugin
}

const math = createMathPlugin({
  singleDollarTextMath: true,
  errorColor: 'var(--color-destructive)',
})

const plugins: PluginConfig = { cjk, code: codeHighlighter, math }
const linkSafety = { enabled: false }
const interactiveControls: ControlsConfig = {
  code: {
    copy: true,
    download: false,
  },
  mermaid: false,
  table: false,
}
const streamingAnimation: AnimateOptions = {
  animation: 'fadeIn',
  duration: 180,
  easing: 'ease-out',
  sep: 'char',
  stagger: 8,
}

const MarkdownInteractionContext = createContext(true)

function StreamdownLink({ children, node, ...props }: ComponentProps<'a'> & { node?: unknown }) {
  const interactive = useContext(MarkdownInteractionContext)
  void node
  if (!interactive) return <span>{children}</span>
  const index = artifactLinkIndex(props.href)
  if (index !== null) return <ArtifactLink index={index} href={props.href!}>{children}</ArtifactLink>
  return (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

// Keep raw CSS filtered by Streamdown. Reconstruct only a validated color.
const colorTags = { span: ['dataNotegenColor'], mark: ['dataNotegenColor'] }
const exportTags = { ...colorTags, img: ['dataNotegenExportSrc'] }
type RehypePlugins = NonNullable<ComponentProps<typeof Streamdown>['rehypePlugins']>
interface ExportSanitizeSchema {
  tagNames?: string[]
  attributes?: Record<string, unknown[]>
}

function exportSanitizer(): RehypePlugins[number] {
  const sanitizer = defaultRehypePlugins.sanitize
  if (!Array.isArray(sanitizer)) return sanitizer
  const schema = sanitizer[1] as ExportSanitizeSchema
  const attributes = { ...schema.attributes }
  for (const [tag, names] of Object.entries(exportTags)) attributes[tag] = [...(attributes[tag] ?? []), ...names]
  // Streamdown extends allowedTags only for its unchanged default plugin list.
  return [sanitizer[0], {
    ...schema,
    tagNames: [...(schema.tagNames ?? []), ...Object.keys(exportTags)],
    attributes,
  }] as RehypePlugins[number]
}
interface ExportImageTree {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: ExportImageTree[]
}

/** Preserve workspace-relative and raster data references before URL hardening. */
function deferExportImageSources() {
  return (tree: ExportImageTree) => {
    const visit = (node: ExportImageTree) => {
      if (node.type === 'element' && node.tagName === 'img' && node.properties) {
        node.properties.dataNotegenExportSrc = typeof node.properties.src === 'string' ? node.properties.src : ''
        // The component below drops this URL; it is never mounted in the DOM.
        node.properties.src = 'https://notegen-export.invalid/image'
        delete node.properties.srcSet
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

const exportRehypePlugins: RehypePlugins = [
  defaultRehypePlugins.raw,
  deferExportImageSources,
  exportSanitizer(),
  defaultRehypePlugins.harden,
]
type ColorProps = ComponentProps<'span'> & { 'data-notegen-color'?: string; node?: unknown }
function ColoredText({ children, 'data-notegen-color': value, node, style, ...props }: ColorProps) {
  void node
  const color = normalizeTextColor(value)
  return <span {...props} style={color ? { ...style, color } : style}>{children}</span>
}
function ColoredHighlight({ children, 'data-notegen-color': value, node, style, ...props }: ColorProps) {
  void node
  const color = normalizeTextColor(value)
  return <mark {...props} style={color ? { ...style, backgroundColor: color, color: '#1f2937' } : style}>{children}</mark>
}

const components: Components = {
  a: StreamdownLink as Components['a'],
  span: ColoredText as Components['span'],
  mark: ColoredHighlight as Components['mark'],
}
const previewComponents: Components = {
  ...components,
  img: (({ alt }: ComponentProps<'img'>) => <span>{alt}</span>) as Components['img'],
}
const exportComponents: Components = {
  ...components,
  img: (({ alt, title, 'data-notegen-export-src': source }: ComponentProps<'img'> & { 'data-notegen-export-src'?: string }) => (
    <img alt={alt ?? ''} title={title} data-notegen-export-src={source ?? ''} />
  )) as Components['img'],
}

export function StreamdownRenderer({
  markdown,
  streaming = false,
  className,
  interactiveCodeBlocks = true,
  interactive = true,
  translations,
  artifacts = EMPTY_ARTIFACT_LINKS,
  deferImages = false,
  exportCodeHighlighter,
}: StreamdownRendererProps) {
  const rendererPlugins = useMemo<PluginConfig>(() => exportCodeHighlighter
    ? { ...plugins, code: exportCodeHighlighter }
    : plugins, [exportCodeHighlighter])
  const remarkPlugins = useMemo<NonNullable<ComponentProps<typeof Streamdown>['remarkPlugins']>>(() => [
    ...Object.values(defaultRemarkPlugins),
    [remarkArtifacts, { targets: artifacts.artifacts, paths: artifacts.paths }],
  ], [artifacts])
  // Streamdown's memo comparison ignores remarkPlugins; new output metadata
  // must also update an otherwise unchanged final reply.
  const artifactKey = JSON.stringify({ paths: artifacts.paths, targets: artifacts.allowedPaths })
  return (
    <div className={cn('streamdown-document w-full text-foreground', className)}>
      <MarkdownInteractionContext.Provider value={interactive}>
        <ArtifactLinksContext.Provider value={artifacts}>
          <Streamdown
          key={`${artifactKey}:${interactive ? 'interactive' : 'preview'}`}
          animated={streaming ? streamingAnimation : false}
          components={deferImages ? exportComponents : interactive ? components : previewComponents}
          allowedTags={deferImages ? exportTags : colorTags}
          rehypePlugins={deferImages ? exportRehypePlugins : undefined}
          controls={interactive && interactiveCodeBlocks ? interactiveControls : false}
          isAnimating={streaming}
          linkSafety={linkSafety}
          lineNumbers={interactiveCodeBlocks}
          mode={streaming ? 'streaming' : 'static'}
          plugins={rendererPlugins}
          remarkPlugins={remarkPlugins}
          translations={translations}
          >
            {normalizeLatexForKatex(markdown)}
          </Streamdown>
        </ArtifactLinksContext.Provider>
      </MarkdownInteractionContext.Provider>
    </div>
  )
}

export default StreamdownRenderer
