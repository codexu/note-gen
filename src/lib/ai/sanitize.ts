const THINKING_BLOCK_REGEX = /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi
const THINKING_TAG_REGEX = /<\/?think\b[^>]*>/gi
const STREAM_LOOKBACK = 32

export function sanitizeAiRewriteOutput(content: string): string {
  if (!content) {
    return ''
  }

  return content
    .replace(THINKING_BLOCK_REGEX, '')
    .replace(THINKING_TAG_REGEX, '')
}

export function createThinkingContentSanitizer() {
  let pending = ''
  let inThinkingBlock = false

  const stripTags = (value: string) => value.replace(THINKING_TAG_REGEX, '')

  return {
    push(chunk: string): string {
      if (!chunk) {
        return ''
      }

      let remaining = pending + chunk
      pending = ''
      let output = ''

      while (remaining) {
        if (inThinkingBlock) {
          const closeMatch = remaining.match(/<\/think\s*>/i)

          if (!closeMatch || closeMatch.index === undefined) {
            pending = remaining.slice(-STREAM_LOOKBACK)
            return output
          }

          remaining = remaining.slice(closeMatch.index + closeMatch[0].length)
          inThinkingBlock = false
          continue
        }

        const tagMatch = remaining.match(/<\/?think\b[^>]*>/i)

        if (!tagMatch || tagMatch.index === undefined) {
          const safeLength = Math.max(0, remaining.length - STREAM_LOOKBACK)
          output += remaining.slice(0, safeLength)
          pending = remaining.slice(safeLength)
          return stripTags(output)
        }

        output += remaining.slice(0, tagMatch.index)
        inThinkingBlock = !tagMatch[0].startsWith('</')
        remaining = remaining.slice(tagMatch.index + tagMatch[0].length)
      }

      return stripTags(output)
    },

    flush(): string {
      if (inThinkingBlock) {
        pending = ''
        return ''
      }

      const output = sanitizeAiRewriteOutput(pending)
      pending = ''
      return output
    },
  }
}

export function createAiStreamContentProcessor() {
  let pending = ''
  let inThinkingBlock = false

  const finalizeVisible = (value: string) => value.replace(THINKING_TAG_REGEX, '')

  return {
    push(chunk: string): { content: string; thinking: string } {
      if (!chunk) {
        return { content: '', thinking: '' }
      }

      let remaining = pending + chunk
      pending = ''
      let content = ''
      let thinking = ''

      while (remaining) {
        const tagMatch = remaining.match(/<\/?think\b[^>]*>/i)

        if (!tagMatch || tagMatch.index === undefined) {
          const safeLength = Math.max(0, remaining.length - STREAM_LOOKBACK)
          const safeChunk = remaining.slice(0, safeLength)
          pending = remaining.slice(safeLength)

          if (inThinkingBlock) {
            thinking += safeChunk
          } else {
            content += safeChunk
          }

          return {
            content: finalizeVisible(content),
            thinking: finalizeVisible(thinking),
          }
        }

        const beforeTag = remaining.slice(0, tagMatch.index)
        if (inThinkingBlock) {
          thinking += beforeTag
        } else {
          content += beforeTag
        }

        if (!tagMatch[0].startsWith('</')) {
          inThinkingBlock = true
        } else {
          inThinkingBlock = false
        }

        remaining = remaining.slice(tagMatch.index + tagMatch[0].length)
      }

      return {
        content: finalizeVisible(content),
        thinking: finalizeVisible(thinking),
      }
    },

    flush(): { content: string; thinking: string } {
      if (!pending) {
        return { content: '', thinking: '' }
      }

      const output = inThinkingBlock
        ? { content: '', thinking: finalizeVisible(pending) }
        : { content: finalizeVisible(pending), thinking: '' }

      pending = ''
      return output
    },
  }
}
