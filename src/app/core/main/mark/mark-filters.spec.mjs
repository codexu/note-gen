import test from 'node:test'
import assert from 'node:assert/strict'

import { buildRecordFilterSummary, filterMarks, normalizeRecordFilters } from './mark-filters.mjs'

const baseMarks = [
  {
    id: 1,
    type: 'text',
    tagId: 1,
    content: 'Weekly planning notes',
    desc: '',
    url: '',
    createdAt: '2026-03-17T09:00:00.000Z',
  },
  {
    id: 2,
    type: 'recording',
    tagId: 2,
    content: 'Daily standup recording',
    desc: 'Team sync',
    url: 'audio/standup.m4a',
    createdAt: '2026-03-15T03:00:00.000Z',
  },
  {
    id: 3,
    type: 'link',
    tagId: 1,
    content: '',
    desc: 'Reference article',
    url: 'https://example.com/design-systems',
    createdAt: '2026-02-01T08:00:00.000Z',
  },
]

test('filters marks by search text, type, tag, and time presets', () => {
  const result = filterMarks(baseMarks, {
    search: 'team',
    selectedTypes: ['recording'],
    timePreset: 'last7Days',
    tagId: 2,
    now: '2026-03-17T12:00:00.000Z',
  })

  assert.deepEqual(result.map((mark) => mark.id), [2])
})

test('matches search text against content, description, and url', () => {
  const byContent = filterMarks(baseMarks, {
    search: 'planning',
    selectedTypes: [],
    timePreset: 'all',
    tagId: 'all',
    now: '2026-03-17T12:00:00.000Z',
  })
  const byDesc = filterMarks(baseMarks, {
    search: 'reference',
    selectedTypes: [],
    timePreset: 'all',
    tagId: 'all',
    now: '2026-03-17T12:00:00.000Z',
  })
  const byUrl = filterMarks(baseMarks, {
    search: 'design-systems',
    selectedTypes: [],
    timePreset: 'all',
    tagId: 'all',
    now: '2026-03-17T12:00:00.000Z',
  })

  assert.deepEqual(byContent.map((mark) => mark.id), [1])
  assert.deepEqual(byDesc.map((mark) => mark.id), [3])
  assert.deepEqual(byUrl.map((mark) => mark.id), [3])
})

test('supports today and last30Days time presets', () => {
  const todayOnly = filterMarks(baseMarks, {
    search: '',
    selectedTypes: [],
    timePreset: 'today',
    tagId: 'all',
    now: '2026-03-17T12:00:00.000Z',
  })
  const last30Days = filterMarks(baseMarks, {
    search: '',
    selectedTypes: [],
    timePreset: 'last30Days',
    tagId: 'all',
    now: '2026-03-17T12:00:00.000Z',
  })

  assert.deepEqual(todayOnly.map((mark) => mark.id), [1])
  assert.deepEqual(last30Days.map((mark) => mark.id), [1, 2])
})

test('normalizes persisted record filters and drops invalid values', () => {
  const normalized = normalizeRecordFilters({
    search: '  sync  ',
    selectedTypes: ['recording', 'unknown', 'text'],
    timePreset: 'last7Days',
    tagId: '2',
  })

  assert.deepEqual(normalized, {
    search: '  sync  ',
    selectedTypes: ['recording', 'text'],
    timePreset: 'last7Days',
    tagId: 2,
  })
})

test('builds a compact summary payload for active filters', () => {
  const summary = buildRecordFilterSummary({
    search: '  sync  ',
    selectedTypes: ['recording', 'text'],
    timePreset: 'last7Days',
    tagId: 2,
  })

  assert.deepEqual(summary, {
    hasFilters: true,
    search: 'sync',
    typeCount: 2,
    timePreset: 'last7Days',
    hasTag: true,
  })
})
