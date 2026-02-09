// 同步排除配置

// ==================== 文件同步排除规则 ====================

export interface SyncExcludePattern {
  pattern: string
  description: string
}

// 默认排除规则
export const DEFAULT_SYNC_EXCLUDE_PATTERNS: SyncExcludePattern[] = [
  { pattern: '.notegen/', description: '应用配置目录' },
  { pattern: '*.tmp', description: '临时文件' },
  { pattern: '*.bak', description: '备份文件' },
  { pattern: '*.swp', description: '编辑器临时文件' },
  { pattern: 'Thumbs.db', description: 'Windows 缩略图' },
  { pattern: '.DS_Store', description: 'macOS 系统文件' },
  { pattern: '*.lock', description: '锁定文件' },
]

// 检查路径是否应该排除在同步之外
export function shouldExclude(path: string): boolean {
  const excludePatterns = getExcludePatterns()

  for (const pattern of excludePatterns) {
    if (matchPattern(pattern, path)) {
      return true
    }
  }

  return false
}

// 通配符匹配
function matchPattern(pattern: string, path: string): boolean {
  // 目录模式（以 / 结尾）
  if (pattern.endsWith('/')) {
    return path.startsWith(pattern)
  }

  // 文件名模式
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1) // *.tmp -> .tmp
    return path.endsWith(ext) || path.includes(`.tmp${ext}`) // 处理 .tmp.txt 的情况
  }

  // 简单字符串匹配
  return path === pattern || path.includes(pattern)
}

// 获取排除模式（从配置读取或使用默认值）
export function getExcludePatterns(): string[] {
  // TODO: 从配置读取用户自定义的排除规则
  return DEFAULT_SYNC_EXCLUDE_PATTERNS.map(p => p.pattern)
}

// ==================== 设置同步排除规则 ====================

export const SYNC_EXCLUDED_FIELDS: string[] = [
  'workspacePath',
  'workspaceHistory',
  'assetsPath',
  'uiScale',
  'contentTextScale',
  'customCss',
]

// 检查字段是否应该被排除在同步之外
export function shouldExcludeFromSync(fieldName: string): boolean {
  return SYNC_EXCLUDED_FIELDS.includes(fieldName)
}

// 从对象中过滤掉不应该同步的字段
export function filterSyncData<T extends Record<string, any>>(data: T): Partial<T> {
  const filtered: Partial<T> = {}
  
  for (const key in data) {
    if (!shouldExcludeFromSync(key)) {
      filtered[key] = data[key]
    }
  }
  
  return filtered
}

// 合并下载的配置数据，保留本地的排除字段
export function mergeSyncData<T extends Record<string, any>>(
  localData: T,
  remoteData: Partial<T>
): T {
  const merged = { ...remoteData } as T
  
  // 保留本地的排除字段
  for (const field of SYNC_EXCLUDED_FIELDS) {
    if (field in localData) {
      merged[field as keyof T] = localData[field as keyof T]
    }
  }
  
  return merged
}
