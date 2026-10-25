'use client'

import { createMathPlugin } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import type { ComponentProps } from 'react'
import {
  Streamdown,
  type AnimateOptions,
  type Components,
  type ControlsConfig,
  type PluginConfig,
  type StreamdownTranslations,
} from 'streamdown'
import { normalizeLatexForKatex } from '@/lib/latex'
import { cn } from '@/lib/utils'
import { normalizeTextColor } from '@/lib/text-colors'
import { codeHighlighter } from '@/lib/code-highlighter'
import 'katex/dist/katex.min.css'
import 'streamdown/styles.css'
import './streamdown-renderer.css'

interface StreamdownRendererProps {
  markdown: string
  streaming?: boolean
  className?: string
  interactiveCodeBlocks?: boolean
  translations?: Partial<StreamdownTranslations>
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

function StreamdownLink({ children, ...props }: ComponentProps<'a'>) {
  return (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

// Keep raw CSS filtered by Streamdown. Reconstruct only a validated color.
const colorTags = { span: ['dataNotegenColor'], mark: ['dataNotegenColor'] }
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

export function StreamdownRenderer({
  markdown,
  streaming = false,
  className,
  interactiveCodeBlocks = true,
  translations,
}: StreamdownRendererProps) {
  return (
    <div className={cn('streamdown-document w-full text-foreground', className)}>
      <Streamdown
        animated={streaming ? streamingAnimation : false}
        components={components}
        allowedTags={colorTags}
        controls={interactiveCodeBlocks ? interactiveControls : false}
        isAnimating={streaming}
        linkSafety={linkSafety}
        lineNumbers={interactiveCodeBlocks}
        mode={streaming ? 'streaming' : 'static'}
        plugins={plugins}
        translations={translations}
      >
        {normalizeLatexForKatex(markdown)}
      </Streamdown>
    </div>
  )
}

export default StreamdownRenderer
