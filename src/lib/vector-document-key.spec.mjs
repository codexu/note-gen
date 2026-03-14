import test from 'node:test'
import assert from 'node:assert/strict'

import { buildVectorIndexedMap, getVectorDocumentKey } from './vector-document-key.js'

test('uses normalized relative file paths as vector document keys', () => {
  assert.equal(getVectorDocumentKey('notes\\daily\\todo.md'), 'notes/daily/todo.md')
})

test('keeps same-name files in different folders as separate vector keys', () => {
  const indexedMap = buildVectorIndexedMap([
    { filename: 'project-a/README.md', updated_at: 100 },
    { filename: 'project-b/README.md', updated_at: 200 },
  ])

  assert.equal(indexedMap.size, 2)
  assert.equal(indexedMap.get('project-a/README.md'), 100)
  assert.equal(indexedMap.get('project-b/README.md'), 200)
})
