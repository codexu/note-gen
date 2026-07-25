import path from 'node:path'
import fsPromises from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@tauri-apps/plugin-fs') {
    return {
      url: pathToFileURL(path.join(scriptsDir, 'tauri-fs-shim.mjs')).href,
      shortCircuit: true,
    }
  }

  if (specifier === '@tauri-apps/api/path') {
    return {
      url: pathToFileURL(path.join(scriptsDir, 'tauri-path-shim.mjs')).href,
      shortCircuit: true,
    }
  }

  if (specifier.startsWith('@/')) {
    const relativePath = specifier.slice(2)
    const extension = relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')
      ? ''
      : '.ts'
    return {
      url: pathToFileURL(path.join(projectRoot, 'src', `${relativePath}${extension}`)).href,
      shortCircuit: true,
    }
  }

  if (specifier.startsWith('.')) {
    const parentUrl = context.parentURL ?? import.meta.url
    const parentPath = fileURLToPath(parentUrl)
    const resolved = path.resolve(path.dirname(parentPath), specifier)
    const candidates = [
      resolved,
      `${resolved}.ts`,
      `${resolved}.tsx`,
      path.join(resolved, 'index.ts'),
    ]
    for (const candidate of candidates) {
      try {
        await fsPromises.access(candidate)
        return {
          url: pathToFileURL(candidate).href,
          shortCircuit: true,
        }
      } catch {
        // try next candidate
      }
    }
  }

  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (
      typeof specifier === 'string'
      && !specifier.endsWith('.ts')
      && !specifier.endsWith('.tsx')
      && !specifier.endsWith('.js')
      && !specifier.endsWith('.mjs')
    ) {
      for (const extension of ['.ts', '.tsx', '/index.ts']) {
        try {
          return await nextResolve(`${specifier}${extension}`, context)
        } catch {
          // try next extension
        }
      }
    }
    throw error
  }
}
