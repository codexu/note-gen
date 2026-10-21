import { assertConditionalResponse } from './write-condition'
import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { buildRemoteLogicalPath, buildRepoContentPath, buildRepoContentsEndpoint, debugSyncPath, readSyncResponseJson, encodeRemoteFileContent, decodeBase64ToBytes, pickNestedFileEntry } from './remote-file'
import { readGitTreeDirectory } from './directory-listing'
import { fetchGiteeRead } from './gitee-request'
import { gitBlobVersion } from './remote-content-cache'
import { syncStaleError, withSyncStaleContext, type SyncStaleDetails } from './sync-stale-error'
export { decodeBase64ToString } from './remote-file'

async function assertGiteeConditionalResponse(response: Response, version: string | null, path: string) {
  const context: SyncStaleDetails = {
    stage: 'apply', path, source: 'remote', check: 'version',
    expected: { sha: version, exists: version !== null },
    ...(response.status === 404 ? { actual: { exists: false } } : {}),
  }
  // Gitee reports version conflicts as 400, including duplicate creates. Keep
  // unrelated validation failures distinct; neither case may drop the guard.
  if (response.status === 400) {
    let message = ''
    try {
      const body: unknown = await response.clone().json()
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') message = body.message
    } catch { /* Preserve the generic conditional HTTP error below. */ }
    const duplicateCreate = version === null && /文件名已存在|(?:file|path).*already exists/i.test(message)
    if (/Blob SHA does not match/i.test(message) || duplicateCreate) {
      throw syncStaleError({ ...context, ...(duplicateCreate ? { actual: { exists: true } } : {}) })
    }
  }
  try { assertConditionalResponse(response, { version }) }
  catch (error) { throw withSyncStaleContext(error, context) }
}
// Remove unused imports - these types are not actually used in this file

// 自定义类型，类似于 GitHub 的响应
type GiteeResponse<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
}

// File 转换 Base64
export async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // 删除前缀
      const base64 = reader.result?.toString().replace(/^data:image\/\w+;base64,/, '');
      resolve(base64 || '');
    }
    reader.onerror = error => reject(error);
  });
}

// Gitee Error 类型，与 GitHub 保持一致
export interface GiteeError {
  status: number;
  message: string;
}

// Gitee 仓库信息类型
export interface GiteeRepoInfo {
  id: number;
  full_name: string;
  human_name: string;
  url: string;
  namespace: {
    id: number;
    name: string;
    path: string;
  };
  path: string;
  name: string;
  owner: {
    id: number;
    login: string;
    name: string;
    avatar_url: string;
    url: string;
    html_url: string;
    remark: string;
    followers_url: string;
    following_url: string;
    gists_url: string;
    starred_url: string;
    subscriptions_url: string;
    organizations_url: string;
    repos_url: string;
    events_url: string;
    received_events_url: string;
    type: string;
  };
  private: boolean;
  html_url: string;
  description: string;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  homepage: string;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  language: string;
  default_branch: string;
  open_issues_count: number;
  license: {
    key: string;
    name: string;
    spdx_id: string;
    url: string;
  } | null;
  topics: string[];
  has_issues: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  issue_comment: boolean;
  can_comment: boolean;
  repository_type: string;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GiteeFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  download_url: string;
  type: string;
  _links: Links;
  isNew?: boolean;
}

interface Links {
  self: string;
  html: string;
}

type GiteeDirectoryFileEntry = Partial<GiteeFile> & {
  content?: string | null
  url?: string
  download_url?: string | null
}
type GiteeDirectoryListingResult = GiteeDirectoryFileEntry[] & GiteeDirectoryFileEntry
type GiteeGetFilesResult = GiteeDirectoryFileEntry | GiteeDirectoryListingResult | null | undefined

const DEFAULT_BRANCH_CACHE_TTL = 5 * 60 * 1000
const defaultBranchCache = new Map<string, { branch: string, cachedAt: number }>()
// SHA-1 of the Git object header "blob 0\0", with no payload bytes.
const EMPTY_GIT_BLOB_SHA = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'

