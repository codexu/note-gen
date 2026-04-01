function normalizePathSegments(path: string): string[] {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')

  if (!normalized) {
    return []
  }

  const segments: string[] = []

  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') {
      continue
    }

    if (segment === '..') {
      if (segments.length > 0) {
        segments.pop()
      }
      continue
    }

    segments.push(segment)
  }

  return segments
}

function getMarkdownDirSegments(markdownPath: string): string[] {
  const segments = normalizePathSegments(markdownPath)
  return segments.slice(0, -1)
}

export function resolveImagePathFromMarkdown(markdownPath: string, imagePath: string): string {
  const markdownDirSegments = getMarkdownDirSegments(markdownPath)
  const imageSegments = imagePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .split('/')
    .filter(Boolean)

  const resolvedSegments = [...markdownDirSegments]

  for (const segment of imageSegments) {
    if (segment === '.') {
      continue
    }

    if (segment === '..') {
      if (resolvedSegments.length > 0) {
        resolvedSegments.pop()
      }
      continue
    }

    resolvedSegments.push(segment)
  }

  return resolvedSegments.join('/')
}

export function toMarkdownImagePath(markdownPath: string, workspaceImagePath: string): string {
  const markdownDirSegments = getMarkdownDirSegments(markdownPath)
  const imageSegments = normalizePathSegments(workspaceImagePath)

  let commonPrefixLength = 0
  while (
    commonPrefixLength < markdownDirSegments.length &&
    commonPrefixLength < imageSegments.length &&
    markdownDirSegments[commonPrefixLength] === imageSegments[commonPrefixLength]
  ) {
    commonPrefixLength++
  }

  const upwardSegments = new Array(markdownDirSegments.length - commonPrefixLength).fill('..')
  const downwardSegments = imageSegments.slice(commonPrefixLength)

  return [...upwardSegments, ...downwardSegments].join('/') || '.'
}
