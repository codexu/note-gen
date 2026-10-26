function belongsToDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function decodeBingTarget(value: string) {
  if (!value.startsWith('a1')) return value

  const encoded = value.slice(2).replace(/-/g, '+').replace(/_/g, '/')
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Resolve search redirects before comparing or presenting source URLs. */
export function normalizeWebSearchSourceUrl(value: string): string {
  try {
    let url = new URL(value.trim())

    // Bound nested redirects without making any network requests.
    for (let depth = 0; depth < 5; depth += 1) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''

      if (belongsToDomain(url.hostname, 'bing.com') && /^\/ck\/a\/?$/i.test(url.pathname)) {
        const target = url.searchParams.get('u')
        if (!target) return ''
        url = new URL(decodeBingTarget(target))
        continue
      }

      if (belongsToDomain(url.hostname, 'duckduckgo.com')) {
        const target = url.searchParams.get('uddg')
        if (target !== null) {
          if (!target) return ''
          url = new URL(target)
          continue
        }
      }

      url.hash = ''
      for (const key of Array.from(url.searchParams.keys())) {
        if (/^utm_|^(?:gclid|fbclid|msclkid)$/i.test(key)) {
          url.searchParams.delete(key)
        }
      }
      url.searchParams.sort()
      return url.href
    }
  } catch {
    return ''
  }

  return ''
}
