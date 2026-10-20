const ARRAY_COLUMN_SPEC_PATTERN = /\\begin\{array\}\{((?:[^{}]|\{[^{}]*\})*)\}/g
const REPEATED_COLUMN_PATTERN = /\*\{(\d+)\}\{([^{}]+)\}/g
const MAX_REPEATED_COLUMNS = 80

function expandRepeatedArrayColumns(columnSpec: string) {
  return columnSpec.replace(REPEATED_COLUMN_PATTERN, (_match, countValue: string, columnValue: string) => {
    const count = Number.parseInt(countValue, 10)

    if (!Number.isFinite(count) || count <= 0) {
      return ''
    }

    return columnValue.repeat(Math.min(count, MAX_REPEATED_COLUMNS))
  })
}

export function normalizeLatexForKatex(latex: string) {
  return latex.replace(ARRAY_COLUMN_SPEC_PATTERN, (_match, columnSpec: string) => {
    return `\\begin{array}{${expandRepeatedArrayColumns(columnSpec)}}`
  })
}
