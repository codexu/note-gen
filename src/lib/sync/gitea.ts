import { withGitRepoWriteLock } from './git-repo-write-lock'
import { assertConditionalResponse } from './write-condition'
import { fetchRemoteRead, recoverRemoteMutation } from './remote-mutation-recovery'
import { gitBlobVersion } from './remote-content-cache'
import { syncStaleError } from './sync-stale-error'
import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http';
import { fetch as encodeFetch } from './encode-fetch'
import { buildRemoteLogicalPath, buildRepoContentPath, debugSyncPath, readSyncResponseJson, encodeRemoteFileContent, decodeBase64ToBytes } from './remote-file'
import { 
  GiteaInstanceType, 
  GiteaRepositoryInfo, 
  GITEA_INSTANCES, 
  GiteaError,
  GiteaUserInfo,
  GiteaCommit,
  GiteaResponse,
  GiteaDirectoryItem,
  GiteaFileContent
} from './gitea.types';
import { parseDirectoryEntries, readDirectoryResponse, readGitTreeDirectory, remoteRecord, type RemoteDirectoryEntry } from './directory-listing'

// 获取 Gitea 实例的 API 基础 URL

function resolveUploadPath(path: string | undefined, filename: string | undefined, fallbackFilename: string) {
  if (filename) {
    return buildRemoteLogicalPath({ path, filename })
  }

  return path?.replace(/^\/+|\/+$/g, '') || fallbackFilename
}

export async function getGiteaApiBaseUrl(): Promise<string> {
  const store = await Store.load('store.json');
  const instanceType = await store.get<GiteaInstanceType>('giteaInstanceType') || GiteaInstanceType.OFFICIAL;

  if (instanceType === GiteaInstanceType.SELF_HOSTED) {
    let customUrl = await store.get<string>('giteaCustomUrl') || '';
    // 移除末尾的斜杠，避免双斜杠问题
    customUrl = customUrl.replace(/\/+$/, '').trim();

    // 验证自定义 URL 是否有效
    if (!customUrl) {
      throw new Error('自建 Gitea 实例的 URL 未配置，请先在设置中填写 Gitea URL');
    }

    // 确保 URL 包含协议
    if (!customUrl.startsWith('http://') && !customUrl.startsWith('https://')) {
      customUrl = 'http://' + customUrl;
    }

    return `${customUrl}/api/v1`;
  }

  const instance = GITEA_INSTANCES[instanceType];
  return `${instance.baseUrl}/api/v1`;
}

// 获取通用请求头
async function getCommonHeaders(): Promise<any> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteaAccessToken');

  if (!accessToken) {
    throw new Error('Gitea Access Token 未配置');
  }

  const headers = {
    "Content-Type": 'application/json;charset=utf-8',
    "Authorization": `token ${accessToken}`,
  };

  return headers;
}

// 获取代理配置
async function getProxyConfig(): Promise<Proxy | undefined> {
  const store = await Store.load('store.json');
  const proxyUrl = await store.get<string>('proxy');
  return proxyUrl ? { all: proxyUrl } : undefined;
}

async function giteaMutationBranch(baseUrl: string, headers: HeadersInit, proxy?: Proxy, allowEmpty = false) {
  const repository = remoteRecord(await readDirectoryResponse(await fetchRemoteRead(baseUrl, { headers: new Headers(headers), proxy })))
  if (typeof repository.default_branch !== 'string' || !repository.default_branch.trim()) {
    if (allowEmpty && (repository.default_branch == null || typeof repository.default_branch === 'string')) {
      const branches = await readDirectoryResponse(await fetchRemoteRead(`${baseUrl}/branches?limit=1`, { headers: new Headers(headers), proxy }))
      if (Array.isArray(branches) && !branches.length) return ''
    }
    throw new Error('Remote repository has no default branch')
  }
  return repository.default_branch.trim()
}

