export function preserveFileNameInputValue(value) {
  return value
}

export function sanitizeFileNameOnCommit(value) {
  return value.replace(/\s+/g, '_')
}
