export function resolveSpeechRequestTarget(config, endpoint, defaultPath) {
  let explicitUrl = endpoint?.trim()
  if (!explicitUrl) {
    try {
      const url = new URL(config.baseUrl)
      if (url.pathname.replace(/\/+$/, '').endsWith(defaultPath)) explicitUrl = config.baseUrl
    } catch {
      // Keep the existing base URL validation for ordinary provider requests.
    }
  }
  if (!explicitUrl) return { config, path: defaultPath }

  let url
  try {
    url = new URL(explicitUrl)
  } catch {
    throw new Error('Speech endpoint must be a valid HTTP or HTTPS URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Speech endpoint must use HTTP or HTTPS without credentials or a fragment')
  }

  if (url.pathname.startsWith('//')) {
    throw new Error('Speech endpoint paths with multiple leading slashes are not supported')
  }

  return {
    config: { ...config, baseUrl: url.origin },
    path: url.pathname + url.search,
  }
}
