import test from 'node:test'
import assert from 'node:assert/strict'

import {
  preserveFileNameInputValue,
  sanitizeFileNameOnCommit,
} from './file-name-input.js'

test('preserves whitespace while editing file names', () => {
  assert.equal(preserveFileNameInputValue('voice probe'), 'voice probe')
  assert.equal(preserveFileNameInputValue('voice   probe'), 'voice   probe')
})

test('replaces whitespace only when committing file names', () => {
  assert.equal(sanitizeFileNameOnCommit('voice probe'), 'voice_probe')
  assert.equal(sanitizeFileNameOnCommit('voice   probe'), 'voice_probe')
})
