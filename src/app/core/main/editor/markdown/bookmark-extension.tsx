'use client'

import { getMarkRange, Node, mergeAttributes } from '@tiptap/core'
import type { Range } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Globe, Link2, LoaderCircle, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { capturePublicWebPage } from '@/lib/web-capture/service'
import { cn } from '@/lib/utils'

export interface BookmarkAttrs {
  url: string
  title: string
  description: string
  icon: string
  cover: string
  siteName: string
  status: 'loading' | 'ready' | 'error'
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmarkCard: {
      insertBookmarkCard: (url: string) => ReturnType
      convertLinkToBookmark: () => ReturnType
    }
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function getFaviconUrl(url: string): string {
  try {
    return `${new URL(url).origin}/favicon.ico`
  } catch {
    return ''
  }
}

function parseBookmarkPayload(raw: string): Partial<BookmarkAttrs> {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.url === 'string') {
      return {
        url: parsed.url,
        title: typeof parsed.title === 'string' ? parsed.title : '',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        icon: typeof parsed.icon === 'string' ? parsed.icon : '',
        cover: typeof parsed.cover === 'string' ? parsed.cover : '',
        siteName: typeof parsed.siteName === 'string' ? parsed.siteName : '',
      }
    }
  } catch {
    // fall through: treat the raw content as a bare URL
  }
  const url = raw.trim()
  return /^https?:\/\//.test(url) ? { url } : {}
}

function serializeBookmarkPayload(attrs: Record<string, unknown>): string {
  const payload: Record<string, string> = { url: String(attrs.url ?? '') }
  for (const key of ['title', 'description', 'icon', 'cover', 'siteName'] as const) {
    const value = attrs[key]
    if (typeof value === 'string' && value) {
      payload[key] = value
    }
  }
  return JSON.stringify(payload, null, 2)
}

