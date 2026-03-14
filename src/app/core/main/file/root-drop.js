export function sanitizeDroppedFileName(fileName) {
  return fileName.replace(/\s+/g, '_')
}

export async function writeDroppedFileToRoot(deps, payload) {
  const sanitizedFileName = sanitizeDroppedFileName(deps.fileName)
  const pathOptions = await deps.getFilePathOptions(sanitizedFileName)

  if (payload.kind === 'text') {
    await deps.writeTextFile?.(pathOptions.path, payload.content, pathOptions.baseDir ? { baseDir: pathOptions.baseDir } : undefined)
  } else {
    await deps.writeFile?.(pathOptions.path, payload.content, pathOptions.baseDir ? { baseDir: pathOptions.baseDir } : undefined)
  }

  return sanitizedFileName
}
