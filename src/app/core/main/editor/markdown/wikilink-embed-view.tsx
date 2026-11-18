'use client'

// Fork (Phase 2-3a, A-1): `![[嵌入]]` 的 node view，把目標內容轉入原位置（照 Obsidian）。
//
// - `![[Note]]`：目標筆記內容（去 frontmatter），唯讀，上方一行小字是筆記名稱（可點開啟），
//   最高 24rem 超過可捲。`![[Note#標題]]` 只顯示該段落，`![[Note#^id]]` 只顯示該區塊
//   （段落取法在 src/lib/markdown/note-section.ts）。
// - `![[圖.png]]`、`![[圖.png|300]]`：圖片；其他附件顯示檔名與「開啟」。
// - 目標不存在：「找不到 ⧉ 名稱」虛線框（沿用 2-1 的 .notegen-wikilink-embed 樣式）。
// - 內容用 markdown-it 轉 HTML（html: false，所以原始 HTML 會被跳脫；不另開 Tiptap）。
//   嵌入內的 `[[連結]]` 是可點文字；嵌入內再嵌入最多 2 層，第 3 層只顯示「⧉ 名稱」。
// - 內容由 readNote 讀，依「路徑＋索引的 mtime」快取，所以 watcher 更新索引時會重讀。
// - 存檔仍是 attrs.raw（本檔不碰 markdown 序列化）。
//
// 純函式（loadEmbed、renderEmbedHtml 等）與 React 元件分開，前者可注入 I/O 供測試。
// 本軌道不能改語系檔，介面文字先用繁中常數（EMBED_TEXT），整合時再搬進 i18n。

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import {
  findWikilinks,
  noteKeyOf,
  parseWikilink,
  resolveWikilinkTarget,
  wikilinkDisplayText,
  type Wikilink,
} from '@/lib/markdown/wikilink'
import { extractBlock, extractSection, hideBlockIds, stripFrontmatter } from '@/lib/markdown/note-section'
import { resolveImagePathFromMarkdown } from '@/lib/markdown-image-path'
import { noteExists, readNote, revealInFileTree } from '@/lib/daily/note-io'
import { convertImageByWorkspace } from '@/lib/utils'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import useVaultIndexStore from '@/stores/vault-index'
import { shouldTransformImageSrcToWorkspaceAsset } from './image-src'
import { openWikilink } from './wikilink-extension'

/** 介面文字（繁中；整合時搬進 messages/*.json 的 editor 命名空間）。 */
export const EMBED_TEXT = {
  notFound: '找不到',
  sectionNotFound: '這篇沒有這個標題或區塊',
  loading: '讀取中…',
  open: '開啟',
  tooDeep: '嵌入太深，不再轉入',
} as const

export type EmbedText = { [K in keyof typeof EMBED_TEXT]: string }

export const MAX_EMBED_DEPTH = 2
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif'])

// ---------------------------------------------------------------------------
// 目標分類與尺寸

export type EmbedKind = 'note' | 'image' | 'attachment'

/** `圖.png` → image、`doc.pdf` → attachment、其餘（含 `Note.md`、`2026.10`）→ note。 */
export function classifyEmbedTarget(target: string): EmbedKind {
  const m = /\.([a-z0-9]{1,5})$/i.exec(target.trim())
  if (!m || !/[a-z]/i.test(m[1])) return 'note'
  const ext = m[1].toLowerCase()
  if (ext === 'md') return 'note'
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : 'attachment'
}

/** Obsidian 圖片尺寸別名：`300` → 寬 300，`300x200` → 寬高；其他文字不是尺寸。 */
export function parseEmbedSize(alias: string): { width?: number, height?: number } | null {
  const m = /^\s*(\d+)(?:x(\d+))?\s*$/i.exec(alias)
  if (!m) return null
  const width = Number(m[1])
  const height = m[2] ? Number(m[2]) : undefined
  return height ? { width, height } : { width }
}

// ---------------------------------------------------------------------------
// 內容載入（可注入 I/O）

export interface EmbedDeps {
  readNote: (path: string) => Promise<string | null>
  /** 把 `[[ ]]` 的筆記目標解析成 vault 路徑；找不到 null */
  resolveNote: (target: string, sourcePath: string) => string | null
  /** 附件（圖片、pdf）是否存在於這個相對路徑 */
  attachmentExists: (path: string) => Promise<boolean>
}

