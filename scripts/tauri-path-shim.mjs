import path from 'node:path'

export function join(...segments) {
  return path.join(...segments)
}

export function dirname(filePath) {
  return path.dirname(filePath)
}

export function basename(filePath) {
  return path.basename(filePath)
}