async function readGiteaMutationFile(baseUrl: string, path: string, branch: string, headers: HeadersInit, proxy?: Proxy) {
  const read = async (resource: string) => remoteRecord(await readDirectoryResponse(
    await fetchRemoteRead(`${baseUrl}${resource}`, { headers: new Headers(headers), proxy })))
  const branchCommit = remoteRecord((await read(`/branches/${encodeURIComponent(branch)}`)).commit)
  const head = branchCommit.id ?? branchCommit.sha
  if (typeof head !== 'string' || !/^[a-f0-9]{40}$/i.test(head)) throw new Error('Invalid Gitea branch version')
  const commit = await read(`/git/commits/${head}`)
  const root = remoteRecord(commit.tree).sha
  if (commit.sha !== head || typeof root !== 'string' || !/^[a-f0-9]{40}$/i.test(root)) throw new Error('Invalid Gitea commit tree')
  const parent = path.split('/').slice(0, -1).join('/')
  const files = await readGitTreeDirectory(parent,
    async resource => {
      const tree: unknown[] = []
      let total: number | undefined
      for (let page = 1; ; page++) {
        const data = await read(`${resource}?per_page=100&page=${page}`)
        if (data.truncated === true || !Array.isArray(data.tree) || typeof data.total_count !== 'number'
          || !Number.isSafeInteger(data.total_count) || data.total_count < tree.length + data.tree.length
          || (total !== undefined && total !== data.total_count)) {
          throw new Error('Incomplete Gitea tree')
        }
        total = data.total_count
        tree.push(...data.tree)
        if (tree.length === data.total_count) break
        if (!data.tree.length) throw new Error('Incomplete Gitea tree')
      }
      return new Response(JSON.stringify({ tree, truncated: false }), { status: 200 })
    }, undefined, root)
  return files.find(file => file.path === path)
}

async function reconcileGiteaMutation(
  baseUrl: string, path: string, branch: string, headers: HeadersInit, proxy: Proxy | undefined,
  expectedVersion: string | null, desiredVersion?: string,
) {
  const resolvedBranch = branch || await giteaMutationBranch(baseUrl, headers, proxy)
  const current = await readGiteaMutationFile(baseUrl, path, resolvedBranch, headers, proxy)
  if (desiredVersion ? current?.type === 'file' && current.sha.toLowerCase() === desiredVersion : !current) {
    return { state: 'applied' as const, value: new Response(JSON.stringify({ content: current || null }), { status: 200 }) }
  }
  // A first create may leave branch selection to the empty repository. Without
  // a captured branch, recovery can confirm its bytes but must never resend it.
  if (!branch) throw new Error('Remote creation result could not be confirmed')
  if (expectedVersion === null ? !current : current?.type === 'file' && current.sha.toLowerCase() === expectedVersion.toLowerCase()) {
    return { state: 'unchanged' as const }
  }
  throw syncStaleError({ stage: 'apply', path, source: 'remote', check: 'version',
    expected: { sha: expectedVersion, exists: expectedVersion !== null },
    actual: current ? { sha: current.sha, exists: true } : { exists: false } })
}

/**
 * 上传文件到 Gitea 仓库
 * @param params 上传参数
 */