async function getDefaultBranch(repo: string, username?: string) {
  const cacheKey = `${username || ''}/${repo}`
  const cached = defaultBranchCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < DEFAULT_BRANCH_CACHE_TTL) {
    return cached.branch
  }

  try {
    const repository = await checkSyncRepoState(repo)
    const branch = repository?.default_branch?.trim() || 'master'
    defaultBranchCache.set(cacheKey, { branch, cachedAt: Date.now() })
    return branch
  } catch {
    return 'master'
  }
}

function looksLikeFilePath(path?: string) {
  const lastSegment = path?.split('/').filter(Boolean).pop() || ''
  return lastSegment.includes('.')
}

function knownGiteeFileState(entry: GiteeDirectoryFileEntry): NonNullable<SyncStaleDetails['actual']> {
  return {
    exists: true,
    ...(typeof entry.sha === 'string' && /^[a-f0-9]{40}$/i.test(entry.sha) ? { sha: entry.sha.toLowerCase() } : {}),
    ...(typeof entry.size === 'number' && Number.isFinite(entry.size) ? { size: entry.size } : {}),
  }
}

async function normalizeGiteeFileContent(entry: GiteeDirectoryFileEntry, path: string) {
  if (typeof entry.sha === 'string' && entry.sha.toLowerCase() === EMPTY_GIT_BLOB_SHA) {
    const expected = { sha: EMPTY_GIT_BLOB_SHA, size: 0, exists: true }
    if (entry.size !== undefined && entry.size !== 0) {
      throw syncStaleError({ stage: 'scan', path, source: 'remote', check: 'size', expected, actual: knownGiteeFileState(entry) })
    }
    if (entry.content != null && (typeof entry.content !== 'string' || entry.content.trim() !== '')) {
      let actual: SyncStaleDetails['actual'] = { exists: true }
      if (typeof entry.content === 'string') {
        try {
          const bytes = decodeBase64ToBytes(entry.content)
          actual = { sha: await gitBlobVersion(bytes), size: bytes.length, exists: true }
        } catch { /* Invalid content provides no reliable payload SHA or size. */ }
      }
      throw syncStaleError({ stage: 'scan', path, source: 'remote', check: 'content', expected, actual })
    }
    // Missing/null content is only an empty file when the blob ID proves it.
    return { ...entry, content: '' }
  }
  if (typeof entry.content === 'string' && entry.content.trim() !== '') return { ...entry, content: entry.content }
  return null
}

