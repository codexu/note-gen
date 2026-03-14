export function getVectorDocumentKey(filePath) {
  return filePath.replace(/\\/g, '/').trim()
}

export function buildVectorIndexedMap(vectorDocuments) {
  const indexedMap = new Map()

  for (const doc of vectorDocuments) {
    const currentTimestamp = indexedMap.get(doc.filename)
    if (currentTimestamp === undefined || doc.updated_at > currentTimestamp) {
      indexedMap.set(doc.filename, doc.updated_at)
    }
  }

  return indexedMap
}
