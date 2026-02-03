/**
 * 附件服务
 * 处理文件读取、格式化和上下文注入
 */

import {
  useTavernAttachmentsStore,
  Attachment,
  AttachmentType,
  getAttachmentType,
} from '@/stores/tavern-attachments'

// 从文件创建附件
export async function createAttachmentFromFile(file: File): Promise<Attachment | null> {
  const { config } = useTavernAttachmentsStore.getState()
  
  // 检查文件大小
  if (file.size > config.maxFileSize) {
    throw new Error(`文件大小超过限制 (最大 ${formatFileSize(config.maxFileSize)})`)
  }
  
  // 检查文件类型
  const isAllowed = config.allowedTypes.some(type => {
    if (type.endsWith('/*')) {
      return file.type.startsWith(type.slice(0, -1))
    }
    return file.type === type
  })
  
  if (!isAllowed && config.allowedTypes.length > 0) {
    throw new Error(`不支持的文件类型: ${file.type}`)
  }
  
  try {
    // 读取文件内容
    const content = await readFileAsText(file)
    
    return {
      id: '', // 会在 store 中生成
      name: file.name,
      type: getAttachmentType(file.type),
      mimeType: file.type || 'text/plain',
      size: file.size,
      content,
      createdAt: Date.now(),
      includeInContext: config.defaultIncludeInContext,
      contextTemplate: config.defaultContextTemplate,
      maxLength: config.defaultMaxLength,
    }
  } catch (error) {
    console.error('读取文件失败:', error)
    return null
  }
}

// 读取文件为文本
async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file)
  })
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 格式化附件为上下文
export function formatAttachmentForContext(attachment: Attachment): string {
  if (!attachment.includeInContext) return ''
  
  let content = attachment.content
  
  // 截断内容
  if (attachment.maxLength > 0 && content.length > attachment.maxLength) {
    content = content.slice(0, attachment.maxLength) + '\n... (内容已截断)'
  }
  
  // 应用模板
  return attachment.contextTemplate
    .replace('{{name}}', attachment.name)
    .replace('{{content}}', content)
    .replace('{{type}}', attachment.type)
    .replace('{{size}}', formatFileSize(attachment.size))
}

// 格式化多个附件为上下文
export function formatAttachmentsForContext(attachments: Attachment[]): string {
  const formatted = attachments
    .filter(a => a.includeInContext)
    .map(formatAttachmentForContext)
    .filter(Boolean)
  
  if (formatted.length === 0) return ''
  
  return formatted.join('\n\n')
}

// 获取附件类型图标
export function getAttachmentTypeIcon(type: AttachmentType): string {
  switch (type) {
    case 'text': return '📄'
    case 'code': return '💻'
    case 'document': return '📑'
    case 'data': return '📊'
    default: return '📎'
  }
}

// 获取附件类型名称
export function getAttachmentTypeName(type: AttachmentType): string {
  switch (type) {
    case 'text': return '文本'
    case 'code': return '代码'
    case 'document': return '文档'
    case 'data': return '数据'
    default: return '其他'
  }
}

// 获取文件扩展名
export function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : ''
}

// 根据扩展名获取语言
export function getLanguageFromExtension(ext: string): string {
  const langMap: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    json: 'json',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    sql: 'sql',
    sh: 'bash',
    bat: 'batch',
    ps1: 'powershell',
  }
  return langMap[ext] || 'text'
}

// 预览内容 (截取前 N 行)
export function getContentPreview(content: string, maxLines: number): string {
  const lines = content.split('\n')
  if (lines.length <= maxLines) return content
  return lines.slice(0, maxLines).join('\n') + `\n... (还有 ${lines.length - maxLines} 行)`
}

// 从剪贴板获取文本
export async function getTextFromClipboard(): Promise<string | null> {
  try {
    const text = await navigator.clipboard.readText()
    return text || null
  } catch (error) {
    console.error('读取剪贴板失败:', error)
    return null
  }
}

