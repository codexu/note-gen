/**
 * 替换指定行范围的内容
 * 用于在确认对话框中预览修改效果
 */
export function replaceLinesInRange(
  content: string,
  startLine: number,
  endLine: number,
  newLines: string[]
): string {
  const lines = content.split('\n')

  // 容错处理：如果 startLine > endLine，自动交换
  let actualStartLine = startLine
  let actualEndLine = endLine
  if (startLine > endLine) {
    actualStartLine = endLine
    actualEndLine = startLine
  }

  // 将行号转换为数组索引（从 0 开始）
  const startIndex = actualStartLine - 1
  const endIndex = actualEndLine - 1

  // 验证行号范围
  if (startIndex < 0 || startIndex >= lines.length) {
    throw new Error(`无效的行号范围: ${startLine}-${endLine}，文件共 ${lines.length} 行`)
  }

  // Clamp endIndex to the last line to handle minor line-count discrepancies
  // caused by content normalization (e.g. trailing newline stripping) between
  // get_editor_content and the actual replacement call.
  const clampedEndIndex = Math.min(endIndex, lines.length - 1)

  // 替换指定行
  const before = lines.slice(0, startIndex)
  const after = lines.slice(clampedEndIndex + 1)
  return [...before, ...newLines, ...after].join('\n')
}

/**
 * 搜索并替换内容（支持正则表达式）
 * 用于在确认对话框中预览修改效果
 */
export function searchReplaceContent(
  content: string,
  searchPattern: string,
  replacement: string,
  useRegex: boolean,
  caseSensitive: boolean,
  replaceAll: boolean
): string {
  try {
    let pattern = searchPattern
    const flags = caseSensitive ? 'g' : 'gi'

    if (!useRegex) {
      // 非正则模式，转义特殊字符
      pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    const regex = new RegExp(pattern, replaceAll ? flags : flags.replace('g', ''))

    return content.replace(regex, replacement)
  } catch (error) {
    throw new Error(`搜索替换失败: ${error}`)
  }
}

/**
 * 在指定行号后插入内容
 * 用于在确认对话框中预览修改效果
 */
export function insertLinesAtPosition(
  content: string,
  afterLine: number,
  newLines: string[]
): string {
  const lines = content.split('\n')

  // 验证行号
  if (afterLine < 0 || afterLine > lines.length) {
    throw new Error(`无效的行号: ${afterLine}，文件共 ${lines.length} 行`)
  }

  // 在指定行后插入内容
  const before = lines.slice(0, afterLine)
  const after = lines.slice(afterLine)

  return [...before, ...newLines, ...after].join('\n')
}

/**
 * 删除指定行范围
 * 用于在确认对话框中预览修改效果
 */
export function deleteLinesInRange(
  content: string,
  startLine: number,
  endLine: number
): string {
  const lines = content.split('\n')

  // 容错处理：如果 startLine > endLine，自动交换
  let actualStartLine = startLine
  let actualEndLine = endLine
  if (startLine > endLine) {
    actualStartLine = endLine
    actualEndLine = startLine
  }

  // 将行号转换为数组索引（从 0 开始）
  const startIndex = actualStartLine - 1
  const endIndex = actualEndLine - 1

  // 验证行号范围
  if (startIndex < 0 || startIndex >= lines.length) {
    throw new Error(`无效的行号范围: ${startLine}-${endLine}，文件共 ${lines.length} 行`)
  }

  // Clamp endIndex to the last line to handle minor line-count discrepancies.
  const clampedEndIndex = Math.min(endIndex, lines.length - 1)

  // 删除指定行
  const before = lines.slice(0, startIndex)
  const after = lines.slice(clampedEndIndex + 1)

  return [...before, ...after].join('\n')
}