export async function uploadFile({
  file,
  filename,
  sha,
  message,
  repo,
  path,
  guarded = false,
  beforeWrite
}: {
  file: string | Uint8Array;
  filename?: string;
  sha?: string;
  message?: string;
  repo: string;
  path?: string;
  guarded?: boolean;
  beforeWrite?: () => Promise<void>;
}) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');

    if (!giteaUsername) {
      throw new Error('Gitea 用户名未配置');
    }

    const id = uuid();
    const targetPath = resolveUploadPath(path, filename, id)
    const normalizedPath = buildRepoContentPath({ path: targetPath })
    debugSyncPath('gitea.uploadFile', {
      inputPath: path,
      filename,
      targetPath,
      normalizedPath,
      hasSha: Boolean(sha),
    })

    // 将内容转换为 Base64（Gitea API 要求）
    const base64Content = encodeRemoteFileContent(file)

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const requestBody: any = {
      content: base64Content,
      message: message || `Upload ${filename || id}`,
      // 设置提交时间为当前时间
      dates: {
        author: new Date().toISOString(),
        committer: new Date().toISOString()
      }
    };

    // 如果是更新文件，需要添加 sha
    if (sha) {
      requestBody.sha = sha;
    }

    const repoUrl = `${baseUrl}/repos/${encodeURIComponent(giteaUsername)}/${encodeURIComponent(repo)}`
    const url = `${repoUrl}/contents/${normalizedPath}`;
    // Gitea API: POST 创建新文件，PUT 更新现有文件
    const method = sha ? 'PUT' : 'POST';

    return await withGitRepoWriteLock(baseUrl, `${giteaUsername}/${repo}`, async () => {
      const branch = await giteaMutationBranch(repoUrl, headers, proxy, !sha)
      const desiredVersion = await gitBlobVersion(decodeBase64ToBytes(base64Content), sha?.length)
      const body = JSON.stringify({ ...requestBody, branch: branch || undefined })
      const response = await recoverRemoteMutation({ beforeWrite,
        send: () => fetch(url, { method, headers: new Headers(headers), body, proxy }),
        reconcile: () => reconcileGiteaMutation(repoUrl, targetPath, branch, headers, proxy, sha || null, desiredVersion),
      });

      if (guarded) assertConditionalResponse(response, { version: sha || null });
      if (response.status >= 200 && response.status < 300) {
        const data = await response.json();
        return { data } as GiteaResponse<any>;
      }

      if (response.status === 400) {
        return null;
      }

      // 422 表示文件已存在（需要 SHA 才能更新），返回 null 以便触发重试
      if (response.status === 422) {
        return null;
      }

      // 404 表示文件不存在，尝试用 POST 创建新文件
      if (response.status === 404) {
        const postMethod = 'POST';
        const postBody = { ...requestBody, branch: branch || undefined };
        delete postBody.sha; // POST 不需要 sha
        if (await readGiteaMutationFile(repoUrl, targetPath, branch, headers, proxy)) throw new Error('SYNC_SWITCH_STALE')
        const postResponse = await recoverRemoteMutation({ beforeWrite,
          send: () => fetch(url, { method: postMethod, headers: new Headers(headers), body: JSON.stringify(postBody), proxy }),
          reconcile: () => reconcileGiteaMutation(repoUrl, targetPath, branch, headers, proxy, null, desiredVersion),
        });

        if (postResponse.status >= 200 && postResponse.status < 300) {
          const data = await postResponse.json();
          return { data } as GiteaResponse<any>;
        }

        const postErrorData = await postResponse.json();
        throw {
          status: postResponse.status,
          message: postErrorData.message || '同步失败'
        } as GiteaError;
      }

      const errorData = await response.json();
      throw {
        status: response.status,
        message: errorData.message || '同步失败'
      } as GiteaError;

    })
  } catch (error) {
    if (guarded) throw error
    toast({
      title: '同步失败',
      description: (error as GiteaError).message || '上传文件时发生错误',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 更新文件内容（获取文件 sha 后上传）
 * @param params 更新参数
 */
export async function updateFileContent({
  path,
  repo,
  content,
  message
}: {
  path: string;
  repo: string;
  content: string;
  message?: string;
}) {
  try {
    // 先获取文件信息，获取 sha
    const fileInfo = await getFiles({ path, repo });
    // getFiles 可能返回数组（目录）或对象（文件），需要检查类型
    const sha = fileInfo && !Array.isArray(fileInfo) ? fileInfo.sha : undefined;

    // 调用 uploadFile 上传文件
    return await uploadFile({
      file: content,
      filename: path.split('/').pop() || path,
      sha,
      message: message || `Update ${path}`,
      repo,
      path: path.substring(0, path.lastIndexOf('/'))
    });
  } catch (error) {
    toast({
      title: '更新文件失败',
      description: (error as GiteaError).message || '更新文件时发生错误',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 获取 Gitea 仓库文件列表
 * @param params 查询参数
 */
export async function getDirectoryFiles({ path, repo }: { path: string; repo: string }): Promise<RemoteDirectoryEntry[]> {
  const store = await Store.load('store.json')
  const username = await store.get<string>('giteaUsername')
  if (!username) throw new Error('Gitea sync is not configured')
  const baseUrl = await getGiteaApiBaseUrl()
  const headers = await getCommonHeaders()
  const proxy = await getProxyConfig()
  const url = `${baseUrl}/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/contents/${buildRepoContentPath({ path })}`
  const response = await fetch(url, { method: 'GET', headers, proxy })
  if (response.status === 404 && !path) {
    const repository = await readDirectoryResponse(await fetch(`${baseUrl}/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`, { method: 'GET', headers, proxy }))
    if (repository && typeof repository === 'object' && 'empty' in repository && repository.empty === true) return []
  }
  if (response.status === 404 && path) {
    await getDirectoryFiles({ path: '', repo })
    return []
  }
  return parseDirectoryEntries(await readDirectoryResponse(response))
}

export async function getFiles({ path, repo, sha }: { path: string; repo: string; sha?: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');

    if (!giteaUsername) {
      return null;
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 对路径进行 URL 编码，处理特殊字符
    const encodedPath = buildRepoContentPath({ path });
    debugSyncPath('gitea.getFiles', {
      inputPath: path,
      encodedPath,
      sha,
    })
    // Gitea API 使用 sha 参数来获取特定 commit/branch 的文件内容
    const shaParam = sha ? `?sha=${sha}` : '';
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}${shaParam}`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await readSyncResponseJson(response, `gitea / ${path}`);

      // 如果是单个文件，返回文件信息（包含 content）
      if (!Array.isArray(data)) {
        return {
          name: data.name,
          path: data.path,
          type: data.type === 'dir' ? 'dir' : 'file',
          sha: data.sha,
          content: data.content || '', // 文件内容（base64）
        };
      }

      // 如果是目录，返回文件列表
      return data.map((item: GiteaDirectoryItem) => {
        return {
          name: item.name,
          path: item.path,
          type: item.type === 'dir' ? 'dir' : 'file',
          sha: item.sha,
        }
      })
    }

    // 文件或目录不存在，返回 null
    if (response.status === 404) {
      return null
    }

    throw new Error(`gitea / ${path}: HTTP ${response.status}`)

  } catch (error) {
    throw error
  }
}

/**
 * 删除 Gitea 仓库文件
 * @param params 删除参数
 */
export async function deleteFile({ path, sha, repo, guarded = false, beforeWrite }: { path: string; sha?: string; repo: string; guarded?: boolean; beforeWrite?: () => Promise<void> }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('用户名未配置');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const encodedPath = buildRepoContentPath({ path, preserveWhitespace: true })

    // 如果没有 sha，先获取文件信息
    return await withGitRepoWriteLock(baseUrl, `${giteaUsername}/${repo}`, async () => {
      const repoUrl = `${baseUrl}/repos/${encodeURIComponent(giteaUsername)}/${encodeURIComponent(repo)}`
      const branch = await giteaMutationBranch(repoUrl, headers, proxy)
      const logicalPath = buildRemoteLogicalPath({ path, preserveWhitespace: true }).split('/').filter(Boolean).join('/')
      let fileSha = sha;
      if (!fileSha) {
        const current = await readGiteaMutationFile(repoUrl, logicalPath, branch, headers, proxy)
        if (!current) return true
        if (current.type !== 'file') throw new Error('SYNC_SWITCH_STALE')
        fileSha = current.sha
      }
      const expectedVersion = fileSha
      const url = `${repoUrl}/contents/${encodedPath}`;
      const body = JSON.stringify({ message: `Delete ${path}`, sha: expectedVersion, branch })
      const response = await recoverRemoteMutation({ beforeWrite,
        send: () => fetch(url, { method: 'DELETE', headers: new Headers(headers), body, proxy }),
        reconcile: () => reconcileGiteaMutation(repoUrl, logicalPath, branch, headers, proxy, expectedVersion),
      });

      if (guarded) assertConditionalResponse(response, { version: sha || null });
      if (response.status >= 200 && response.status < 300) {
        return true
      }

      const errorData = await response.json();
      throw {
        status: response.status,
        message: errorData.message || '删除文件失败'
      } as GiteaError;

    })
  } catch (error) {
    if (guarded) throw error
    toast({
      title: '删除文件失败',
      description: (error as GiteaError).message || '删除文件时发生错误',
      variant: 'destructive',
    });
    return null; // 确保在错误情况下也有返回值
  }
}

/**
 * 获取文件提交历史
 * @param params 查询参数
 */
export async function getFileCommits({ path, repo }: { path: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      return false;
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // Gitea API 需要指定分支（sha 参数），默认使用 main 分支
    // 对 path 进行编码，避免特殊字符导致 404
    const encodedPath = encodeURIComponent(path);
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/commits?sha=main&path=${encodedPath}&per_page=100`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GiteaCommit[];
      return { data } as GiteaResponse<GiteaCommit[]>;
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
/**
 * 获取特定 commit 的文件内容（通过 Git tree API）
 * @param params 查询参数
 */
export async function getFileContentFromCommit({ path, ref, repo }: { path: string; ref: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');

    if (!giteaUsername) {
      throw new Error('用户名未配置');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 先获取 commit 信息，获取 tree SHA
    const commitUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/git/commits/${ref}`;

    const commitResponse = await fetch(commitUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (!commitResponse.ok) {
      return null;
    }

    const commitData = await commitResponse.json();
    // tree SHA 在 commit.tree.sha
    const treeSha = commitData.commit?.tree?.sha || commitData.tree?.sha;

    if (!treeSha) {
      return null;
    }

    // 获取文件在 tree 中的路径
    const treeUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/git/trees/${treeSha}?recursive=1`;

    const treeResponse = await fetch(treeUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (!treeResponse.ok) {
      return null;
    }

    const treeData = await treeResponse.json();
    // 查找目标文件
    const fileEntry = treeData.tree?.find((item: any) => item.path === path);

    if (!fileEntry || fileEntry.type !== 'blob') {
      return null;
    }

    // 获取文件内容
    const blobUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/git/blobs/${fileEntry.sha}`;

    const blobResponse = await fetch(blobUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (!blobResponse.ok) {
      return null;
    }

    const blobData = await blobResponse.json();

    return {
      content: blobData.content || '',
      encoding: blobData.encoding || 'base64'
    };

  } catch {
    return null;
  }
}

export async function getFileContent({ path, ref, repo }: { path: string; ref?: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('用户名未配置');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 获取特定 commit 的文件内容，对 path 进行编码
    // 与 getFiles 保持一致：对每个路径部分分别进行编码
    const encodedPath = buildRepoContentPath({ path });
    debugSyncPath('gitea.getFileContent', {
      inputPath: path,
      encodedPath,
      ref,
    })
    // Gitea API 使用 sha 参数而不是 ref 参数来获取特定 commit 的文件内容
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}${ref ? `?sha=${encodeURIComponent(ref)}` : ''}`;

    const response = await encodeFetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await readSyncResponseJson(response, `gitea / ${path}`) as GiteaFileContent;
      return {
        content: data.content || '',
        encoding: data.encoding || 'base64'
      };
    }

    if (response.status === 404) return null

    throw new Error(`gitea / ${path}: HTTP ${response.status}`)

  } catch (error) {
    throw error
  }
}

/**
 * 获取 Gitea 用户信息
 * @param token 可选的访问令牌
 */
export async function getUserInfo(token?: string): Promise<GiteaUserInfo> {
  try {
    const store = await Store.load('store.json');
    const accessToken = token || await store.get<string>('giteaAccessToken');
    
    if (!accessToken) {
      throw new Error('访问令牌未配置');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const proxy = await getProxyConfig();

    const headers = new Headers();
    headers.append('Authorization', `token ${accessToken}`);
    headers.append('Content-Type', 'application/json');

    const response = await fetch(`${baseUrl}/user`, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const userInfo = await response.json() as GiteaUserInfo;
      
      // 保存用户名到存储
      await store.set('giteaUsername', userInfo.login);
      await store.save();
      
      return userInfo;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '获取用户信息失败'
    } as GiteaError;

  } catch (error) {
    toast({
      title: '获取用户信息失败',
      description: (error as GiteaError).message || '获取用户信息时发生错误',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 检查同步仓库状态
 * @param name 仓库名称
 */
export async function checkSyncRepoState(name: string): Promise<GiteaRepositoryInfo | null> {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('用户名未配置');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 直接尝试获取仓库信息
    const repoUrl = `${baseUrl}/repos/${giteaUsername}/${name}`;
    
    const response = await fetch(repoUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const repo = await response.json() as GiteaRepositoryInfo;
      return repo;
    }

    if (response.status === 404) {
      return null;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '检查仓库状态失败'
    } as GiteaError;

  } catch (error) {
    throw error;
  }
}

export async function listUserRepositories(): Promise<string[]> {
  const store = await Store.load('store.json')
  const username = await store.get<string>('giteaUsername')
  const baseUrl = await getGiteaApiBaseUrl()
  const headers = await getCommonHeaders()
  const proxy = await getProxyConfig()
  const response = await fetch(`${baseUrl}/user/repos?limit=100`, {
    method: 'GET',
    headers,
    proxy,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`获取仓库列表失败: ${response.status}`)
  }

  const repositories = await response.json() as GiteaRepositoryInfo[]
  return repositories
    .filter(repository => !username || repository.owner.login === username)
    .map(repository => repository.name)
    .filter(Boolean)
}

/**
 * 创建同步仓库
 * @param name 仓库名称
 * @param isPrivate 是否私有仓库
 */
export async function createSyncRepo(name: string, isPrivate: boolean = true): Promise<GiteaRepositoryInfo | null> {
  try {
    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const requestBody = {
      name: name,
      description: `note-gen 同步仓库 - ${name}`,
      private: isPrivate,
      auto_init: true,
      default_branch: 'main'
    };

    const response = await fetch(`${baseUrl}/user/repos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const repo = await response.json() as GiteaRepositoryInfo;
      return repo;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '创建仓库失败'
    } as GiteaError;

  } catch (error) {
    toast({
      title: '创建仓库失败',
      description: (error as GiteaError).message || '创建仓库时发生错误',
      variant: 'destructive',
    });
    return null;
  }
}
