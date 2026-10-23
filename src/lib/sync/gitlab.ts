import { withGitRepoWriteLock } from './git-repo-write-lock'
import { assertConditionalResponse, type RemoteWriteCondition } from './write-condition'
import { fetchRemoteRead, recoverRemoteRead, recoverRemoteMutation } from './remote-mutation-recovery'
import { gitBlobVersion } from './remote-content-cache'
import { syncStaleError } from './sync-stale-error'
import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http';
import { fetch as encodeFetch } from './encode-fetch'
import { buildRemoteLogicalPath, debugSyncPath, encodeRemoteFileContent, decodeBase64ToBytes } from './remote-file'
import { 
  GitlabInstanceType, 
  GitlabProjectInfo, 
  GITLAB_INSTANCES, 
  GitlabError,
  GitlabUserInfo,
  GitlabCommit,
  GitlabResponse,
  GitlabRepositoryFile
} from './gitlab.types';
import { parseDirectoryEntries, readDirectoryResponse, remoteRecord, type RemoteDirectoryEntry } from './directory-listing'

// 获取 Gitlab 实例的 API 基础 URL 

function resolveUploadPath(path: string | undefined, filename: string | undefined, fallbackFilename: string) {
  if (filename) {
    return buildRemoteLogicalPath({ path, filename })
  }

  return path?.replace(/^\/+|\/+$/g, '') || fallbackFilename
}

const DEFAULT_BRANCH_CACHE_TTL = 5 * 60 * 1000
const defaultBranchCache = new Map<string, { branch: string, cachedAt: number }>()

export async function getDefaultBranch(repo: string) {
  const cached = defaultBranchCache.get(repo)
  if (cached && Date.now() - cached.cachedAt < DEFAULT_BRANCH_CACHE_TTL) {
    return cached.branch
  }

  try {
    const project = await checkSyncProjectState(repo)
    const branch = project?.default_branch?.trim() || 'main'
    defaultBranchCache.set(repo, { branch, cachedAt: Date.now() })
    return branch
  } catch {
    return 'main'
  }
}

export async function getGitlabApiBaseUrl(): Promise<string> {
  const store = await Store.load('store.json');
  const instanceType = await store.get<GitlabInstanceType>('gitlabInstanceType') || GitlabInstanceType.OFFICIAL;

  if (instanceType === GitlabInstanceType.SELF_HOSTED) {
    let customUrl = await store.get<string>('gitlabCustomUrl') || '';
    // 移除末尾的斜杠，避免双斜杠问题
    customUrl = customUrl.replace(/\/+$/, '').trim();

    // 验证自定义 URL 是否有效
    if (!customUrl) {
      throw new Error('自建 GitLab 实例的 URL 未配置，请先在设置中填写 GitLab URL');
    }

    // 确保 URL 包含协议
    if (!customUrl.startsWith('http://') && !customUrl.startsWith('https://')) {
      customUrl = 'https://' + customUrl;
    }

    return `${customUrl}/api/v4`;
  }

  const instance = GITLAB_INSTANCES[instanceType];
  return `${instance.baseUrl}/api/v4`;
}

// 获取通用请求头
async function getCommonHeaders(): Promise<any> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('gitlabAccessToken');

  if (!accessToken) {
    throw new Error('GitLab Access Token 未配置');
  }

  const headers = {
    "Content-Type": 'application/json;charset=iso-8859-1',
    "PRIVATE-TOKEN": accessToken,
  };

  return headers;
}

// 获取代理配置
async function getProxyConfig(): Promise<Proxy | undefined> {
  const store = await Store.load('store.json');
  const proxyUrl = await store.get<string>('proxy');
  return proxyUrl ? { all: proxyUrl } : undefined;
}

interface GitlabMutationFile { sha: string; lastCommitId: string }

