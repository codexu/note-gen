export interface EditorStatistics {
  characters: number
  readingMinutes: number
}

export { markdownToPlainText } from './markdown-to-plain-text'

export function getEditorStatistics(text: string): EditorStatistics {
  const normalizedText = text.trim()
  if (!normalizedText) {
    return {
      characters: 0,
      readingMinutes: 0,
    }
  }

  const characters = Array.from(normalizedText).length
  const cjkCharacters = normalizedText.match(/\p{Script=Han}/gu)?.length ?? 0
  const nonCjkWords = normalizedText
    .replace(/\p{Script=Han}/gu, ' ')
    .match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  const readingMinutes = Math.max(1, Math.ceil((cjkCharacters / 300) + (nonCjkWords / 200)))

  return {
    characters,
    readingMinutes,
  }
}
