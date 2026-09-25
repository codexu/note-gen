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

export interface SyncExclusionOptions {
  excludeSensitiveConfig?: boolean
}

export const ALWAYS_SYNC_EXCLUDED_FIELDS: string[] = [
  // 运行时、设备和页面会话状态
  'activeFilePath',
  'activeTabId',
  'collapsibleList',
  'currentPage',
  'fileTreeScrollTop',
  'lastSettingPage',
  'openTabs',
  'analyticsInstallId',
  'analyticsLastActiveDate',
  'analyticsSeenVersions',
  'desktopOnboardingProgress',
  'lastVectorProcessTime',
  'ragIndexNeedsRebuild',
  'learnedContextWindows',

  // 可重新生成或重新获取的本地缓存
  'githubReleasesCache',
  'noteGenDefaultModelsCache',
  'providerTemplatesCache',
  'remoteSkills.searchCache',
  'lastDownloadedRagSnapshot',
  'recordFilterTags',

  // 文件、画布和应用数据同步的本地进度
  'canvasSyncVersions',
  'conversationSyncVersions',
  'conversationSyncInitialized',
  'memorySyncInitialized',
  'autoDataSyncEnabled',
  'autoRecordSyncEnabled',
  'autoSettingsSyncEnabled',
  'autoConversationSyncEnabled',
  'autoVectorEnabled',
  'closeBehavior',
  'autostartMinimized',
  // 开发者能力只控制当前设备，不能由其他设备远程开启。
  'developerMode',
  'developerPerformanceInfo',
  'excludeSensitiveConfig',
  'syncedFileShas',
  'lastSyncTimes',
  'lastRestoreTimes',
  'fileLocks',
  'syncQueue',
  'lastAppliedRemoteRev',
  'deviceId',
  'selfHostedDeviceId',
  'autoDataSyncDirtyDomains',
  'autoDataSyncLastLocalUploadMetaUpdatedAtMs',
  'autoDataSyncLastAppliedRemoteMetaUpdatedAtMs',
  'autoDataSyncLastLocalUploadMeta',
  'autoDataSyncLastAppliedRemoteMeta',
  'autoDataSyncRecordSnapshots',
  'autoDataSyncBaselineFingerprints',
  'autoDataSyncMemorySettingsMigrated',
  // Development builds may have written this local-only diagnostic key.
  'autoConversationSyncDiagnostic',
  'lastRecordTagId',
  // 云盘文件夹备份由各设备独立配置，不能覆盖另一台设备的本地路径和执行状态。
  'managedBackupDirectory',
  'managedBackupSchedule',
  'managedBackupRetention',
  'managedBackupLastSuccessAt',
  'managedBackupLastError',
  'cloudFolderSyncConfig',
  'oneDriveAuthTokens',
  'iosWorkspaceFolderAccess',
  // 工作区和资源目录是设备本地状态，任何隐私设置下都不能跨设备覆盖。
  'workspacePath',
  'workspaceHistory',
  'assetsPath',
  'workspaceSyncRepos',
  'githubCustomSyncRepo',
  'giteeCustomSyncRepo',
  'gitlabCustomSyncRepo',
  'giteaCustomSyncRepo',
]

export const SENSITIVE_SYNC_EXCLUDED_FIELDS: string[] = [
  'appFontFamily',
  'uiScale',
  'contentTextScale',
  'customCss',
  'primaryBackupMethod',
  'aiModelList',
  's3SyncConfig',
  'webdavSyncConfig',
  'imageHostingConfig',
  'useImageRepo',
  'mainImageHosting',
  's3Config',
  'smms',
  'picgo',
  'lskyImageConfig',
  'webdavImageConfig',
  'customHttpImageConfig',
  'cloudinaryImageConfig',
  'imageKitImageConfig',
  'qiniuImageConfig',
  'upyunImageConfig',
  'mcpServers',
]

export const SYNC_EXCLUDED_FIELDS: string[] = [
  ...ALWAYS_SYNC_EXCLUDED_FIELDS,
  ...SENSITIVE_SYNC_EXCLUDED_FIELDS,
]

const SENSITIVE_SYNC_FIELD_PATTERNS = [
  'apikey',
  'accesskey',
  'accesskeyid',
  'accesstoken',
  'password',
  'secret',
  'token',
  'credential',
]

// 检查字段是否应该被排除在同步之外
export function shouldExcludeFromSync(fieldName: string, options: SyncExclusionOptions = {}): boolean {
  const normalizedFieldName = fieldName.toLowerCase()
  const excludeSensitiveConfig = options.excludeSensitiveConfig !== false

  if (ALWAYS_SYNC_EXCLUDED_FIELDS.some(field => fieldName === field || fieldName.startsWith(`${field}:`))) {
    return true
  }

  if (!excludeSensitiveConfig) {
    return false
  }

  return (
    SENSITIVE_SYNC_EXCLUDED_FIELDS.includes(fieldName) ||
    SENSITIVE_SYNC_FIELD_PATTERNS.some((pattern) => normalizedFieldName.includes(pattern))
  )
}

// 从对象中过滤掉不应该同步的字段
export function filterSyncData<T extends Record<string, unknown>>(
  data: T,
  options: SyncExclusionOptions = {}
): Partial<T> {
  const filtered: Partial<T> = {}
  
  for (const key in data) {
    if (!shouldExcludeFromSync(key, options)) {
      filtered[key] = data[key]
    }
  }
  
  return filtered
}

// 合并下载的配置数据，保留本地的排除字段
export function mergeSyncData<T extends Record<string, unknown>>(
  localData: T,
  remoteData: Partial<T>,
  options: SyncExclusionOptions = {}
): T {
  const merged = { ...localData } as T
  
  for (const [key, value] of Object.entries(remoteData)) {
    if (!shouldExcludeFromSync(key, options)) {
      merged[key as keyof T] = value as T[keyof T]
    }
  }
  
  return merged
}