async function gitlabMutationBranch(baseUrl: string, projectId: string, headers: HeadersInit, proxy?: Proxy) {
  const project = remoteRecord(await readDirectoryResponse(await fetchRemoteRead(`${baseUrl}/projects/${encodeURIComponent(projectId)}`,
    { headers: new Headers(headers), proxy })))
  if (typeof project.default_branch !== 'string' || !project.default_branch.trim()) {
    const branches = await readDirectoryResponse(await fetchRemoteRead(`${baseUrl}/projects/${encodeURIComponent(projectId)}/repository/branches`,
      { headers: new Headers(headers), proxy }))
    if (Array.isArray(branches) && !branches.length) return 'main'
    throw new Error('Remote project has no default branch')
  }
  return project.default_branch.trim()
}

async function readGitlabMutationFile(
  baseUrl: string, projectId: string, path: string, branch: string, headers: HeadersInit, proxy?: Proxy, allowEmptyProject = false,
): Promise<GitlabMutationFile | null> {
  const projectUrl = `${baseUrl}/projects/${encodeURIComponent(projectId)}`
  // GitLab includes UTF-8 file names in metadata headers; keep the header-safe
  // transport while recreating its mutable native options on every read retry.
  const metadata = await recoverRemoteRead(() => encodeFetch(
    `${projectUrl}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    { method: 'HEAD', headers: new Headers(headers), proxy, connectTimeout: 10_000, maxRedirections: 0 }))
  if (metadata.status === 404) {
    // A missing file is trustworthy only while the captured branch remains readable.
    const branchResponse = await fetchRemoteRead(`${projectUrl}/repository/branches/${encodeURIComponent(branch)}`,
      { headers: new Headers(headers), proxy })
    if (branchResponse.status === 404 && allowEmptyProject) {
      const project = remoteRecord(await readDirectoryResponse(await fetchRemoteRead(projectUrl, { headers: new Headers(headers), proxy })))
      const branches = await readDirectoryResponse(await fetchRemoteRead(`${projectUrl}/repository/branches`, { headers: new Headers(headers), proxy }))
      // An empty project can create its first branch; an existing branch that
      // disappears is never evidence of a completed deletion.
      if (!project.default_branch && Array.isArray(branches) && !branches.length) return null
    }
    const head = remoteRecord(remoteRecord(await readDirectoryResponse(branchResponse)).commit)
    if (typeof head.id !== 'string' || !/^[a-f0-9]{40,64}$/i.test(head.id)) throw new Error('Invalid GitLab branch version')
    return null
  }
  if (!metadata.ok) throw new Error(`GitLab metadata request failed: HTTP ${metadata.status}`)
  const sha = metadata.headers.get('x-gitlab-blob-id')
  const lastCommitId = metadata.headers.get('x-gitlab-last-commit-id')
  if (!sha || !lastCommitId || !/^[a-f0-9]{40,64}$/i.test(sha) || !/^[a-f0-9]{40,64}$/i.test(lastCommitId)) {
    throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
  }
  return { sha: sha.toLowerCase(), lastCommitId }
}

async function reconcileGitlabMutation(
  baseUrl: string, projectId: string, path: string, branch: string, headers: HeadersInit, proxy: Proxy | undefined,
  expected: GitlabMutationFile | null, desiredVersion?: string,
) {
  const current = await readGitlabMutationFile(baseUrl, projectId, path, branch, headers, proxy, expected === null && desiredVersion !== undefined)
  if (desiredVersion ? current?.sha === desiredVersion : !current) {
    return { state: 'applied' as const, value: new Response(JSON.stringify({ id: current?.lastCommitId || '' }), { status: 200 }) }
  }
  if (expected === null ? !current : current?.sha === expected.sha && current.lastCommitId === expected.lastCommitId) {
    return { state: 'unchanged' as const }
  }
  throw syncStaleError({ stage: 'apply', path, source: 'remote', check: 'version',
    expected: { sha: expected?.sha || null, exists: expected !== null },
    actual: current ? { sha: current.sha, exists: true } : { exists: false } })
}

/**
 * 上传文件到 Gitlab 项目
 * @param params 上传参数
 */
export async function uploadFile({
  file,
  filename,
  sha,
  message,
  repo,
  path,
  beforeWrite
}: {
  file: string | Uint8Array;
  filename?: string;
  sha?: string;
  message?: string;
  repo: string;
  path?: string;
  beforeWrite?: () => Promise<void>;
}) {
  try {
    const store = await Store.load('store.json');
    const gitlabUsername = await store.get<string>('gitlabUsername');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!gitlabUsername || !projectId) {
      throw new Error('Gitlab 用户名或项目 ID 未配置');
    }

    const id = uuid();
    const targetPath = resolveUploadPath(path, filename, id);
    const encodedTargetPath = encodeURIComponent(targetPath);
    debugSyncPath('gitlab.uploadFile', {
      inputPath: path,
      filename,
      targetPath,
      encodedTargetPath,
      hasSha: Boolean(sha),
    })

    // 将内容转换为 Base64（GitLab API 要求）
    const base64Content = encodeRemoteFileContent(file)

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();
    debugSyncPath('gitlab.uploadFile.requestPath', {
      inputPath: path,
      targetPath,
      encodedTargetPath,
    })

    const commitsApiUrl = `${baseUrl}/projects/${encodeURIComponent(projectId)}/repository/commits`;
    return await withGitRepoWriteLock(baseUrl, projectId, async () => {
      const branch = await gitlabMutationBranch(baseUrl, projectId, headers, proxy)
      const expected = await readGitlabMutationFile(baseUrl, projectId, targetPath, branch, headers, proxy, !sha)
      if (sha && expected?.sha !== sha.toLowerCase()) throw new Error('SYNC_SWITCH_STALE')
      const desiredVersion = await gitBlobVersion(decodeBase64ToBytes(base64Content), expected?.sha.length)
      // Keep the first observed file commit for every attempt, including an
      // existing target discovered by a create request.
      const body = JSON.stringify({ branch, commit_message: message || `Upload ${filename || id}`,
        actions: [{ action: expected ? 'update' : 'create', file_path: targetPath,
          content: base64Content, encoding: 'base64',
          ...(expected ? { last_commit_id: expected.lastCommitId } : {}) }] })
      const response = await recoverRemoteMutation({ beforeWrite,
        send: () => fetch(commitsApiUrl, { method: 'POST', headers: new Headers(headers), body, proxy }),
        reconcile: () => reconcileGitlabMutation(baseUrl, projectId, targetPath, branch, headers, proxy, expected, desiredVersion),
      })
      if (response.ok) return { data: await response.json() } as GitlabResponse<GitlabCommit>
      const errorData = await response.json()
      throw { status: response.status, message: errorData.error || errorData.message || '同步失败' } as GitlabError
    })
  } catch (error) {
    toast({
      title: '同步失败',
      description: (error as GitlabError).message || '上传文件时发生错误',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 获取 Gitlab 项目文件列表或单个文件信息
 * @param params 查询参数
 */
export async function getDirectoryFiles({ path, repo }: { path: string; repo: string }): Promise<RemoteDirectoryEntry[]> {
  const store = await Store.load('store.json')
  const projectId = await store.get<string>(`gitlab_${repo}_project_id`)
  if (!projectId) throw new Error('GitLab sync is not configured')
  const branch = await getDefaultBranch(repo)
  const baseUrl = await getGitlabApiBaseUrl()
  const headers = await getCommonHeaders()
  const proxy = await getProxyConfig()
  const entries: RemoteDirectoryEntry[] = []
  const seenPaths = new Set<string>()
  let page = 1
  while (true) {
    const params = new URLSearchParams({ path, ref: branch, per_page: '100', page: String(page) })
    const response = await fetch(`${baseUrl}/projects/${projectId}/repository/tree?${params}`, {
      method: 'GET', headers, proxy,
    })
    if (response.status === 404 && !path && page === 1) {
      const project = await readDirectoryResponse(await fetch(`${baseUrl}/projects/${projectId}`, { method: 'GET', headers, proxy }))
      if (project && typeof project === 'object' && 'empty_repo' in project && project.empty_repo === true) return []
    }
    if (response.status === 404 && path && page === 1) {
      // 验证仓库仍然可读，避免把鉴权或配置错误误认为目录已删除。
      await getDirectoryFiles({ path: '', repo })
      return []
    }
    const batch = parseDirectoryEntries(await readDirectoryResponse(response))
    for (const entry of batch) {
      if (seenPaths.has(entry.path)) throw new Error('Repeated GitLab directory page')
      seenPaths.add(entry.path)
      entries.push(entry)
    }
    const nextPage = response.headers.get('X-Next-Page')
    if (nextPage === '' || (nextPage === null && batch.length < 100)) return entries
    const next = nextPage ? Number(nextPage) : page + 1
    if (!Number.isInteger(next) || next <= page || batch.length === 0) {
      throw new Error('Invalid GitLab directory pagination')
    }
    page = next
  }
}

export async function getFiles({ path, repo }: { path: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);

    if (!projectId) {
      throw new Error('项目 ID 未配置');
    }

    const branch = await getDefaultBranch(repo)
    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();
    debugSyncPath('gitlab.getFiles', {
      inputPath: path,
      filePath: encodeURIComponent(path),
      treePath: encodeURIComponent(path),
    })

    // 先尝试获取单个文件信息
    const fileUrl = `${baseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;

    try {
      const fileResponse = await fetch(fileUrl, {
        method: 'GET',
        headers,
        proxy
      });

      if (fileResponse.status >= 200 && fileResponse.status < 300) {
        const fileData = await fileResponse.json();
        // 返回单个文件对象，包含 sha (使用 blob_id 作为 sha)
        return {
          name: fileData.file_name,
          path: fileData.file_path,
          sha: fileData.blob_id,
          size: fileData.size,
        };
      }
    } catch {
      // 如果获取单个文件失败，继续尝试获取目录列表
    }

    // 如果不是单个文件，尝试获取目录列表
    const url = `${baseUrl}/projects/${projectId}/repository/tree?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GitlabRepositoryFile[];
      return data.map(item => {
        return {
          name: item.name,
          path: item.path,
          type: item.type === 'tree' ? 'dir' : 'file',
          sha: item.id,
        }
      })
    }

    // 文件或目录不存在，返回 null
    if (response.status === 404) {
      return null
    }

    // 401 或其他客户端错误，抛出错误
    if (response.status >= 400 && response.status < 500) {
      const errorData = await response.json().catch(() => ({}));
      throw {
        status: response.status,
        message: errorData.message || `获取文件列表失败: ${response.status}`
      } as GitlabError;
    }

    return null;

  } catch (error) {
    // 重新抛出已处理的错误，静默处理其他错误
    if ((error as GitlabError).status) {
      throw error;
    }
    // 静默处理错误，不显示 toast，因为这可能只是文件不存在
    return null;
  }
}

/**
 * 删除 Gitlab 项目文件
 * @param params 删除参数
 */
export async function deleteFile({ path, sha, repo, beforeWrite }: { path: string; sha?: string; repo: string; beforeWrite?: () => Promise<void> }) {
  try {
    const store = await Store.load('store.json');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    if (!projectId) throw new Error('项目 ID 未配置');
    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();
    return await withGitRepoWriteLock(baseUrl, projectId, async () => {
      const branch = await gitlabMutationBranch(baseUrl, projectId, headers, proxy)
      const expected = await readGitlabMutationFile(baseUrl, projectId, path, branch, headers, proxy)
      if (!expected) return true
      if (sha && expected.sha !== sha.toLowerCase()) throw new Error('SYNC_SWITCH_STALE')
      const url = `${baseUrl}/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(path)}`
      const body = JSON.stringify({ branch, commit_message: `Delete ${path}`, last_commit_id: expected.lastCommitId })
      const response = await recoverRemoteMutation({ beforeWrite,
        send: () => fetch(url, { method: 'DELETE', headers: new Headers(headers), body, proxy }),
        reconcile: () => reconcileGitlabMutation(baseUrl, projectId, path, branch, headers, proxy, expected),
      })
      if (response.ok) return true
      const errorData = await response.json()
      throw { status: response.status, message: errorData.message || '删除文件失败' } as GitlabError
    })
  } catch (error) {
    toast({ title: '删除文件失败', description: (error as GitlabError).message || '删除文件时发生错误', variant: 'destructive' });
    return null;
  }
}

/**
 * 获取文件提交历史
 * @param params 查询参数
 */
export async function getFileCommits({ path, repo }: { path: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!projectId) {
      return false;
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 对 path 进行编码，避免特殊字符导致 404
    const encodedPath = encodeURIComponent(path);
    const url = `${baseUrl}/projects/${projectId}/repository/commits?path=${encodedPath}&per_page=100`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GitlabCommit[];
      return { data } as GitlabResponse<GitlabCommit[]>;
    }

    // 404 或其他错误，静默返回 false（文件没有提交历史）
    return false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // 静默处理错误，不显示 toast
    return false;
  }
}

/**
 * 获取特定 commit 的文件内容
 * @param params 查询参数
 */
export async function getFileContent({ path, ref, repo }: { path: string; ref?: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!projectId) {
      throw new Error('项目 ID 未配置');
    }

    const branch = ref || await getDefaultBranch(repo)
    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 使用 Gitlab API 获取特定 commit 的文件内容
    const url = `${baseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`;

    const response = await encodeFetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const content = new Uint8Array(await response.arrayBuffer());
      // 将原始字节转换为 Base64，同时支持文本和二进制文件。
      const base64Content = encodeRemoteFileContent(content);
      return {
        content: base64Content,
        encoding: 'base64'
      };
    }

    if (response.status === 404) return null

    throw new Error(`gitlab / ${path}: HTTP ${response.status}`)

  } catch (error) {
    throw error
  }
}

/**
 * 获取 Gitlab 用户信息
 * @param token 可选的访问令牌
 */
export async function getUserInfo(token?: string): Promise<GitlabUserInfo> {
  try {
    const store = await Store.load('store.json');
    const accessToken = token || await store.get<string>('gitlabAccessToken');
    
    if (!accessToken) {
      throw new Error('访问令牌未配置');
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const proxy = await getProxyConfig();

    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Content-Type', 'application/json');

    const response = await fetch(`${baseUrl}/user`, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const userInfo = await response.json() as GitlabUserInfo;
      
      // 保存用户名到存储
      await store.set('gitlabUsername', userInfo.username);
      await store.save();
      
      return userInfo;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '获取用户信息失败'
    } as GitlabError;

  } catch (error) {
    toast({
      title: '获取用户信息失败',
      description: (error as GitlabError).message || '获取用户信息时发生错误',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 检查同步项目状态
 * @param name 项目名称
 */
export async function checkSyncProjectState(name: string): Promise<GitlabProjectInfo | null> {
  try {
    const store = await Store.load('store.json');
    const gitlabUsername = await store.get<string>('gitlabUsername');
    
    if (!gitlabUsername) {
      throw new Error('用户名未配置');
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 搜索项目
    const searchUrl = `${baseUrl}/projects?search=${name}&owned=true&per_page=10`;
    
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const projects = await response.json() as GitlabProjectInfo[];
      
      // 查找匹配的项目
      const project = projects.find(p => p.name === name && p.namespace.path === gitlabUsername);
      
      if (project) {
        // 保存项目 ID
        await store.set(`gitlab_${name}_project_id`, project.id.toString());
        await store.save();
      }
      
      return project || null;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '检查项目状态失败'
    } as GitlabError;

  } catch (error) {
    throw error;
  }
}

export async function listUserRepositories(): Promise<string[]> {
  const store = await Store.load('store.json')
  const username = await store.get<string>('gitlabUsername')
  const baseUrl = await getGitlabApiBaseUrl()
  const headers = await getCommonHeaders()
  const proxy = await getProxyConfig()
  const response = await fetch(
    `${baseUrl}/projects?owned=true&order_by=last_activity_at&sort=desc&per_page=100`,
    { method: 'GET', headers, proxy }
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`获取项目列表失败: ${response.status}`)
  }

  const projects = await response.json() as GitlabProjectInfo[]
  return projects
    .filter(project => !username || project.namespace.path === username)
    .map(project => project.name)
    .filter(Boolean)
}

/**
 * 创建同步项目
 * @param name 项目名称
 * @param isPrivate 是否私有项目
 */
export async function createSyncProject(name: string, isPrivate: boolean = true): Promise<GitlabProjectInfo | null> {
  try {
    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const requestBody = {
      name: name,
      path: name,
      description: `note-gen 同步项目 - ${name}`,
      visibility: isPrivate ? 'private' : 'public',
      initialize_with_readme: true,
      default_branch: 'main'
    };

    const response = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const project = await response.json() as GitlabProjectInfo;
      
      // 保存项目 ID
      const store = await Store.load('store.json');
      await store.set(`gitlab_${name}_project_id`, project.id.toString());
      await store.save();
      
      return project;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '创建项目失败'
    } as GitlabError;

  } catch (error) {
    toast({
      title: '创建项目失败',
      description: (error as GitlabError).message || '创建项目时发生错误',
      variant: 'destructive',
    });
    return null;
  }
}

/** Bind a blob version to its last commit in one response, then let GitLab
 * atomically reject a mutation if that commit is no longer current. */
export async function mutateFileConditionally(path: string, repo: string, condition: RemoteWriteCondition, content?: Uint8Array, beforeWrite?: () => Promise<void>) {
  if (content) content = Uint8Array.from(content)
  condition = { ...condition }
  const store = await Store.load('store.json')
  const projectId = await store.get<string>(`gitlab_${repo}_project_id`)
  if (!projectId) throw new Error('GitLab sync is not configured')
  const base = await getGitlabApiBaseUrl()
  const headers = await getCommonHeaders()
  const proxy = await getProxyConfig()
  return await withGitRepoWriteLock(base, projectId, async () => {
    const branch = await gitlabMutationBranch(base, projectId, headers, proxy)
    const url = `${base}/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(path)}`
    const expected = await readGitlabMutationFile(base, projectId, path, branch, headers, proxy, condition.version === null)
    if (condition.version === null ? Boolean(expected) || !content : expected?.sha !== condition.version.toLowerCase()) {
      throw new Error('SYNC_SWITCH_STALE')
    }
    const desiredVersion = content ? await gitBlobVersion(content, expected?.sha.length) : undefined
    const body = JSON.stringify({ branch, commit_message: `Sync: ${path}`, last_commit_id: expected?.lastCommitId,
      ...(content ? { content: encodeRemoteFileContent(content), encoding: 'base64' } : {}) })
    const response = await recoverRemoteMutation({ beforeWrite,
      send: () => fetch(url, {
        method: content ? condition.version === null ? 'POST' : 'PUT' : 'DELETE',
        headers: new Headers(headers), proxy, body,
      }),
      reconcile: () => reconcileGitlabMutation(base, projectId, path, branch, headers, proxy, expected, desiredVersion),
    })
    // GitLab uses 400 for an existing create target or a changed last_commit_id.
    if (response.status === 400) throw new Error('SYNC_SWITCH_STALE')
    assertConditionalResponse(response, condition)
    return true
  })
}
