import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { Store } from '@tauri-apps/plugin-store'

function normalizeFsPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
}

export function isAbsoluteFsPath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/**
 * 获取当前工作区路径
 * 如果设置了自定义工作区，则返回自定义路径
 * 否则返回默认的 AppData/article 路径
 */
export async function getWorkspacePath(): Promise<{ path: string, isCustom: boolean }> {
  // 查询本地存储
  const store = await Store.load('store.json')
  const workspacePath = await store.get<string>('workspacePath')

  // 如果设置了自定义工作区路径，则使用自定义路径
  if (workspacePath) {
    return {
      path: workspacePath,
      isCustom: true
    }
  }

  // 否则使用默认路径
  return {
    path: 'article',
    isCustom: false
  }
}

/**
 * 获取文件的完整路径选项
 * @param relativePath 相对于工作区的路径
 * @returns 包含文件路径和baseDir的选项
 */
export async function getFilePathOptions(relativePath: string): Promise<{ path: string, baseDir?: BaseDirectory }> {
  if (isAbsoluteFsPath(relativePath)) {
    return { path: relativePath }
  }

  const workspace = await getWorkspacePath()

  if (workspace.isCustom) {
    // 对于自定义工作区，返回绝对路径，不设置baseDir
    const fullPath = await join(workspace.path, relativePath)
    return { path: fullPath }
  } else {
    // 对于默认工作区，使用AppData作为baseDir
    const resolvedPath = `article/${relativePath}`
    return {
      path: resolvedPath,
      baseDir: BaseDirectory.AppData
    }
  }
}

/**
 * 获取默认 AppData/article 下的绝对路径
 * 主要用于 skills/runtime、outputs 等特殊目录，避免某些 baseDir 写入限制
 */
export async function getDefaultArticleAbsolutePath(relativePath: string): Promise<string> {
  const normalized = relativePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^article\//, '')

  const appDataPath = await appDataDir()
  return await join(appDataPath, 'article', normalized)
}

/**
 * 获取通用文件路径选项
 * 不限于article目录，可处理任意AppData下的路径
 * @param path 原始路径，可能包含或不包含目录前缀
 * @param prefix 可选的目录前缀，如'article'、'image'等
 * @returns 包含文件路径和baseDir的选项
 */
export async function getGenericPathOptions(path: string, prefix?: string): Promise<{ path: string, baseDir?: BaseDirectory }> {
  const workspace = await getWorkspacePath()
  
  if (workspace.isCustom) {
    // 对于自定义工作区，返回基于自定义工作区的绝对路径
    let fullPath = workspace.path
    
    // 如果指定了prefix，且path不以prefix开头，则添加prefix
    if (prefix && !path.startsWith(`${prefix}/`) && !path.startsWith(prefix)) {
      fullPath = await join(fullPath, prefix || '', path)
    } else {
      fullPath = await join(fullPath, path)
    }
    
    return { path: fullPath }
  } else {
    // 对于默认工作区，使用AppData作为baseDir
    // 如果指定了prefix且path不以prefix开头，则添加prefix/
    if (prefix && !path.startsWith(`${prefix}/`) && !path.startsWith(prefix)) {
      return {
        path: `${prefix}/${path}`,
        baseDir: BaseDirectory.AppData
      }
    }
    
    return { 
      path: path, 
      baseDir: BaseDirectory.AppData 
    }
  }
}

/**
 * 将任何路径转换为相对于工作区的路径
 * @param path 原始路径
 * @returns 相对于工作区的路径
 */
export async function toWorkspaceRelativePath(path: string): Promise<string> {
  const workspace = await getWorkspacePath()
  
  const defaultDirRegex = /^(article[\\\/])/
  // 如果是默认工作区，移除"article/"前缀
  if (!workspace.isCustom && defaultDirRegex.test(path)) {
    return path.replace(/article[\\\/]/g, '')
  }
  
  // 如果是自定义工作区，移除工作区路径前缀
  const normalizedPath = normalizeFsPath(path)
  const normalizedWorkspacePath = normalizeFsPath(workspace.path).replace(/\/$/, '')
  if (workspace.isCustom && (
    normalizedPath === normalizedWorkspacePath ||
    normalizedPath.startsWith(`${normalizedWorkspacePath}/`)
  )) {
    // 确保路径分隔符处理正确
    const relativePath = normalizedPath.substring(normalizedWorkspacePath.length)
    // 移除开头的斜杠（如果有）
    return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath
  }
  
  // 如果路径已经是相对路径，直接返回
  return path
}

/**
 * 规范化相对于工作区的路径
 * - 自定义工作区: 保持相对路径原样
 * - 默认工作区(article): 自动移除误传入的 article/ 前缀
 */
export async function normalizeWorkspaceRelativePath(relativePath: string): Promise<string> {
  const workspace = await getWorkspacePath()
  const normalized = relativePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')

  if (workspace.isCustom) {
    return normalized
  }

  if (normalized === 'article') {
    return ''
  }

  return normalized.replace(/^article\//, '')
}

/**
 * 确保路径是安全的、相对于工作区的路径。
 * Agent 文件工具应在执行读写前调用此函数，避免越过工作区根目录。
 */
export async function ensureSafeWorkspaceRelativePath(relativePath: string): Promise<string> {
  const normalized = await normalizeWorkspaceRelativePath(relativePath)

  if (!normalized) {
    throw new Error('路径不能为空')
  }

  if (normalized.startsWith('/')) {
    throw new Error('不允许使用绝对路径')
  }

  const segments = normalized.split('/').filter(Boolean)
  if (segments.some(segment => segment === '..')) {
    throw new Error('路径不能包含 ..')
  }

  return normalized
}
