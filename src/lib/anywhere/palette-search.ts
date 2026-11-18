// Fork（almanac ALMNC-9）：⌘K 命令面板的搜尋合併與排序。純函式、無 I/O。
// 同一個輸入框同時查筆記與指令（含外掛命令）：先算每一項的分數，再依分數分組排序。

export type PaletteKind = 'command' | 'plugin' | 'note'

export interface PaletteItem {
  id: string
  kind: PaletteKind
  title: string
  /** 第二行字：筆記的資料夾、外掛名稱 */
  subtitle?: string
  /** 額外可搜尋的字：別名、標籤、描述 */
  keywords?: string[]
  /** 毫秒；筆記用來在分數相同時排新的在前，空查詢時當「最近」 */
  mtime?: number
}

export interface PaletteSection {
  kind: PaletteKind
  items: PaletteItem[]
}

export interface PaletteOptions {
  /** 每個區塊最多顯示幾項 */
  limits?: Partial<Record<PaletteKind, number>>
}

const DEFAULT_LIMITS: Record<PaletteKind, number> = { command: 7, plugin: 6, note: 8 }
/** 空查詢時筆記只列最近幾則 */
const RECENT_NOTE_LIMIT = 5
const KIND_ORDER: PaletteKind[] = ['command', 'plugin', 'note']

function norm(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function isSubsequence(token: string, text: string): boolean {
  let at = 0
  for (const ch of text) {
    if (ch === token[at]) at += 1
    if (at === token.length) return true
  }
  return false
}

const WORD_BOUNDARY = /[\s/\\\-_.:·]/

/** 單一詞在標題的分數：完全相同 > 開頭 > 詞首 > 包含 > 依序出現的字母。0 表示沒中。 */
function titleScore(token: string, title: string): number {
  if (title === token) return 120
  if (title.startsWith(token)) return 100
  const at = title.indexOf(token)
  if (at > 0 && WORD_BOUNDARY.test(title[at - 1])) return 80
  if (at >= 0) return 60
  if (token.length >= 2 && isSubsequence(token, title)) return 25
  return 0
}

function tokenScore(token: string, item: PaletteItem, title: string, subtitle: string, keywords: string[]): number {
  let best = titleScore(token, title)
  if (keywords.includes(token)) best = Math.max(best, 55)
  else if (keywords.some(keyword => keyword.includes(token))) best = Math.max(best, 40)
  if (subtitle.includes(token)) best = Math.max(best, 30)
  return best
}

/** 查詢拆成空白分隔的詞，每個詞都要中（AND）；回傳平均分數，0 表示不符合。 */
export function scorePaletteItem(item: PaletteItem, query: string): number {
  const tokens = norm(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 1
  const title = norm(item.title)
  const subtitle = norm(item.subtitle ?? '')
  const keywords = (item.keywords ?? []).map(norm)
  let total = 0
  for (const token of tokens) {
    const score = tokenScore(token, item, title, subtitle, keywords)
    if (score === 0) return 0
    total += score
  }
  // 同分時短標題稍微靠前
  return total / tokens.length - Math.min(title.length, 100) * 0.05
}

function byScoreThenRecency(a: { item: PaletteItem, score: number }, b: { item: PaletteItem, score: number }): number {
  if (b.score !== a.score) return b.score - a.score
  const mtime = (b.item.mtime ?? 0) - (a.item.mtime ?? 0)
  if (mtime !== 0) return mtime
  return a.item.title.localeCompare(b.item.title)
}

export function buildPaletteSections(items: PaletteItem[], query: string, options: PaletteOptions = {}): PaletteSection[] {
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  const trimmed = query.trim()

  if (!trimmed) {
    const sections: PaletteSection[] = []
    for (const kind of KIND_ORDER) {
      const own = items.filter(item => item.kind === kind)
      const picked = kind === 'note'
        ? [...own].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)).slice(0, RECENT_NOTE_LIMIT)
        : own.slice(0, limits[kind])
      if (picked.length > 0) sections.push({ kind, items: picked })
    }
    return sections
  }

  const grouped = new Map<PaletteKind, Array<{ item: PaletteItem, score: number }>>()
  for (const item of items) {
    const score = scorePaletteItem(item, trimmed)
    if (score <= 0) continue
    const list = grouped.get(item.kind) ?? []
    list.push({ item, score })
    grouped.set(item.kind, list)
  }

  const sections = KIND_ORDER
    .filter(kind => grouped.has(kind))
    .map(kind => {
      const ranked = grouped.get(kind)!.sort(byScoreThenRecency)
      return { kind, top: ranked[0].score, items: ranked.slice(0, limits[kind]).map(entry => entry.item) }
    })
  // 最相符的區塊排最前；同分時維持 指令 > 外掛 > 筆記
  sections.sort((a, b) => b.top - a.top || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
  return sections.map(({ kind, items: picked }) => ({ kind, items: picked }))
}

/** 把筆記路徑轉成面板用的標題與資料夾 */
export function noteTitleParts(path: string): { title: string, folder: string } {
  const parts = path.split('/')
  const file = parts.pop() ?? path
  const dot = file.lastIndexOf('.')
  return { title: dot > 0 ? file.slice(0, dot) : file, folder: parts.join('/') }
}
