/**
 * 清理文件名，确保跨平台兼容性
 * Windows 不允许的字符: < > : " | ? * 
 * 同时处理其他可能的特殊字符
 */
export function sanitizeFileName(fileName: string): string {
  // Windows 不允许的字符
  const windowsInvalidChars = /[<>:"|?*]/g
  
  // 替换不允许的字符为下划线
  let sanitized = fileName.replace(windowsInvalidChars, '_')
  
  // 移除或替换其他可能有问题的字符
  sanitized = sanitized
    .replace(/\r\n/g, '_') // 换行符
    .replace(/\n/g, '_')    // 换行符
    .replace(/\r/g, '_')    // 回车符
    .replace(/\t/g, '_')    // 制表符
    .replace(/\0/g, '_')    // 空字符
    .replace(/[\u0000-\u001F]/g, '_') // 控制字符
    .trim() // 移除首尾空白
  
  // 确保文件名不以点开头（隐藏文件）
  if (sanitized.startsWith('.')) {
    sanitized = '_' + sanitized.slice(1)
  }
  
  // 确保文件名不为空
  if (!sanitized) {
    sanitized = 'untitled'
  }
  
  // 限制文件名长度（Windows 限制为 255 字符）
  const maxLength = 250 // 留一些余量
  if (sanitized.length > maxLength) {
    const extension = sanitized.includes('.') ? sanitized.split('.').pop() : ''
    const nameWithoutExt = sanitized.includes('.') ? 
      sanitized.slice(0, -(extension!.length + 1)) : sanitized
    
    const maxNameLength = maxLength - (extension ? extension.length + 1 : 0)
    const truncatedName = nameWithoutExt.slice(0, maxNameLength)
    
    sanitized = extension ? `${truncatedName}.${extension}` : truncatedName
  }
  
  return sanitized
}

/**
 * 清理完整路径中的所有文件名
 */
export function sanitizeFilePath(filePath: string): string {
  // 分割路径
  const parts = filePath.split('/')
  
  // 清理每个部分（除了可能的空字符串）
  const sanitizedParts = parts.map(part => {
    if (part === '') return part
    return sanitizeFileName(part)
  })
  
  return sanitizedParts.join('/')
}

/**
 * 检查文件名是否包含不允许的字符
 */
export function hasInvalidFileNameChars(fileName: string): boolean {
  const windowsInvalidChars = /[<>:"|?*]/
  return windowsInvalidChars.test(fileName) ||
         fileName.includes('\r') ||
         fileName.includes('\n') ||
         fileName.includes('\t') ||
         fileName.includes('\0')
}

/**
 * 获取文件名的安全版本，如果原文件名安全则返回原文件名
 */
export function getSafeFileName(originalFileName: string): string {
  if (!hasInvalidFileNameChars(originalFileName)) {
    return originalFileName
  }
  
  const safeFileName = sanitizeFileName(originalFileName)

  return safeFileName
}
