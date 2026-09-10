#!/usr/bin/env bash

set -euo pipefail

node <<'NODE'
const { readFileSync } = require('node:fs')

const path = 'src-tauri/plugin-market-public-key.txt'
const value = readFileSync(path, 'utf8').trim()
if (!value || value.includes('#') || value.includes('\n') || value.includes('\r')) {
  throw new Error(`${path} must contain only the production Ed25519 public key in Base64`)
}
const decoded = Buffer.from(value, 'base64')
if (decoded.length !== 32 || decoded.toString('base64') !== value) {
  throw new Error(`${path} must be canonical Base64 encoding of exactly 32 bytes`)
}
console.log('Plugin marketplace root public key is valid.')
NODE