// 创建文本附件
export function createTextAttachment(
  name: string,
  content: string,
  type: AttachmentType = 'text'
): Omit<Attachment, 'id' | 'createdAt'> {
  const { config } = useTavernAttachmentsStore.getState()
  
  return {
    name,
    type,
    mimeType: 'text/plain',
    size: new Blob([content]).size,
    content,
    includeInContext: config.defaultIncludeInContext,
    contextTemplate: config.defaultContextTemplate,
    maxLength: config.defaultMaxLength,
  }
}

// ============ 数据银行增强功能 ============

/**
 * 计算数据银行存储统计
 */
export function getDataBankStats(): {
  totalEntries: number
  totalAttachments: number
  totalSize: number
  byType: Record<AttachmentType, number>
} {
  const { dataBank } = useTavernAttachmentsStore.getState()
  
  const byType: Record<AttachmentType, number> = {
    text: 0,
    code: 0,
    document: 0,
    data: 0,
    other: 0,
  }
  
  let totalAttachments = 0
  let totalSize = 0
  
  for (const entry of dataBank) {
    for (const attachment of entry.attachments) {
      totalAttachments++
      totalSize += attachment.size
      byType[attachment.type]++
    }
  }
  
  return {
    totalEntries: dataBank.length,
    totalAttachments,
    totalSize,
    byType,
  }
}

/**
 * 搜索数据银行条目
 */
export function searchDataBank(
  query: string,
  options?: {
    searchContent?: boolean
    type?: AttachmentType
    maxResults?: number
  }
): Array<{
  entry: import('@/stores/tavern-attachments').DataBankEntry
  matchedAttachments: Attachment[]
  score: number
}> {
  const { dataBank } = useTavernAttachmentsStore.getState()
  const { searchContent = false, type, maxResults = 20 } = options || {}
  
  const queryLower = query.toLowerCase()
  const results: Array<{
    entry: import('@/stores/tavern-attachments').DataBankEntry
    matchedAttachments: Attachment[]
    score: number
  }> = []
  
  for (const entry of dataBank) {
    let entryScore = 0
    const matchedAttachments: Attachment[] = []
    
    // 匹配条目名称
    if (entry.name.toLowerCase().includes(queryLower)) {
      entryScore += 10
    }
    
    // 匹配条目描述
    if (entry.description.toLowerCase().includes(queryLower)) {
      entryScore += 5
    }
    
    // 匹配附件
    for (const attachment of entry.attachments) {
      // 类型过滤
      if (type && attachment.type !== type) continue
      
      let attachmentScore = 0
      
      // 匹配文件名
      if (attachment.name.toLowerCase().includes(queryLower)) {
        attachmentScore += 8
      }
      
      // 匹配标签
      if (attachment.tags?.some(t => t.toLowerCase().includes(queryLower))) {
        attachmentScore += 6
      }
      
      // 匹配内容
      if (searchContent && attachment.content.toLowerCase().includes(queryLower)) {
        attachmentScore += 3
      }
      
      if (attachmentScore > 0) {
        matchedAttachments.push(attachment)
        entryScore += attachmentScore
      }
    }
    
    if (entryScore > 0) {
      results.push({ entry, matchedAttachments, score: entryScore })
    }
  }
  
  // 按分数排序
  results.sort((a, b) => b.score - a.score)
  
  return results.slice(0, maxResults)
}

/**
 * 导出数据银行条目为 JSON
 */
export function exportDataBankEntry(
  entryId: string
): string | null {
  const { getDataBankEntry } = useTavernAttachmentsStore.getState()
  const entry = getDataBankEntry(entryId)
  
  if (!entry) return null
  
  return JSON.stringify({
    version: 1,
    type: 'data-bank-entry',
    entry,
    exportedAt: Date.now(),
  }, null, 2)
}

