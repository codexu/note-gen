// @vitest-environment jsdom
// 同步上游 2026-11-17：上游的 Agent 局部編輯（agent-markdown-edit.ts）直接 parse 整份 markdown。
// fork 的 frontmatter 要先編成 marker 才會變成 Frontmatter 節點；沒編碼時開頭的 --- 會變分隔線，
// 和編輯器裡的文件對不上，Agent 改內文就會被當成「動到不相關的地方」或整份重排。
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { MarkdownParagraph, normalizeMarkdownPlaceholders } from '@/app/core/main/editor/markdown/markdown-paragraph'
import { encodeFrontmatterForEditor, Frontmatter } from '@/app/core/main/editor/markdown/frontmatter-extension'
import { WikiMetadata } from '@/app/core/main/editor/markdown/wiki-metadata-extension'
import {
  applyAgentDocumentEdit,
  applyAgentSnapshotRestore,
  assertAgentMarkdownChangeLocal,
  buildAgentMarkdownEdit,
} from '@/app/core/main/editor/markdown/agent-markdown-edit'

function createEditor() {
  return new Editor({
    extensions: [
      Frontmatter,
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        link: false,
        paragraph: false,
        underline: false,
        dropcursor: false,
      }),
      MarkdownParagraph,
      WikiMetadata,
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
  })
}

function load(editor: Editor, raw: string) {
  editor.chain().setMeta('addToHistory', false)
    .setContent(encodeFrontmatterForEditor(raw), { contentType: 'markdown' }).run()
}

const note = `---
tags:
  - daily
---

# 今天

第一段

第二段
`

describe('Agent 局部編輯保留 frontmatter', () => {
  it('只改內文一段時，frontmatter 原樣留著、只動那一段', () => {
    const editor = createEditor()
    load(editor, note)
    const before = normalizeMarkdownPlaceholders(editor.getMarkdown())
    const after = before.replace('第二段', '第二段（已修改）')

    expect(() => assertAgentMarkdownChangeLocal(editor, before, after)).not.toThrow()
    const updated = buildAgentMarkdownEdit(editor, before, after)
    expect(updated.firstChild?.type.name).toBe('frontmatter')
    applyAgentDocumentEdit(editor, updated)

    const saved = normalizeMarkdownPlaceholders(editor.getMarkdown())
    expect(saved).toContain('tags:\n  - daily\n---')
    expect(saved).toContain('第二段（已修改）')
    expect(saved).not.toContain('## ')
  })

  it('回看撤銷（snapshot restore）後 frontmatter 仍是屬性卡片，不會變成分隔線加標題', () => {
    const editor = createEditor()
    load(editor, note)
    const snapshot = normalizeMarkdownPlaceholders(editor.getMarkdown())
    load(editor, note.replace('第一段', '被 Agent 改過'))

    applyAgentSnapshotRestore(editor, snapshot)
    expect(editor.state.doc.firstChild?.type.name).toBe('frontmatter')
    expect(normalizeMarkdownPlaceholders(editor.getMarkdown())).toBe(snapshot)
  })

  it('LLM Wiki 的 frontmatter 不包成屬性卡片，交給 WikiMetadata', () => {
    const wiki = '---\nnotegen-wiki-origin: abc\n---\n\n內文\n'
    expect(encodeFrontmatterForEditor(wiki)).toBe(wiki)
    expect(encodeFrontmatterForEditor(note)).not.toBe(note)
  })
})
