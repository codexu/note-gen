import test from "node:test"
import assert from "node:assert/strict"
import { normalizeRecordViewMode } from "./mark-view-mode.mjs"

test("normalizes persisted record view mode", () => {
  assert.equal(normalizeRecordViewMode("list"), "list")
  assert.equal(normalizeRecordViewMode("compact"), "compact")
  assert.equal(normalizeRecordViewMode("cards"), "cards")
  assert.equal(normalizeRecordViewMode("table"), "list")
  assert.equal(normalizeRecordViewMode(undefined), "list")
})