export interface EmbedNote {
  kind: 'note'
  path: string
  /** 要顯示的 markdown（已去 frontmatter；有 `#標題`／`^id` 時只有那一段） */
  markdown: string
  /** `#標題`／`^id` 在目標裡找不到 */
  sectionMissing: boolean
  /** 內文裡的巢狀筆記嵌入，key 是 raw；null = 目標不存在。超過層數或循環的不在 map 裡 */
  children: Map<string, EmbedNote | null>
}

export type EmbedResult =
  | { kind: 'missing' }
  | EmbedNote
  | { kind: 'image', path: string, width?: number, height?: number }
  | { kind: 'attachment', path: string }

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function normalizeRel(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/')
}

/**
 * 附件不在索引裡，依序試：本篇同資料夾、vault 根目錄（Obsidian 預設的「最短路徑」兩種常見位置）。
 * 找不到回傳 null。
 */
export async function resolveAttachmentPath(
  target: string,
  sourcePath: string,
  exists: EmbedDeps['attachmentExists'],
): Promise<string | null> {
  const clean = normalizeRel(target)
  if (!clean) return null
  const folder = folderOf(normalizeRel(sourcePath))
  const candidates = [folder ? `${folder}/${clean}` : clean, clean]
  for (const candidate of Array.from(new Set(candidates))) {
    if (await exists(candidate)) return candidate
  }
  return null
}

const CYCLIC = Symbol('cyclic')

async function loadEmbedNote(
  link: Wikilink,
  sourcePath: string,
  deps: EmbedDeps,
  depth: number,
  ancestors: Set<string>,
): Promise<EmbedNote | null | typeof CYCLIC> {
  const path = deps.resolveNote(link.target, sourcePath)
  if (!path) return null
  if (ancestors.has(path)) return CYCLIC
  const content = await deps.readNote(path)
  if (content === null) return null

  let markdown: string
  let sectionMissing = false
  if (link.blockId) {
    const block = extractBlock(content, link.blockId)
    sectionMissing = block === null
    markdown = block ?? ''
  } else if (link.heading) {
    const section = extractSection(content, link.heading)
    sectionMissing = section === null
    markdown = section ?? ''
  } else {
    markdown = stripFrontmatter(content)
  }

  const children = new Map<string, EmbedNote | null>()
  if (depth < MAX_EMBED_DEPTH) {
    const nested = new Set(ancestors).add(path)
    for (const found of findWikilinks(markdown)) {
      if (!found.embed || children.has(found.raw) || classifyEmbedTarget(found.target) !== 'note') continue
      const child = await loadEmbedNote(found, path, deps, depth + 1, nested)
      if (child !== CYCLIC) children.set(found.raw, child)
    }
  }
  return { kind: 'note', path, markdown, sectionMissing, children }
}

/** 解析並讀取一個 `![[嵌入]]` 要顯示的東西。 */
export async function loadEmbed(link: Wikilink, sourcePath: string, deps: EmbedDeps): Promise<EmbedResult> {
  const kind = classifyEmbedTarget(link.target)
  if (kind === 'note') {
    // 本篇嵌入自己：第一層照常顯示，內層再遇到自己才當循環
    const note = await loadEmbedNote(link, sourcePath, deps, 1, new Set())
    return note && note !== CYCLIC ? note : { kind: 'missing' }
  }
  const path = await resolveAttachmentPath(link.target, sourcePath, deps.attachmentExists)
  if (!path) return { kind: 'missing' }
  if (kind === 'image') return { kind: 'image', path, ...(parseEmbedSize(link.alias) ?? {}) }
  return { kind: 'attachment', path }
}

// 內容快取：key = 路徑 + 索引記的 mtime（watcher 更新索引時 mtime 變，就會重讀）
const CONTENT_CACHE_LIMIT = 200
const contentCache = new Map<string, Promise<string | null>>()

function cachedReadNote(path: string): Promise<string | null> {
  const mtime = useVaultIndexStore.getState().notes.get(path)?.mtime ?? 'unindexed'
  const key = `${path}\u0000${mtime}`
  const hit = contentCache.get(key)
  if (hit) return hit
  const promise = readNote(path).catch(() => null)
  contentCache.set(key, promise)
  if (contentCache.size > CONTENT_CACHE_LIMIT) {
    const oldest = contentCache.keys().next().value
    if (typeof oldest === 'string') contentCache.delete(oldest)
  }
  return promise
}

/** 給測試用：清掉內容快取。 */
export function clearEmbedContentCache(): void {
  contentCache.clear()
}

