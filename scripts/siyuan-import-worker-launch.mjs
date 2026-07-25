import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
register(pathToFileURL(path.join(scriptsDir, 'tauri-import-hooks.mjs')))

await import(pathToFileURL(path.join(scriptsDir, 'siyuan-import-worker.mjs')).href)
