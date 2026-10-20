import { createMarkdownLexer, MARKDOWN_TOKENIZER_NAMES } from './markdown-tokenizers'
import { MARKDOWN_LEXER_VERSION, type MarkdownLexerRequest, type MarkdownLexerResponse } from './markdown-lexer-protocol'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MarkdownLexerRequest>) => void) | null
  postMessage(message: MarkdownLexerResponse): void
}

workerScope.onmessage = ({ data }) => {
  if (data.type !== 'tokenize') return

  try {
    const startedAt = performance.now()
    if (data.version !== MARKDOWN_LEXER_VERSION) throw new Error('Markdown lexer version mismatch')
    // List helpers retain reference definitions. Keep those scoped to this
    // document even though the background thread itself is shared.
    const tokens = createMarkdownLexer().lexer(data.source)
    workerScope.postMessage({
      type: 'tokens',
      version: MARKDOWN_LEXER_VERSION,
      requestId: data.requestId,
      tokens,
      tokenizerNames: MARKDOWN_TOKENIZER_NAMES,
      durationMs: performance.now() - startedAt,
    })
  } catch {
    workerScope.postMessage({ type: 'error', version: MARKDOWN_LEXER_VERSION, requestId: data.requestId })
  }
}

workerScope.postMessage({ type: 'ready', version: MARKDOWN_LEXER_VERSION })