async function resolveGiteeFileContent(
  entry: GiteeDirectoryFileEntry,
  path: string,
  accessToken: string,
  username: string,
  repo: string,
  proxy?: Proxy
) {
  const normalized = await normalizeGiteeFileContent(entry, path)
  if (normalized) return normalized

  // Fetch the immutable blob from the trusted API rather than forwarding a
  // credential to an arbitrary URL supplied by a directory response.
  if (typeof entry.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(entry.sha)) throw new Error('Invalid Gitee file version')
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/git/blobs/${entry.sha}`
  const response = await fetchGiteeRead(url, { headers: { Authorization: `Bearer ${accessToken}` }, proxy })
  if (response.status === 404) throw syncStaleError({
    stage: 'scan', path, source: 'remote', check: 'version',
    expected: knownGiteeFileState(entry), actual: { exists: false },
  })
  if (!response.ok) throw new Error(`Gitee blob request failed: HTTP ${response.status}`)
  const data = await readSyncResponseJson(response, `gitee / ${path}`) as GiteeDirectoryFileEntry
  const blob = await normalizeGiteeFileContent(data, path)
  if (!blob) throw new Error('Gitee blob response has no file content')
  const bytes = decodeBase64ToBytes(blob.content)
  const version = entry.sha.toLowerCase()
  if (data.sha !== undefined && (typeof data.sha !== 'string' || data.sha.toLowerCase() !== version)) {
    throw syncStaleError({ stage: 'scan', path, source: 'remote', check: 'version', expected: knownGiteeFileState(entry), actual: knownGiteeFileState(data) })
  }
  const actual = { sha: await gitBlobVersion(bytes), size: bytes.length, exists: true }
  if (actual.sha !== version) {
    throw syncStaleError({ stage: 'scan', path, source: 'remote', check: 'content', expected: knownGiteeFileState(entry), actual })
  }
  for (const declared of [entry, data]) {
    if (declared.size !== undefined && declared.size !== bytes.length) {
      throw syncStaleError({ stage: 'scan', path, source: 'remote', check: 'size', expected: knownGiteeFileState(declared), actual })
    }
  }
  return { ...entry, content: blob.content }
}

export async function uploadFile(
  { file, filename, sha, message, repo, path, guarded = false }:
  { file: string | Uint8Array, filename?: string, sha?: string, message?: string, repo: string, path?: string, guarded?: boolean })
{
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  const giteeUsername = await store.get<string>('giteeUsername')
  const id = uuid()
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    let targetPath = path
    let resolvedExistingFile: GiteeDirectoryFileEntry | null = null
    if (path && !guarded) {
      const existingFile = await getFiles({ path, repo })
      if (existingFile && !Array.isArray(existingFile)) {
        resolvedExistingFile = existingFile
        targetPath = existingFile.path || path
        sha = existingFile.sha || sha
      }
    }

    const logicalPath = (resolvedExistingFile
      ? buildRemoteLogicalPath({ path: targetPath })
      : targetPath
      ? buildRemoteLogicalPath({ path: targetPath, filename })
      : buildRemoteLogicalPath({ filename: filename || id })).split('/').filter(Boolean).join('/')
    const finalPath = buildRepoContentPath({ path: logicalPath })
    debugSyncPath('gitee.uploadFile', {
      inputPath: path,
      filename,
      resolvedExistingPath: resolvedExistingFile?.path,
      finalPath,
      hasSha: Boolean(sha),
    })

    if (file.length === 0) {
      if (!accessToken || !giteeUsername) throw new Error('Gitee sync is not configured')
      const { uploadEmptyGiteeFile } = await import('./gitee-empty-upload')
      return await uploadEmptyGiteeFile({
        username: giteeUsername, token: accessToken, repo, path: logicalPath,
        message: message || `Upload ${filename || id}`, expectedVersion: sha || null, proxy,
      })
    }

    const branch = await getDefaultBranch(repo, giteeUsername)
    // 将内容转换为 Base64（Gitee API 要求）
    const base64Content = encodeRemoteFileContent(file)

    // 设置请求头
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');

    // 根据是否有sha参数来决定是创建新文件（POST）还是更新文件（PUT）
    // Gitee API 与 GitHub 不同，更新文件需要使用 PUT 请求
    const requestOptions = {
      method: sha ? 'PUT' : 'POST',
      headers,
      body: JSON.stringify({
        access_token: accessToken,
        content: base64Content,
        message: message || `Upload ${filename || id}`,
        branch,
        sha
      }),
      proxy
    };

    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}${buildRepoContentsEndpoint(finalPath)}`;
    const response = await fetch(url, requestOptions);
    if (guarded) await assertGiteeConditionalResponse(response, sha || null, logicalPath);

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return { data } as GiteeResponse<any>;
    }

    if (response.status === 400) {
      return null;
    }

    // 404 表示文件不存在，尝试用 POST 创建新文件
    if (response.status === 404) {
      const postOptions = {
        method: 'POST',
        headers,
        body: JSON.stringify({
          access_token: accessToken,
          content: base64Content,
          message: message || `Upload ${filename || id}`,
          branch,
        }),
        proxy
      };
      const postResponse = await fetch(url, postOptions);
      if (postResponse.status >= 200 && postResponse.status < 300) {
        const data = await postResponse.json();
        return { data } as GiteeResponse<any>;
      }
      const postErrorData = await postResponse.json();
      throw {
        status: postResponse.status,
        message: postErrorData.message || '同步失败'
      };
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '同步失败'
    };
  } catch (error) {
    if (guarded) throw error
    toast({
      title: '同步失败',
      description: (error as GiteeError).message,
      variant: 'destructive',
    })
  }
}

