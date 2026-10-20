export function getResultIndexToFocus(
  results: Array<{ from: number; to: number }>,
  requestedIndex = 0
): number {
  if (results.length === 0) {
    return -1
  }

  if (requestedIndex < 0) {
    return 0
  }

  if (requestedIndex >= results.length) {
    return results.length - 1
  }

  return requestedIndex
}
