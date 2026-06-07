#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function countEvents(logs, type) {
  return logs.filter((log) => log?.type === type).length
}

function hasEvent(logs, type) {
  return logs.some((log) => log?.type === type)
}

function readFinalValues(payload) {
  return payload?.summary?.finalValues || {}
}

function summarizePayload(payload) {
  const logs = Array.isArray(payload?.logs) ? payload.logs : []
  return {
    label: payload?.metadata?.label || payload?.summary?.label || '',
    totalEvents: logs.length,
    focusEvents: countEvents(logs, 'focus'),
    beforeInputEvents: countEvents(logs, 'beforeinput'),
    inputEvents: countEvents(logs, 'input'),
    manualVoiceAttemptConfirmed: hasEvent(logs, 'manual-voice-attempt-confirmed'),
    finalValues: readFinalValues(payload),
  }
}

function computeVerdict(unpatched, patched) {
  if (unpatched.inputEvents === 0 && patched.inputEvents > 0) {
    return 'patched_only_input'
  }
  if (unpatched.inputEvents > 0 && patched.inputEvents > 0) {
    return 'both_have_input'
  }
  if (unpatched.inputEvents === 0 && patched.inputEvents === 0) {
    return 'neither_has_input'
  }
  return 'unpatched_only_input'
}

export function compareInputLogPayloads({ unpatched, patched }) {
  const unpatchedSummary = summarizePayload(unpatched)
  const patchedSummary = summarizePayload(patched)
  const isExperimentValid = unpatchedSummary.manualVoiceAttemptConfirmed
    && patchedSummary.manualVoiceAttemptConfirmed
  const verdict = isExperimentValid
    ? computeVerdict(unpatchedSummary, patchedSummary)
    : 'invalid_experiment'

  return {
    verdict,
    isExperimentValid,
    supportsWryKeyDownHypothesis: isExperimentValid && verdict === 'patched_only_input',
    unpatched: unpatchedSummary,
    patched: patchedSummary,
  }
}

function readPayload(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readArg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const unpatchedPath = readArg('--unpatched', 'tmp/doubao-unpatched-logs.json')
  const patchedPath = readArg('--patched', 'tmp/doubao-patched-logs.json')
  const result = compareInputLogPayloads({
    unpatched: readPayload(unpatchedPath),
    patched: readPayload(patchedPath),
  })
  console.log(JSON.stringify(result, null, 2))
}
