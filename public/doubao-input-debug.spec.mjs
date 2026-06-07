import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('static Doubao probe can report input events to a local collector', async () => {
  const html = await readFile(new URL('./doubao-input-debug.html', import.meta.url), 'utf8')

  assert.match(html, /127\.0\.0\.1:45678\/input-log/)
  assert.match(html, /reportLog/)
  assert.match(html, /rawTextarea\.focus/)
})
