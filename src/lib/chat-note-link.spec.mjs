import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveChatNoteLink } from './chat-note-link.js'

test('opens workspace-relative Markdown paths without depending on the active note', () => {
  assert.equal(resolveChatNoteLink('./work/meeting.md'), 'work/meeting.md')
  assert.equal(resolveChatNoteLink('work/../other.MD#heading'), 'other.MD')
  assert.equal(resolveChatNoteLink('./%E7%AC%94%E8%AE%B0/hello%20world.markdown'), '笔记/hello world.markdown')
  assert.equal(resolveChatNoteLink('./notes/a%23b%3Fc.md'), 'notes/a#b?c.md')
})

test('leaves web links and non-note links alone', () => {
  for (const href of ['https://example.org/note.md', '//example.org/note.md', 'mailto:me@example.org', '#heading', 'image.png', '']) {
    assert.equal(resolveChatNoteLink(href), null, href)
  }
})

test('rejects paths outside the workspace and malformed links', () => {
  for (const href of ['../secret.md', './a/../../secret.md', '/tmp/note.md', 'C:\\notes\\a.md', 'file:///tmp/a.md', '%2Ftmp/a.md', '%2e%2e/secret.md', '%00.md', '%ZZ.md']) {
    assert.equal(resolveChatNoteLink(href), null, href)
  }
})