function BookmarkCardView({ node, updateAttributes, editor, getPos, deleteNode }: ReactNodeViewProps) {
  const t = useTranslations('editor.bookmark')
  const { url, title, description, icon, cover, siteName, status } = node.attrs as BookmarkAttrs
  const [coverFailed, setCoverFailed] = useState(false)
  const [iconFailed, setIconFailed] = useState(false)
  const fetchingRef = useRef(false)

  const fetchMetadata = useCallback(async () => {
    if (fetchingRef.current || !url) {
      return
    }
    fetchingRef.current = true
    try {
      const result = await capturePublicWebPage(url, { timeoutMs: 20000 })
      const fetchedTitle = result.title?.trim() || ''
      if (fetchedTitle && result.status !== 'failed' && result.status !== 'blocked') {
        updateAttributes({
          title: fetchedTitle,
          description: result.excerpt?.trim() || '',
          siteName: result.siteName?.trim() || '',
          cover: result.imageUrl || '',
          icon: getFaviconUrl(result.finalUrl || url),
          status: 'ready',
        })
      } else {
        updateAttributes({ status: 'error' })
      }
    } catch {
      updateAttributes({ status: 'error' })
    } finally {
      fetchingRef.current = false
    }
  }, [url, updateAttributes])

  useEffect(() => {
    if (status === 'loading' && editor.isEditable) {
      void fetchMetadata()
    }
  }, [status, editor.isEditable, fetchMetadata])

  const handleOpen = useCallback(() => {
    if (url) {
      void openUrl(url).catch(() => {})
    }
  }, [url])

  const handleRefresh = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    setCoverFailed(false)
    setIconFailed(false)
    updateAttributes({ status: 'loading' })
  }, [updateAttributes])

  const handleConvertToLink = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos == null) {
      return
    }
    const label = title || url
    deleteNode()
    editor
      .chain()
      .focus()
      .insertContentAt(pos, {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: label,
            marks: [{ type: 'link', attrs: { href: url } }],
          },
        ],
      })
      .run()
  }, [editor, getPos, deleteNode, title, url])

  const domain = getDomain(url)

  return (
    <NodeViewWrapper className="bookmark-card-wrapper my-3" data-drag-handle>
      <div
        className={cn(
          'group relative flex cursor-pointer overflow-hidden rounded-lg border border-border bg-card transition-colors hover:bg-accent/40',
          status === 'loading' && 'cursor-default'
        )}
        onClick={status === 'loading' ? undefined : handleOpen}
        role="link"
        title={url}
      >
        {status === 'loading' ? (
          <div className="flex min-h-16 flex-1 items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 shrink-0 animate-spin" />
            <span className="truncate">{t('loading', { url })}</span>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1 px-4 py-3">
              <p className="truncate text-sm font-medium text-foreground">
                {title || domain}
              </p>
              {status === 'error' ? (
                <p className="mt-1 text-xs text-muted-foreground">{t('fetchFailed')}</p>
              ) : description ? (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p>
              ) : null}
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                {icon && !iconFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={icon}
                    alt=""
                    className="size-3.5 shrink-0 rounded-sm"
                    onError={() => setIconFailed(true)}
                  />
                ) : (
                  <Globe className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{siteName || domain}</span>
              </div>
            </div>
            {cover && !coverFailed && status === 'ready' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                className="hidden max-h-28 w-40 shrink-0 object-cover sm:block"
                onError={() => setCoverFailed(true)}
              />
            ) : null}
          </>
        )}

        {editor.isEditable && status !== 'loading' && (
          <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-md bg-card/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleRefresh}
              title={t('refresh')}
            >
              <RefreshCw className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleConvertToLink}
              title={t('toLink')}
            >
              <Link2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const BookmarkCard = Node.create({
  name: 'bookmarkCard',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
      icon: { default: '' },
      cover: { default: '' },
      siteName: { default: '' },
      status: { default: 'ready' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="bookmark-card"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'bookmark-card' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkCardView)
  },

  addCommands() {
    return {
      insertBookmarkCard: (url: string) => ({ chain }) => {
        if (!/^https?:\/\//.test(url)) {
          return false
        }
        return chain()
          .insertContent({ type: this.name, attrs: { url, status: 'loading' } })
          .run()
      },
      convertLinkToBookmark: () => ({ editor, state, chain }) => {
        const linkMarkType = state.schema.marks.link
        if (!linkMarkType) {
          return false
        }
        const { selection } = state
        const range: Range | void =
          getMarkRange(selection.$from, linkMarkType) || getMarkRange(selection.$to, linkMarkType)
        if (!range) {
          return false
        }
        const href = editor.getAttributes('link').href
        if (typeof href !== 'string' || !/^https?:\/\//.test(href.trim())) {
          return false
        }
        return chain()
          .focus()
          .deleteRange(range)
          .insertContentAt(range.from, {
            type: this.name,
            attrs: { url: href.trim(), status: 'loading' },
          })
          .run()
      },
    }
  },

  markdownTokenName: 'bookmark',

  markdownTokenizer: {
    name: 'bookmark',
    level: 'block',
    start: (src: string) => {
      const match = src.match(/^```bookmark\r?\n/)
      return match ? (match.index ?? -1) : -1
    },
    tokenize: (src) => {
      const match = /^```bookmark\r?\n([\s\S]*?)\r?\n```/.exec(src)
      if (!match) return undefined

      return {
        type: 'bookmark',
        raw: match[0],
        content: match[1],
      }
    },
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return `\n\`\`\`bookmark\n${serializeBookmarkPayload(node.attrs ?? {})}\n\`\`\`\n`
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    const attrs = parseBookmarkPayload(token.content || '')
    if (!attrs.url) {
      return { type: 'paragraph', content: [] }
    }
    return {
      type: 'bookmarkCard',
      attrs: {
        ...attrs,
        // Cards saved before metadata arrived resume fetching on open.
        status: attrs.title ? 'ready' : 'loading',
      },
    }
  },
})

export default BookmarkCard
