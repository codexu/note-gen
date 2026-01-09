import { Store } from '@tauri-apps/plugin-store'
import { confirm } from '@tauri-apps/plugin-dialog'

export interface ConflictResolution {
  action: 'keep_local' | 'keep_remote' | 'merge' | 'manual'
  reason?: string
}

export interface SyncLock {
  filePath: string
  deviceId: string
  timestamp: number
  userName: string
}

/**
 * 获取设备唯一标识
 */
export async function getDeviceId(): Promise<string> {
  const store = await Store.load('store.json')
  let deviceId = await store.get<string>('deviceId')
  
  if (!deviceId) {
    // 生成设备唯一标识
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    await store.set('deviceId', deviceId)
    await store.save()
  }
  
  return deviceId
}

/**
 * 获取用户名
 */
export async function getUserName(): Promise<string> {
  const store = await Store.load('store.json')
  return await store.get<string>('username') || 'Unknown User'
}

/**
 * 检查文件是否被其他设备锁定
 */
export async function checkFileLock(filePath: string): Promise<SyncLock | null> {
  const store = await Store.load('store.json')
  const locks = await store.get<Record<string, SyncLock>>('fileLocks') || {}
  
  const lock = locks[filePath]
  if (!lock) {
    return null
  }
  
  // 检查锁是否过期（5分钟）
  const now = Date.now()
  if (now - lock.timestamp > 5 * 60 * 1000) {
    // 锁已过期，清除
    delete locks[filePath]
    await store.set('fileLocks', locks)
    await store.save()
    return null
  }
  
  // 如果是当前设备的锁，忽略
  const currentDeviceId = await getDeviceId()
  if (lock.deviceId === currentDeviceId) {
    return null
  }
  
  return lock
}

/**
 * 获取文件锁
 */
export async function acquireFileLock(filePath: string): Promise<boolean> {
  const store = await Store.load('store.json')
  const locks = await store.get<Record<string, SyncLock>>('fileLocks') || {}
  
  // 检查是否已被其他设备锁定
  const existingLock = locks[filePath]
  if (existingLock) {
    const currentDeviceId = await getDeviceId()
    if (existingLock.deviceId !== currentDeviceId) {
      // 检查锁是否过期
      const now = Date.now()
      if (now - existingLock.timestamp <= 5 * 60 * 1000) {
        return false // 锁仍然有效
      }
    }
  }
  
  // 获取锁
  const deviceId = await getDeviceId()
  const userName = await getUserName()
  
  locks[filePath] = {
    filePath,
    deviceId,
    timestamp: Date.now(),
    userName
  }
  
  await store.set('fileLocks', locks)
  await store.save()
  
  return true
}

/**
 * 释放文件锁
 */
export async function releaseFileLock(filePath: string): Promise<void> {
  const store = await Store.load('store.json')
  const locks = await store.get<Record<string, SyncLock>>('fileLocks') || {}
  
  const currentDeviceId = await getDeviceId()
  const lock = locks[filePath]
  
  if (lock && lock.deviceId === currentDeviceId) {
    delete locks[filePath]
    await store.set('fileLocks', locks)
    await store.save()
  }
}

/**
 * 检测和处理冲突
 */
export async function detectAndHandleConflict(
  filePath: string,
  localContent: string,
  remoteContent: string
): Promise<ConflictResolution> {
  // 如果内容相同，不是冲突
  if (localContent === remoteContent) {
    return { action: 'keep_local', reason: '内容相同，无需处理' }
  }
  
  // 分析冲突类型
  const conflictType = analyzeConflictType(localContent, remoteContent)
  
  switch (conflictType) {
    case 'simple_addition':
      // 简单的内容追加，可以自动合并
      return { action: 'merge', reason: '检测到简单的内容追加，可以自动合并' }
      
    case 'significant_change':
      // 显著内容变化，需要用户选择
      return await promptUserForResolution(filePath, localContent, remoteContent)
      
    case 'format_only':
      // 仅格式变化，保留远程版本
      return { action: 'keep_remote', reason: '检测到格式变化，使用远程版本' }
      
    default:
      return await promptUserForResolution(filePath, localContent, remoteContent)
  }
}

/**
 * 分析冲突类型
 */
