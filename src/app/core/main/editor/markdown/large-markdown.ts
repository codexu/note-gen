export const LARGE_MARKDOWN_CHARACTER_THRESHOLD = 200_000
export const LARGE_MARKDOWN_LINE_THRESHOLD = 4_000
export const LARGE_MARKDOWN_HEAVY_NODE_THRESHOLD = 160

export function isLargeMarkdownDocument(markdown: string): boolean {
  if (markdown.length >= LARGE_MARKDOWN_CHARACTER_THRESHOLD) {
    return true
  }

  let lineCount = 1
  let heavyNodeMarkerCount = 0
  for (let index = 0; index < markdown.length; index++) {
    const character = markdown.charCodeAt(index)
    if (character === 10) {
      lineCount++
      if (lineCount >= LARGE_MARKDOWN_LINE_THRESHOLD) {
        return true
      }
      continue
    }

    const isImage = character === 33 && markdown.charCodeAt(index + 1) === 91
    const isCodeFence = (
      (character === 96 || character === 126)
      && markdown.charCodeAt(index + 1) === character
      && markdown.charCodeAt(index + 2) === character
    )
    const isDisplayMath = character === 36 && markdown.charCodeAt(index + 1) === 36
    const isBracketMath = (
      character === 92
      && (markdown.charCodeAt(index + 1) === 40 || markdown.charCodeAt(index + 1) === 91)
    )
    const isHtmlImage = (
      character === 60
      && markdown.slice(index, index + 4).toLowerCase() === '<img'
    )

    if (isImage || isCodeFence || isDisplayMath || isBracketMath || isHtmlImage) {
      heavyNodeMarkerCount++
      if (heavyNodeMarkerCount >= LARGE_MARKDOWN_HEAVY_NODE_THRESHOLD) {
        return true
      }

      if (isCodeFence) index += 2
      if (isDisplayMath || isBracketMath) index++
    }
  }

  return false
}