/** 元件用的 I/O：快取讀檔、索引解析、附件存在檢查（匯出給測試）。 */
export const defaultEmbedDeps: EmbedDeps = {
  readNote: cachedReadNote,
  resolveNote: (target, sourcePath) => resolveWikilinkTarget(target, useVaultIndexStore.getState().notes.keys(), sourcePath),
  attachmentExists: path => noteExists(path).catch(() => false),
}

// ---------------------------------------------------------------------------
// markdown → HTML

const WIKILINK_TOKEN = 'notegen_wikilink'
const WIKILINK_RE = /^!?\[\[[^\]\n]*?\]\]/

interface EmbedEnv { note: EmbedNote, depth: number, text: EmbedText }

const md = new MarkdownIt({ html: false, linkify: false, breaks: false, typographer: false })
const escapeHtml = md.utils.escapeHtml

function wikilinkInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const pos = state.pos
  const ch = src.charCodeAt(pos)
  if (ch !== 0x5b /* [ */ && ch !== 0x21 /* ! */) return false
  if (ch === 0x21 && src.charCodeAt(pos + 1) !== 0x5b) return false
  const m = WIKILINK_RE.exec(src.slice(pos))
  if (!m) return false
  const link = parseWikilink(m[0])
  if (!link) return false
  if (!silent) {
    const token = state.push(WIKILINK_TOKEN, '', 0)
    token.content = m[0]
    token.meta = link
  }
  state.pos += m[0].length
  return true
}

/**
 * 段落裡只要有「筆記嵌入」就拿掉 `<p>`，並把那些嵌入以區塊（`<div>`）呈現：
 * 巢狀內容本身含 `<h2>`／`<p>`，塞在 `<p>`／`<span>` 裡會被瀏覽器拆開，連同段落裡的其他文字一起消失。
 * 圖片嵌入是 `<img>`，留在行內沒問題。
 */
function unwrapEmbedParagraphs(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].type !== 'paragraph_open' || tokens[i + 1].type !== 'inline' || tokens[i + 2].type !== 'paragraph_close') continue
    const children = tokens[i + 1].children ?? []
    const embeds = children.filter(child => {
      if (child.type !== WIKILINK_TOKEN) return false
      const link = child.meta as Wikilink
      return link.embed && classifyEmbedTarget(link.target) === 'note'
    })
    if (embeds.length === 0) continue
    tokens[i].hidden = true
    tokens[i + 2].hidden = true
    for (const child of embeds) child.meta = { ...(child.meta as Wikilink), block: true }
  }
}

function embedChip(label: string, extraClass = ''): string {
  return `<span class="notegen-wikilink notegen-wikilink-embed ${extraClass}">${escapeHtml(label)}</span>`
}

function renderNestedEmbed(link: Wikilink & { block?: boolean }, env: EmbedEnv): string {
  const name = noteKeyOf(link.target) || wikilinkDisplayText(link)
  const kind = classifyEmbedTarget(link.target)
  if (kind === 'image') {
    const size = parseEmbedSize(link.alias)
    const attrs = [
      `data-notegen-target="${escapeHtml(link.target)}"`,
      `data-notegen-note="${escapeHtml(env.note.path)}"`,
      `alt="${escapeHtml(name)}"`,
      size?.width ? `width="${size.width}"` : '',
      size?.height ? `height="${size.height}"` : '',
    ].filter(Boolean).join(' ')
    return `<img class="notegen-embed-img" ${attrs}>`
  }
  if (kind === 'attachment') return embedChip(`📎 ${name}`)
  // 第 3 層或循環：沒載入，只顯示名稱
  if (env.depth >= MAX_EMBED_DEPTH || !env.note.children.has(link.raw)) {
    return embedChip(`⧉ ${name}`, 'notegen-embed-too-deep')
  }
  const child = env.note.children.get(link.raw)
  if (!child) return embedChip(`${env.text.notFound} ⧉ ${name}`, 'notegen-wikilink-unresolved')
  const title = link.heading ? `${name} > ${link.heading}` : link.blockId ? `${name} > ^${link.blockId}` : name
  const body = child.sectionMissing
    ? `<span class="notegen-embed-empty">${escapeHtml(env.text.sectionNotFound)}</span>`
    : renderEmbedHtml(child, env.depth + 1, env.text)
  const tag = link.block ? 'div' : 'span'
  return `<${tag} class="notegen-embed notegen-embed-nested" data-depth="${env.depth + 1}">`
    + `<${tag} class="notegen-embed-title"><button type="button" class="notegen-embed-open" data-notegen-open="${escapeHtml(child.path)}">⧉ ${escapeHtml(title)}</button></${tag}>`
    + `<${tag} class="notegen-embed-body">${body}</${tag}>`
    + `</${tag}>`
}