export async function getDirectoryFiles({ path, repo, cache }: { path: string; repo: string; cache?: Map<string, Promise<unknown>> }) {
  const store = await Store.load('store.json')
  const token = await store.get<string>('giteeAccessToken')
  const username = await store.get<string>('giteeUsername')
  if (!token || !username) throw new Error('Gitee sync is not configured')
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined
  const baseUrl = `https://gitee.com/api/v5/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`
  return readGitTreeDirectory(path, resource => fetchGiteeRead(
    `${baseUrl}${resource}`,
    { headers: { Authorization: `Bearer ${token}` }, proxy },
  ), cache)
}

export async function getFiles({ path, repo, ref }: { path: string, repo: string, ref?: string }): Promise<GiteeGetFilesResult> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) throw new Error('Gitee sync is not configured')

  const giteeUsername = await store.get<string>('giteeUsername')
  if (!giteeUsername) throw new Error('Gitee sync is not configured')
  const normalizedPath = buildRepoContentPath({ path })
  debugSyncPath('gitee.getFiles', {
    inputPath: path,
    normalizedPath,
  })

  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined

  try {
    // 构建 URL 参数
    const params = new URLSearchParams()
    if (ref) params.set('ref', ref)
    const queryString = params.toString()
    const query = queryString ? `?${queryString}` : ''
    const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(giteeUsername)}/${encodeURIComponent(repo)}${buildRepoContentsEndpoint(normalizedPath)}${query}`;
    
    const requestOptions = {
      headers: { Authorization: `Bearer ${accessToken}` },
      proxy
    };
    
    try {
      const response = await fetchGiteeRead(url, requestOptions);
      if (response.status >= 200 && response.status < 300) {
        const data = await readSyncResponseJson(response, `gitee / ${path}`) as GiteeGetFilesResult;
        if (Array.isArray(data) && looksLikeFilePath(path)) {
          const nestedFile = pickNestedFileEntry(data, path)
          if (nestedFile) {
            if (nestedFile.path && nestedFile.path !== path) {
              const resolvedFile = await getFiles({ path: nestedFile.path, repo, ref })
              if (resolvedFile && !Array.isArray(resolvedFile)) {
                return resolvedFile
              }
            }

            const resolvedEntry = await resolveGiteeFileContent(
              nestedFile as GiteeDirectoryFileEntry,
              path,
              accessToken,
              giteeUsername,
              repo,
              proxy
            )
            if (resolvedEntry) {
              return resolvedEntry
            }
          }

          debugSyncPath('gitee.getFiles.fileNotFoundFromListing', {
            inputPath: path,
            normalizedPath,
            listingCount: data.length,
          })
          return null
        }
        if (data && !Array.isArray(data) && data.type !== 'dir' && data.type !== 'tree') {
          return resolveGiteeFileContent(data, path, accessToken, giteeUsername, repo, proxy)
        }
        return data;
      }
      if (response.status === 404) return null
      throw new Error(`gitee / ${path}: HTTP ${response.status}`)
    } catch (error) {
      throw error
    }
  } catch (error) {
    throw error
  }
}

export async function deleteFile({ path, sha, repo, guarded = false }: { path: string, sha: string, repo: string; guarded?: boolean }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('giteeAccessToken')
  if (!accessToken) return;
  
  const giteeUsername = await store.get('giteeUsername')
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    
    const requestOptions = {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        access_token: accessToken,
        sha,
        message: `Delete ${path}`
      }),
      proxy
    };
    
    const normalizedPath = buildRepoContentPath({ path, preserveWhitespace: true });
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}${buildRepoContentsEndpoint(normalizedPath)}`;
    
    const response = await fetch(url, requestOptions);
    if (guarded) await assertGiteeConditionalResponse(response, sha || null, path);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return { data } as GiteeResponse<any>;
    }
    
    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '删除失败'
    };
  } catch (error) {
    if (guarded) throw error
    toast({
      title: '删除失败',
      description: (error as GiteeError).message,
      variant: 'destructive',
    })
    // 返回 false 而不是 undefined，让调用者知道操作已完成
    return false;
  }
}