function analyzeConflictType(localContent: string, remoteContent: string): 'simple_addition' | 'significant_change' | 'format_only' {
  const localLines = localContent.split('\n')
  const remoteLines = remoteContent.split('\n')
  
  // 检查是否只是简单的追加
  if (localLines.length < remoteLines.length) {
    const localPrefix = remoteLines.slice(0, localLines.length).join('\n')
    if (localContent === localPrefix) {
      return 'simple_addition'
    }
  }
  
  // 检查是否只是格式变化（去除空白字符后内容相同）
  const normalizedLocal = localContent.replace(/\s+/g, ' ').trim()
  const normalizedRemote = remoteContent.replace(/\s+/g, ' ').trim()
  
  if (normalizedLocal === normalizedRemote) {
    return 'format_only'
  }
  
  return 'significant_change'
}

/**
 * 提示用户选择冲突解决方案
 */
async function promptUserForResolution(
  filePath: string,
  localContent: string,
  remoteContent: string
): Promise<ConflictResolution> {
  const choice = await confirm(
    `文件 ${filePath} 存在冲突\n\n` +
    `本地版本：${localContent.length} 字符\n` +
    `远程版本：${remoteContent.length} 字符\n\n` +
    `请选择如何处理：\n` +
    `• 确定：保留本地版本\n` +
    `• 取消：保留远程版本`,
    { 
      title: '同步冲突',
      okLabel: '保留本地',
      cancelLabel: '保留远程'
    }
  )
  
  return {
    action: choice ? 'keep_local' : 'keep_remote',
    reason: choice ? '用户选择保留本地版本' : '用户选择保留远程版本'
  }
}

/**
 * 智能合并简单冲突
 */
export function mergeSimpleContent(localContent: string, remoteContent: string): string {
  const localLines = localContent.split('\n')
  const remoteLines = remoteContent.split('\n')
  
  // 如果远程内容包含本地内容，直接返回远程内容
  if (remoteLines.length >= localLines.length) {
    const localPrefix = remoteLines.slice(0, localLines.length).join('\n')
    if (localContent === localPrefix) {
      return remoteContent
    }
  }
  
  // 如果本地内容包含远程内容，返回本地内容
  if (localLines.length >= remoteLines.length) {
    const remotePrefix = localLines.slice(0, remoteLines.length).join('\n')
    if (remoteContent === remotePrefix) {
      return localContent
    }
  }
  
  // 尝试行级别的合并
  const mergedLines = [...localLines]
  for (const line of remoteLines) {
    if (!localLines.includes(line)) {
      mergedLines.push(line)
    }
  }
  
  return mergedLines.join('\n')
}

/**
 * 定期清理过期的文件锁
 */
export async function cleanupExpiredLocks(): Promise<void> {
  const store = await Store.load('store.json')
  const locks = await store.get<Record<string, SyncLock>>('fileLocks') || {}
  
  const now = Date.now()
  const expiredKeys: string[] = []
  
  for (const [filePath, lock] of Object.entries(locks)) {
    if (now - lock.timestamp > 5 * 60 * 1000) { // 5分钟过期
      expiredKeys.push(filePath)
    }
  }
  
  if (expiredKeys.length > 0) {
    for (const key of expiredKeys) {
      delete locks[key]
    }
    await store.set('fileLocks', locks)
    await store.save()
  }
}

/**
 * 获取文件的同步状态
 */
export async function getFileSyncStatus(filePath: string): Promise<{
  isLocked: boolean
  lockInfo?: SyncLock
  lastSyncTime?: number
}> {
  const store = await Store.load('store.json')
  
  // 检查锁状态
  const lockInfo = await checkFileLock(filePath)
  
  // 获取最后同步时间
  const syncTimes = await store.get<Record<string, number>>('lastSyncTimes') || {}
  const lastSyncTime = syncTimes[filePath]
  
  return {
    isLocked: !!lockInfo,
    lockInfo: lockInfo || undefined,
    lastSyncTime
  }
}

/**
 * 更新文件的同步时间
 */
export async function updateFileSyncTime(filePath: string): Promise<void> {
  const store = await Store.load('store.json')
  const syncTimes = await store.get<Record<string, number>>('lastSyncTimes') || {}
  
  syncTimes[filePath] = Date.now()
  await store.set('lastSyncTimes', syncTimes)
  await store.save()
}
