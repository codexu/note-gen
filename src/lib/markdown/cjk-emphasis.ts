import { Marked } from 'marked'
import markedCjkFriendly from 'marked-cjk-friendly'

export function createCjkMarkdownLexer(): Marked {
  const { emStrong } = markedCjkFriendly().tokenizer ?? {}

  // Only opt into CJK emphasis. The extension's strikethrough tokenizer uses
  // delimiter rules that are not available in our pinned Marked version.
  return new Marked({ tokenizer: { emStrong } })
}
