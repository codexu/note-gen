export interface LineDiff {
  type: 'equal' | 'remove' | 'add'
  text: string
  oldLine?: number
  newLine?: number
  lineEnding?: 'lf' | 'crlf' | 'none'
}

interface TokenDiff {
  type: LineDiff['type']
  value: string
}

// Retain line endings so the same comparison can drive both display and edits.
function tokenize(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function compareLines(before: string, after: string): TokenDiff[] {
  const oldLines = tokenize(before)
  const newLines = tokenize(after)
  const result: TokenDiff[] = []
  const emit = (type: TokenDiff['type'], values: string[], from: number, to: number) => {
    for (let index = from; index < to; index++) result.push({ type, value: values[index] })
  }

  const compare = (a: number, endA: number, b: number, endB: number, depth = 0) => {
    while (a < endA && b < endB && oldLines[a] === newLines[b]) {
      result.push({ type: 'equal', value: oldLines[a++] })
      b++
    }
    let suffix = 0
    while (a < endA - suffix && b < endB - suffix
      && oldLines[endA - suffix - 1] === newLines[endB - suffix - 1]) suffix++
    const tailA = endA - suffix
    const tailB = endB - suffix
    if (a === tailA || b === tailB) {
      emit('remove', oldLines, a, tailA)
      emit('add', newLines, b, tailB)
    } else {
      // Patience anchors keep distant edits separate without a document-sized
      // quadratic matrix. Repeated lines in the gaps use a bounded LCS.
      const oldPositions = new Map<string, number>()
      const newPositions = new Map<string, number>()
      for (let i = a; i < tailA; i++) oldPositions.set(oldLines[i], oldPositions.has(oldLines[i]) ? -1 : i)
      for (let i = b; i < tailB; i++) newPositions.set(newLines[i], newPositions.has(newLines[i]) ? -1 : i)
      const pairs: { old: number; next: number }[] = []
      for (let i = a; i < tailA; i++) {
        const next = newPositions.get(oldLines[i])
        if (oldPositions.get(oldLines[i]) === i && next !== undefined && next >= 0) pairs.push({ old: i, next })
      }
      const tails: number[] = []
      const previous = new Int32Array(pairs.length).fill(-1)
      pairs.forEach((pair, index) => {
        let low = 0
        let high = tails.length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (pairs[tails[middle]].next < pair.next) low = middle + 1
          else high = middle
        }
        if (low > 0) previous[index] = tails[low - 1]
        tails[low] = index
      })
      const anchors: typeof pairs = []
      for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) anchors.push(pairs[index])
      anchors.reverse()
      if (anchors.length && depth < 64) {
        for (const anchor of anchors) {
          compare(a, anchor.old, b, anchor.next, depth + 1)
          result.push({ type: 'equal', value: oldLines[anchor.old] })
          a = anchor.old + 1
          b = anchor.next + 1
        }
        compare(a, tailA, b, tailB, depth + 1)
      } else if ((tailA - a + 1) * (tailB - b + 1) <= 250_000) {
        const width = tailB - b + 1
        const matrix = new Uint32Array((tailA - a + 1) * width)
        for (let i = tailA - 1; i >= a; i--) {
          for (let j = tailB - 1; j >= b; j--) {
            const offset = (i - a) * width + j - b
            matrix[offset] = oldLines[i] === newLines[j]
              ? matrix[offset + width + 1] + 1
              : Math.max(matrix[offset + width], matrix[offset + 1])
          }
        }
        const startA = a
        const startB = b
        while (a < tailA && b < tailB) {
          if (oldLines[a] === newLines[b]) {
            result.push({ type: 'equal', value: oldLines[a++] })
            b++
          } else {
            const offset = (a - startA) * width + b - startB
            if (matrix[offset + width] >= matrix[offset + 1]) result.push({ type: 'remove', value: oldLines[a++] })
            else result.push({ type: 'add', value: newLines[b++] })
          }
        }
        emit('remove', oldLines, a, tailA)
        emit('add', newLines, b, tailB)
      } else {
        // Large, repetitive documents: use monotonic matching rather than
        // deleting unchanged content wholesale or freezing the UI with LCS.
        const positions = new Map<string, number[]>()
        for (let j = b; j < tailB; j++) {
          const list = positions.get(newLines[j]) ?? []
          list.push(j)
          positions.set(newLines[j], list)
        }
        for (let i = a; i < tailA; i++) {
          const list = positions.get(oldLines[i]) ?? []
          let low = 0
          let high = list.length
          while (low < high) {
            const middle = (low + high) >>> 1
            if (list[middle] < b) low = middle + 1
            else high = middle
          }
          const match = list[low]
          if (match === undefined) result.push({ type: 'remove', value: oldLines[i] })
          else {
            emit('add', newLines, b, match)
            result.push({ type: 'equal', value: oldLines[i] })
            b = match + 1
          }
        }
        emit('add', newLines, b, tailB)
      }
    }
    emit('equal', oldLines, tailA, endA)
  }
  compare(0, oldLines.length, 0, newLines.length)
  return result
}

export function buildLineDiff(before: string, after: string): LineDiff[] {
  let oldLine = 1
  let newLine = 1
  return compareLines(before, after).map(({ type, value }) => ({
    type,
    text: value.replace(/\r?\n$/, ''),
    lineEnding: value.endsWith('\r\n') ? 'crlf' as const : value.endsWith('\n') ? 'lf' as const : 'none' as const,
    oldLine: type === 'add' ? undefined : oldLine++,
    newLine: type === 'remove' ? undefined : newLine++,
  }))
}

/** Ordered, non-overlapping edits with coordinates in the original string. */
export function buildTextEdits(before: string, after: string): { from: number; to: number; text: string }[] {
  const edits: { from: number; to: number; text: string }[] = []
  let offset = 0
  let removed = ''
  let inserted = ''
  const flush = () => {
    if (!removed && !inserted) return
    let start = 0
    while (start < removed.length && start < inserted.length && removed[start] === inserted[start]) start++
    let oldEnd = removed.length
    let newEnd = inserted.length
    while (oldEnd > start && newEnd > start && removed[oldEnd - 1] === inserted[newEnd - 1]) {
      oldEnd--
      newEnd--
    }
    if (oldEnd !== start || newEnd !== start) edits.push({ from: offset + start, to: offset + oldEnd, text: inserted.slice(start, newEnd) })
    offset += removed.length
    removed = ''
    inserted = ''
  }
  for (const token of compareLines(before, after)) {
    if (token.type === 'equal') {
      flush()
      offset += token.value.length
    } else if (token.type === 'remove') removed += token.value
    else inserted += token.value
  }
  flush()
  return edits
}
