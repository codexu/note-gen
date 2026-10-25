import type { TokensList } from 'marked'

// Bump when changing the parser contract so an old generated asset is rejected.
export const MARKDOWN_LEXER_VERSION = 2

export interface MarkdownLexerRequest {
  type: 'tokenize'
  version: number
  requestId: number
  source: string
}

export type MarkdownLexerResponse =
  | { type: 'ready'; version: number }
  | { type: 'tokens'; version: number; requestId: number; tokens: TokensList; tokenizerNames: string[]; durationMs: number }
  | { type: 'error'; version: number; requestId: number }
