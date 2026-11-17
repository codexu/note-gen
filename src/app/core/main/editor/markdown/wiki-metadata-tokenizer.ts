import type { MarkdownTokenizer } from '@tiptap/core'

export const WIKI_METADATA_NODE_NAME = 'wikiMetadata'
export const WIKI_METADATA_REPLACE_DOCUMENT = 'notegen-wiki-replace-document'

const FRONTMATTER = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/
const SECTION_MARKER = /^<!-- notegen-wiki:[a-f0-9]{64}:[a-z0-9-]+:(?:start|end) -->(?=\r?\n|$)/

/** Reserved Wiki metadata is opaque to Markdown. In particular, the JSON must
 * never be parsed as prose, a horizontal rule, or HTML that the DOM discards.
 */
export const wikiMetadataTokenizer: MarkdownTokenizer = {
  name: WIKI_METADATA_NODE_NAME,
  level: 'block',
  start: source => {
    const match = /^(?:(?:\uFEFF)?---\r?$|<!-- notegen-wiki:[a-f0-9]{64}:[a-z0-9-]+:(?:start|end) -->\r?$)/m.exec(source)
    return match?.index ?? -1
  },
  tokenize: source => {
    const frontmatter = FRONTMATTER.exec(source)
    // Older exported notes have only the origin field. Keep their provenance
    // too, so editing them cannot accidentally turn them into new Wiki inputs.
    const header = frontmatter && /^notegen-wiki-origin:[^\r\n]+\r?$/m.test(frontmatter[1])
      ? frontmatter[0] : undefined
    const raw = header ?? SECTION_MARKER.exec(source)?.[0]
    return raw ? { type: WIKI_METADATA_NODE_NAME, raw, text: raw, tokens: [] } : undefined
  },
}
