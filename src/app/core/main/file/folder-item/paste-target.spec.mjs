import test from 'node:test'
import assert from 'node:assert/strict'

import { getPasteTargetDirectory } from './paste-target.js'

test('uses the current folder path as the paste target for folder items', () => {
  assert.equal(getPasteTargetDirectory('projects/docs'), 'projects/docs')
})

test('keeps a root folder path as the paste target for folder items', () => {
  assert.equal(getPasteTargetDirectory('inbox'), 'inbox')
})