md.inline.ruler.before('link', WIKILINK_TOKEN, wikilinkInlineRule)
md.core.ruler.after('inline', 'notegen_embed_paragraphs', unwrapEmbedParagraphs)

md.renderer.rules[WIKILINK_TOKEN] = (tokens: Token[], index: number, _options, envRaw: unknown) => {
  const link = tokens[index].meta as Wikilink & { block?: boolean }
  const env = envRaw as EmbedEnv
  if (link.embed) return renderNestedEmbed(link, env)
  return `<a class="notegen-wikilink" data-raw="${escapeHtml(link.raw)}" title="${escapeHtml(link.target || link.heading)}">${escapeHtml(wikilinkDisplayText(link))}</a>`
}

// 相對路徑的圖片先不給 src（改成 data 屬性），由元件在掛上畫面後換成 asset:// 網址
const defaultImageRule = md.renderer.rules.image
md.renderer.rules.image = (tokens, index, options, envRaw, self) => {
  const token = tokens[index]
  const src = token.attrGet('src') ?? ''
  if (!shouldTransformImageSrcToWorkspaceAsset(src)) return defaultImageRule!(tokens, index, options, envRaw, self)
  const env = envRaw as EmbedEnv
  const alt = self.renderInlineAsText(token.children ?? [], options, envRaw)
  const title = token.attrGet('title')
  return `<img class="notegen-embed-img" data-notegen-src="${escapeHtml(src)}" data-notegen-note="${escapeHtml(env.note.path)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`
}

/** 把一篇（或一段）嵌入內容轉成 HTML；`depth` 是這段內容的層數（最外層 1）。 */
export function renderEmbedHtml(note: EmbedNote, depth = 1, text: EmbedText = EMBED_TEXT): string {
  // Fork (#15)：行尾的 ^區塊id 只對 Obsidian 有意義，嵌入顯示時隱藏
  return md.render(hideBlockIds(note.markdown), { note, depth, text } satisfies EmbedEnv)
}

// ---------------------------------------------------------------------------
// React node view

async function openInEditor(path: string): Promise<void> {
  await revealInFileTree(path)
  await useArticleStore.getState().setActiveFilePath(path)
}

async function absoluteVaultPath(relativePath: string): Promise<string> {
  const workspace = await getWorkspacePath()
  if (workspace.isCustom) return `${workspace.path.replace(/\/+$/, '')}/${relativePath}`
  return getDefaultArticleAbsolutePath(relativePath)
}

async function openAttachment(path: string): Promise<void> {
  const { openPath } = await import('@tauri-apps/plugin-opener')
  await openPath(await absoluteVaultPath(path))
}

/** 把 markdown-it 留下的 data 屬性圖片換成可顯示的網址。 */
async function activateEmbedImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-notegen-src], img[data-notegen-target]'))
  for (const image of images) {
    if (image.getAttribute('src')) continue
    const notePath = image.dataset.notegenNote ?? ''
    let relative: string | null = null
    if (image.dataset.notegenSrc) {
      relative = resolveImagePathFromMarkdown(notePath, image.dataset.notegenSrc)
    } else if (image.dataset.notegenTarget) {
      relative = await resolveAttachmentPath(image.dataset.notegenTarget, notePath, defaultEmbedDeps.attachmentExists)
    }
    if (!relative) continue
    try {
      image.src = await convertImageByWorkspace(relative)
    } catch (error) {
      console.error('[wikilink-embed] image failed', error)
    }
  }
}

type LoadState = { status: 'loading' } | { status: 'ready', result: EmbedResult }

