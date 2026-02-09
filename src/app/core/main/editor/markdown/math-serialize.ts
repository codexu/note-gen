/**
 * Serialize editor content to markdown with proper math formula handling.
 * Converts <span data-type="inline-math"> and <div data-type="block-math"> elements
 * back to $...$ and $$...$$ syntax.
 */
export function serializeMathMarkdown(html: string): string {
  // Convert block math divs to $$...$$
  let markdown = html.replace(
    /<div[^>]*data-type="block-math"[^>]*data-latex="([^"]*)"[^>]*><\/div>/gi,
    (_, latex) => `\n$$${latex}$$\n`
  )

  // Convert inline math spans to $...$
  markdown = markdown.replace(
    /<span[^>]*data-type="inline-math"[^>]*data-latex="([^"]*)"[^>]*><\/span>/gi,
    (_, latex) => `$${latex}$`
  )

  // Also handle the rendered katex output (when editing)
  markdown = markdown.replace(
    /<span[^>]*class="[^"]*tiptap-mathematics-render[^"]*"[^>]*data-latex="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi,
    (_, latex) => `$${latex}$`
  )
  markdown = markdown.replace(
    /<div[^>]*class="[^"]*tiptap-mathematics-render[^"]*"[^>]*data-latex="([^"]*)"[^>]*>[\s\S]*?<\/div>/gi,
    (_, latex) => `\n$$${latex}$$\n`
  )

  return markdown
}

/**
 * Pre-process markdown content to convert $...$ syntax to HTML for math nodes.
 * This is used when loading content from markdown files.
 */
export function preprocessMathMarkdown(content: string): string {
  // Convert block math $$...$$ first (multi-line capable)
  content = content.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_, latex) => `<div data-type="block-math" data-latex="${latex.trim()}"></div>`
  )

  // Convert inline math $...$ (single line, not inside $$)
  content = content.replace(
    /\$([^\$\n]+?)\$/g,
    (_, latex) => `<span data-type="inline-math" data-latex="${latex}"></span>`
  )

  return content
}