export async function getFileCommits({ path, repo }: { path: string, repo: string }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) return;
  
  const giteeUsername = await store.get<string>('giteeUsername')
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    // 设置请求参数
    const params = new URLSearchParams();
    params.append('path', path);
    params.append('per_page', '100');
    
    const requestOptions = {
      headers: { Authorization: `Bearer ${accessToken}` },
      proxy
    };
    
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/commits?${params.toString()}`;
    
    const response = await fetchGiteeRead(url, requestOptions);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data
    }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}

// 获取 Gitee 用户信息
export async function getUserInfo() {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) {
    return;
  }
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    const requestOptions = {
      headers: { Authorization: `Bearer ${accessToken}` },
      proxy,
    };
    
    const url = 'https://gitee.com/api/v5/user';
    
    const response = await fetchGiteeRead(url, requestOptions);
    if (!response.ok) throw new Error(`Gitee user request failed: HTTP ${response.status}`)
    const data = await response.json();
    if (typeof data?.login !== 'string' || !data.login) throw new Error('Invalid Gitee user response')
    
    // 保存用户名到存储
    await store.set('giteeUsername', data.login);
    await store.save();
    
    return data;
  } catch (error) {
    // 不显示 toast，避免在检测过程中干扰用户
    throw error;
  }
}

// 检查 Gitee 仓库
export async function checkSyncRepoState(name: string): Promise<GiteeRepoInfo | null | undefined> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) {
    return;
  }
  
  const giteeUsername = await store.get<string>('giteeUsername')
  if (!giteeUsername) throw new Error('Gitee sync is not configured')
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    const requestOptions = {
      headers: { Authorization: `Bearer ${accessToken}` },
      proxy,
    };
    
    const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(giteeUsername)}/${encodeURIComponent(name)}`;
    
    const response = await fetchGiteeRead(url, requestOptions);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GiteeRepoInfo;
      return data;
    }
    
    throw {
      status: response.status,
      message: `Gitee repository request failed: HTTP ${response.status}`
    };
  } catch (error) {
    if ((error as GiteeError).status === 404) {
      return null;
    }
    throw error;
  }
}

export async function listUserRepositories(): Promise<string[]> {
  const store = await Store.load('store.json')
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) throw new Error('Gitee Access Token 未配置')

  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined
  const params = new URLSearchParams({
    type: 'owner',
    sort: 'updated',
    direction: 'desc',
    per_page: '100',
  })
  const response = await fetchGiteeRead(`https://gitee.com/api/v5/user/repos?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    proxy,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`获取仓库列表失败: ${response.status}`)
  }

  const repositories = await response.json() as GiteeRepoInfo[]
  return repositories.map(repository => repository.name).filter(Boolean)
}

// 创建 Gitee 仓库
export async function createSyncRepo(name: string, isPrivate?: boolean) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('giteeAccessToken')
  if (!accessToken) return;
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    
    const requestOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        access_token: accessToken,
        name,
        private: isPrivate === undefined ? true : isPrivate,
        auto_init: false,
        description: '由 Note Gen 自动创建'
      }),
      proxy
    };
    
    const url = `https://gitee.com/api/v5/user/repos`;
    
    const response = await fetch(url, requestOptions);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
    }
    
    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '创建仓库失败'
    };
  } catch (error) {
    toast({
      title: '创建仓库失败',
      description: (error as GiteeError).message,
      variant: 'destructive',
    })
  }
}