export function WikilinkEmbedView({ node }: ReactNodeViewProps) {
  const t = useTranslations('editor.wikilinkEmbed')
  const text = useMemo<EmbedText>(() => ({
    notFound: t('notFound'), sectionNotFound: t('sectionNotFound'), loading: t('loading'), open: t('open'), tooDeep: t('tooDeep'),
  }), [t])
  const link = node.attrs as Wikilink
  const sourcePath = useArticleStore(state => state.activeFilePath)
  const revision = useVaultIndexStore(state => state.revision)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const bodyRef = useRef<HTMLSpanElement>(null)
  const name = noteKeyOf(link.target) || wikilinkDisplayText(link)
  const title = link.heading ? `${name} > ${link.heading}` : link.blockId ? `${name} > ^${link.blockId}` : name

  useEffect(() => {
    let cancelled = false
    loadEmbed(link, sourcePath, defaultEmbedDeps)
      .then(result => { if (!cancelled) setState({ status: 'ready', result }) })
      .catch(error => {
        console.error('[wikilink-embed] load failed', error)
        if (!cancelled) setState({ status: 'ready', result: { kind: 'missing' } })
      })
    return () => { cancelled = true }
    // link.raw 涵蓋 target／heading／blockId／alias；revision 讓 watcher 的更新重讀
  }, [link.raw, sourcePath, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const result = state.status === 'ready' ? state.result : null
  const html = result?.kind === 'note' && !result.sectionMissing ? renderEmbedHtml(result, 1, text) : ''

  useEffect(() => {
    if (result?.kind !== 'image') { setImageSrc(null); return }
    let cancelled = false
    convertImageByWorkspace(result.path)
      .then(src => { if (!cancelled) setImageSrc(src) })
      .catch(error => console.error('[wikilink-embed] image failed', error))
    return () => { cancelled = true }
  }, [result])

  useEffect(() => {
    if (!html || !bodyRef.current) return
    void activateEmbedImages(bodyRef.current)
  }, [html])

  const handleBodyClick = useCallback((event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    const anchor = target.closest<HTMLElement>('a.notegen-wikilink[data-raw]')
    if (anchor) {
      event.preventDefault()
      event.stopPropagation()
      const nested = parseWikilink(anchor.dataset.raw ?? '')
      if (nested) void openWikilink(nested).catch(error => console.error('[wikilink-embed] open failed', error))
      return
    }
    const opener = target.closest<HTMLElement>('[data-notegen-open]')
    if (opener) {
      event.preventDefault()
      event.stopPropagation()
      void openInEditor(opener.dataset.notegenOpen ?? '').catch(error => console.error('[wikilink-embed] open failed', error))
      return
    }
    const external = target.closest<HTMLAnchorElement>('a[href]')
    if (external) {
      // 嵌入是唯讀的，外部連結交給系統瀏覽器
      event.preventDefault()
      event.stopPropagation()
      void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(external.href)).catch(() => undefined)
    }
  }, [])

  const shared = { 'data-type': 'wikilink', 'data-raw': link.raw, title: link.target || link.heading }

  if (!result) {
    return (
      <NodeViewWrapper as="span" className="notegen-embed notegen-embed-loading" {...shared}>
        <span className="notegen-wikilink notegen-wikilink-embed">⧉ {name} · {text.loading}</span>
      </NodeViewWrapper>
    )
  }

  if (result.kind === 'missing') {
    return (
      <NodeViewWrapper as="span" className="notegen-embed notegen-embed-missing" {...shared}>
        <span className="notegen-wikilink notegen-wikilink-embed notegen-wikilink-unresolved">{text.notFound} ⧉ {name}</span>
      </NodeViewWrapper>
    )
  }

  if (result.kind === 'image') {
    return (
      <NodeViewWrapper as="span" className="notegen-embed notegen-embed-image" {...shared}>
        {imageSrc
          ? <img className="notegen-embed-img" src={imageSrc} alt={name} width={result.width} height={result.height} />
          : <span className="notegen-wikilink notegen-wikilink-embed">⧉ {name}</span>}
      </NodeViewWrapper>
    )
  }

  if (result.kind === 'attachment') {
    return (
      <NodeViewWrapper as="span" className="notegen-embed notegen-embed-attachment" {...shared}>
        <span className="notegen-wikilink notegen-wikilink-embed">
          📎 {name}
          <button
            type="button"
            className="notegen-embed-open ml-2 text-brand underline underline-offset-2"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              void openAttachment(result.path).catch(error => console.error('[wikilink-embed] open failed', error))
            }}
          >
            {text.open}
          </button>
        </span>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="span" className="notegen-embed notegen-embed-note" data-depth="1" {...shared}>
      <span className="notegen-embed-title">
        <button
          type="button"
          className="notegen-embed-open"
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            void openInEditor(result.path).catch(error => console.error('[wikilink-embed] open failed', error))
          }}
        >
          ⧉ {title}
        </button>
      </span>
      {result.sectionMissing
        ? <span className="notegen-embed-body notegen-embed-empty">{text.sectionNotFound}</span>
        : <span ref={bodyRef} className="notegen-embed-body" onClick={handleBodyClick} dangerouslySetInnerHTML={{ __html: html }} />}
    </NodeViewWrapper>
  )
}

export default WikilinkEmbedView
