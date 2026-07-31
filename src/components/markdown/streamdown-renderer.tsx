'use client'

import { createMathPlugin } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import type { ComponentProps } from 'react'
import { useMemo } from 'react'
import { Streamdown, type AnimateOptions, type Components, type PluginConfig } from 'streamdown'
import { normalizeLatexForKatex } from '@/lib/latex'
import { cn } from '@/lib/utils'
import 'highlight.js/styles/github.min.css'
import 'katex/dist/katex.min.css'
import 'streamdown/styles.css'
import './streamdown-renderer.css'

type StreamdownCodeProps = ComponentProps<'code'> & {
  node?: unknown
  'data-block'?: boolean | string
}

interface StreamdownRendererProps {
  markdown: string
  streaming?: boolean
  className?: string
}

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)

const math = createMathPlugin({
  singleDollarTextMath: true,
  errorColor: 'var(--color-destructive)',
})

const plugins: PluginConfig = { cjk, math }
const linkSafety = { enabled: false }
const streamingAnimation: AnimateOptions = {
  animation: 'fadeIn',
  duration: 180,
  easing: 'ease-out',
  sep: 'char',
  stagger: 8,
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isBookmarkPayload(code: string): boolean {
  try {
    const parsed = JSON.parse(code)
    return Boolean(parsed) && typeof parsed === 'object' && typeof parsed.url === 'string'
  } catch {
    return false
  }
}

function StreamdownBookmarkCard({ code }: { code: string }) {
  const bookmark = useMemo(() => {
    try {
      const parsed = JSON.parse(code)
      if (parsed && typeof parsed === 'object' && typeof parsed.url === 'string') {
        return parsed as { url: string; title?: string; description?: string; icon?: string; siteName?: string; cover?: string }
      }
    } catch {
      // fall through to null: render as a plain code block
    }
    return null
  }, [code])

  if (!bookmark) {
    return null
  }

  let domain = bookmark.url
  try {
    domain = new URL(bookmark.url).hostname
  } catch {
    // keep the raw url as the label
  }

  return (
    <a
      href={bookmark.url}
      target="_blank"
      rel="noopener noreferrer"
      className="not-prose flex overflow-hidden rounded-lg border border-border bg-card no-underline transition-colors hover:bg-accent/40"
      title={bookmark.url}
    >
      <span className="min-w-0 flex-1 px-4 py-3">
        <span className="block truncate text-sm font-medium text-foreground">{bookmark.title || domain}</span>
        {bookmark.description ? (
          <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{bookmark.description}</span>
        ) : null}
        <span className="mt-2 block truncate text-xs text-muted-foreground">{bookmark.siteName || domain}</span>
      </span>
      {bookmark.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bookmark.cover} alt="" className="hidden max-h-28 w-40 shrink-0 object-cover sm:block" />
      ) : null}
    </a>
  )
}

function StreamdownCode({
  children,
  className,
  node,
  'data-block': dataBlock,
  ...props
}: StreamdownCodeProps) {
  void node
  const code = String(children ?? '').replace(/\n$/, '')
  const language = className?.match(/language-([\w-]+)/)?.[1]
  const highlightedCode = useMemo(() => {
    if (!dataBlock || !language || !hljs.getLanguage(language)) {
      return escapeHtml(code)
    }

    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    } catch {
      return escapeHtml(code)
    }
  }, [code, dataBlock, language])

  if (dataBlock && language === 'bookmark' && isBookmarkPayload(code)) {
    return <StreamdownBookmarkCard code={code} />
  }

  if (!dataBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  }

  return (
    <code
      className={cn('hljs block max-w-full overflow-x-auto rounded-lg border border-border bg-muted/50 p-4', className)}
      data-block={dataBlock}
      {...props}
      dangerouslySetInnerHTML={{ __html: highlightedCode }}
    />
  )
}

function StreamdownLink({ children, ...props }: ComponentProps<'a'>) {
  return (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

const components: Components = {
  a: StreamdownLink as Components['a'],
  code: StreamdownCode as Components['code'],
}

export function StreamdownRenderer({ markdown, streaming = false, className }: StreamdownRendererProps) {
  return (
    <div className={cn('streamdown-document w-full text-foreground', className)}>
      <Streamdown
        animated={streaming ? streamingAnimation : false}
        components={components}
        controls={false}
        isAnimating={streaming}
        linkSafety={linkSafety}
        mode={streaming ? 'streaming' : 'static'}
        plugins={plugins}
      >
        {normalizeLatexForKatex(markdown)}
      </Streamdown>
    </div>
  )
}

export default StreamdownRenderer
