import { lexer, walkTokens } from 'marked'

export const RECORD_INLINE_IMAGE_DIRECTORY = 'record-inline-assets'
export const RECORD_INLINE_IMAGE_EXTENSIONS = [
  'apng', 'avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jfif', 'jpeg', 'jpg', 'jxl', 'png', 'svg', 'tif', 'tiff', 'webp',
] as const
const RECORD_INLINE_IMAGE_PATH_PATTERN = new RegExp(
  `^(?:\\.?/)?${RECORD_INLINE_IMAGE_DIRECTORY}/([1-9][0-9]*)/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.(?:${RECORD_INLINE_IMAGE_EXTENSIONS.join('|')})$`,
)
const HTML_IMAGE_SOURCE_PATTERN = /<img\b[^>]*?\s+src\s*=\s*(['"])(.*?)\1/gi

export function getRecordInlineImagePath(src: string): string | null {
  const match = RECORD_INLINE_IMAGE_PATH_PATTERN.exec(src)
  return match?.[0] === src && Number.isSafeInteger(Number(match[1])) ? src.replace(/^\.?\//, '') : null
}

export function getRecordInlineImagePaths(type: unknown, content: unknown): string[] {
  if (typeof content !== 'string' || !content.includes(`${RECORD_INLINE_IMAGE_DIRECTORY}/`)) return []

  let markdown = content
  if (type === 'todo') {
    try {
      const todo: unknown = JSON.parse(content)
      if (typeof todo === 'object' && todo && 'description' in todo && typeof todo.description === 'string') {
        markdown = todo.description
      }
    } catch {
      // Older records can store their body as plain Markdown.
    }
  }

  const paths = new Set<string>()
  const collect = (src: string) => {
    const path = getRecordInlineImagePath(src)
    if (path) paths.add(path)
  }
  walkTokens(lexer(markdown), (token) => {
    if (token.type === 'image' && typeof token.href === 'string') collect(token.href)
    if (token.type === 'html' && typeof token.text === 'string') {
      for (const image of token.text.matchAll(HTML_IMAGE_SOURCE_PATTERN)) collect(image[2])
    }
  })
  return [...paths]
}