/**
 * 导入数据银行条目
 */
export function importDataBankEntry(
  data: string
): { success: boolean; entryId?: string; error?: string } {
  try {
    const parsed = JSON.parse(data)
    
    if (parsed.type !== 'data-bank-entry' || !parsed.entry) {
      return { success: false, error: '无效的数据格式' }
    }
    
    const { addDataBankEntry } = useTavernAttachmentsStore.getState()
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...entryData } = parsed.entry
    
    const entryId = addDataBankEntry(entryData)
    return { success: true, entryId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '解析失败',
    }
  }
}

/**
 * 导出整个数据银行
 */
export function exportDataBank(): string {
  const { dataBank, config } = useTavernAttachmentsStore.getState()
  
  return JSON.stringify({
    version: 1,
    type: 'data-bank',
    config,
    entries: dataBank,
    exportedAt: Date.now(),
  }, null, 2)
}

/**
 * 导入整个数据银行
 */
export function importDataBank(
  data: string,
  options?: { merge?: boolean }
): { success: boolean; count: number; error?: string } {
  try {
    const parsed = JSON.parse(data)
    
    if (parsed.type !== 'data-bank' || !Array.isArray(parsed.entries)) {
      return { success: false, count: 0, error: '无效的数据格式' }
    }
    
    const { addDataBankEntry } = useTavernAttachmentsStore.getState()
    const { merge = true } = options || {}
    
    let count = 0
    for (const entry of parsed.entries) {
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...entryData } = entry
      addDataBankEntry(entryData)
      count++
    }
    
    return { success: true, count }
  } catch (error) {
    return {
      success: false,
      count: 0,
      error: error instanceof Error ? error.message : '解析失败',
    }
  }
}

/**
 * 从 URL 加载文件内容
 */
export async function fetchFileContent(
  url: string
): Promise<{ content: string; mimeType: string } | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    
    const mimeType = response.headers.get('content-type') || 'text/plain'
    const content = await response.text()
    
    return { content, mimeType }
  } catch (error) {
    console.error('获取文件失败:', error)
    return null
  }
}

/**
 * 从 URL 创建附件
 */
export async function createAttachmentFromURL(
  url: string,
  name?: string
): Promise<Omit<Attachment, 'id' | 'createdAt'> | null> {
  const result = await fetchFileContent(url)
  if (!result) return null
  
  const { content, mimeType } = result
  const fileName = name || url.split('/').pop() || 'file'
  
  const { config } = useTavernAttachmentsStore.getState()
  
  return {
    name: fileName,
    type: getAttachmentType(mimeType),
    mimeType,
    size: new Blob([content]).size,
    content,
    includeInContext: config.defaultIncludeInContext,
    contextTemplate: config.defaultContextTemplate,
    maxLength: config.defaultMaxLength,
  }
}

/**
 * 获取附件的 Token 估算
 */
export function estimateAttachmentTokens(
  attachment: Attachment,
  tokensPerChar: number = 0.25
): number {
  let content = attachment.content
  
  // 应用截断
  if (attachment.maxLength > 0 && content.length > attachment.maxLength) {
    content = content.slice(0, attachment.maxLength)
  }
  
  // 应用模板
  const formatted = attachment.contextTemplate
    .replace('{{name}}', attachment.name)
    .replace('{{content}}', content)
    .replace('{{type}}', attachment.type)
    .replace('{{size}}', formatFileSize(attachment.size))
  
  return Math.ceil(formatted.length * tokensPerChar)
}

/**
 * 获取所有待发送附件的总 Token 估算
 */
export function estimatePendingAttachmentsTokens(
  tokensPerChar: number = 0.25
): number {
  const { pendingAttachments } = useTavernAttachmentsStore.getState()
  
  return pendingAttachments
    .filter(a => a.includeInContext)
    .reduce((sum, a) => sum + estimateAttachmentTokens(a, tokensPerChar), 0)
}
