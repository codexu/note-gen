import type { Mark } from "@/db/marks"
import { getMarkListItemContent } from "./mark-list-item-content"

export const RECORD_TAB_PREFIX = "record://mark/"

export type RecordTabType = Mark["type"]
export type RecordTabKind = "file" | "record"

export interface RecordTabInfo {
  id: string
  path: string
  name: string
  isFolder: false
  kind: "record"
  markId: number
  markType: RecordTabType
}

export function getRecordTabPath(markId: number) {
  return `${RECORD_TAB_PREFIX}${markId}`
}

export function getRecordIdFromTabPath(path: string) {
  if (!path.startsWith(RECORD_TAB_PREFIX)) {
    return null
  }

  const id = Number(path.slice(RECORD_TAB_PREFIX.length))
  return Number.isFinite(id) ? id : null
}

export function isRecordTabPath(path: string) {
  return getRecordIdFromTabPath(path) !== null
}

export function compactRecordTabName(value?: string) {
  const text = value?.replace(/\s+/g, " ").trim() || ""
  return text.length > 28 ? `${text.slice(0, 28).trim()}...` : text
}

export function getRecordTabName(mark: Mark, fallback: string) {
  const content = getMarkListItemContent(mark)
  return compactRecordTabName(
    content.title || content.preview || mark.desc || mark.content || mark.url
  ) || fallback
}

export function createRecordTab(mark: Mark, fallback: string): RecordTabInfo {
  const path = getRecordTabPath(mark.id)

  return {
    id: path,
    path,
    name: getRecordTabName(mark, fallback),
    isFolder: false,
    kind: "record",
    markId: mark.id,
    markType: mark.type,
  }
}
