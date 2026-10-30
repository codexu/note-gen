function sourceDataUrl(source, mimeType) {
  const bytes = new TextEncoder().encode(source)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

export function customizeHtmlExport(html, config) {
  let result = html
  if (config.css?.trim()) {
    const url = sourceDataUrl(config.css, 'text/css')
    result = result.replace('</head>', `<link rel="stylesheet" href="${url}">\n</head>`)
  }
  if (config.javascript?.trim()) {
    const url = sourceDataUrl(config.javascript, 'text/javascript')
    result = result.replace('</body>', `<script src="${url}"></script>\n</body>`)
  }
  return result
}
