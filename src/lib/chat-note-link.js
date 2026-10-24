export function resolveChatNoteLink(href) {
  let path
  try {
    path = decodeURIComponent(href.split(/[?#]/, 1)[0]).replace(/\\/g, '/')
  } catch {
    return null
  }

  if (!path || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path) || /[\u0000-\u001f]/.test(path)) {
    return null
  }

  const segments = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }

  const relativePath = segments.join('/')
  return /\.(md|markdown)$/i.test(relativePath) ? relativePath : null
}
