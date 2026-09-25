import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { GithubError, GithubRepoInfo, OctokitResponse } from './github.types';
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { buildRepoContentPath, buildRepoContentsEndpoint, debugSyncPath, encodeRemoteFileContent } from './remote-file'
export { decodeBase64ToString } from './remote-file';

export function uint8ArrayToBase64(data: Uint8Array) {
  return Buffer.from(data).toString('base64');
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

export interface GithubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string;
  type: string;
  _links: Links;
  isNew?: boolean;
}

interface Links {
  self: string;
  git: string;
  html: string;
}

export interface GithubRelease {
  name?: string | null;
  tag_name?: string | null;
  body?: string | null;
  published_at?: string | null;
  html_url?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

interface GithubReleasesCache {
  updatedAt: number;
  releases: GithubRelease[];
}

interface GetReleasesOptions {
  forceRefresh?: boolean;
}

const GITHUB_RELEASES_CACHE_KEY = 'githubReleasesCache';
const GITHUB_RELEASES_CACHE_TTL_MS = 1000 * 60 * 30;

export async function uploadFile(
  { file, filename, sha, message, repo, path }:
  { file: string | Uint8Array, filename?: string, sha?: string, message?: string, repo: string, path?: string })
{
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  const githubUsername = await store.get('githubUsername')
  const id = uuid()
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    const contentPath = buildRepoContentPath({ path, filename })
    debugSyncPath('github.uploadFile', {
      inputPath: path,
      filename,
      contentPath,
    })

    // 将内容转换为 Base64（GitHub API 要求）
    const base64Content = encodeRemoteFileContent(file)

    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('Content-Type', 'application/json');

    const requestOptions = {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: message || `Upload ${filename || id}`,
        content: base64Content,
        sha
      }),
      proxy
    };

    const url = `https://api.github.com/repos/${githubUsername}/${repo}${buildRepoContentsEndpoint(contentPath)}`;
    const response = await fetch(url, requestOptions);

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return { data } as OctokitResponse<any>;
    }

    if (response.status === 400) {
      return null;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '同步失败'
    };
  } catch (error) {
    toast({
      title: '同步失败',
      description: (error as GithubError).message,
      variant: 'destructive',
    })
  }
}

export async function getFiles({ path, repo, ref }: { path: string, repo: string, ref?: string }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  if (!accessToken) return;

  const githubUsername = await store.get('githubUsername')

  const encodedPath = buildRepoContentPath({ path })
  debugSyncPath('github.getFiles', {
    inputPath: path,
    encodedPath,
  })

  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined

  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('If-None-Match', '');

    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };

    // 如果有 ref 参数，添加到 URL 查询参数中
    const refParam = ref ? `?ref=${ref}` : '';
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents/${encodedPath}${refParam}`;
    
    try {
      const response = await fetch(url, requestOptions);
      if (response.status >= 200 && response.status < 300) {
        const data = await response.json();
        return data;
      }
      return null;
    } catch {
      return null;
    }
  } catch (error) {
    if ((error as GithubError).status !== 404) {
      toast({
        title: '查询失败',
        description: (error as GithubError).message,
        variant: 'destructive',
      })
    }
  }
}

export async function deleteFile(
  { path, sha, repo, token, username }: 
  { path: string, sha: string, repo: string, token?: string, username?: string }
) {
  const store = await Store.load('store.json');
  const accessToken = token || await store.get('accessToken')
  if (!accessToken) return;
  
  const githubUsername = username || await store.get('githubUsername')
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('Content-Type', 'application/json');
    
    const requestOptions = {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        sha,
        message: `Delete ${path}`
      }),
      proxy
    };

    const encodedPath = buildRepoContentPath({ path, preserveWhitespace: true })
    const url = `https://api.github.com/repos/${githubUsername}/${repo}${buildRepoContentsEndpoint(encodedPath)}`;
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
    }

    throw new Error(`删除文件失败: ${response.status} ${response.statusText}`);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}

export async function getFileCommits({ path, repo }: { path: string, repo: string }) {
  if (!path) return;
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  if (!accessToken) return;

  const githubUsername = await store.get('githubUsername')

  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined

  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('If-None-Match', '');

    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };
    
    const commitPath = encodeURIComponent(path)
    debugSyncPath('github.getFileCommits', {
      inputPath: path,
      commitPath,
    })
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/commits?path=${commitPath}&per_page=100`;
    const response = await fetch(url, requestOptions);

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
    }

    if (response.status === 404) {
      return [];
    }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}

// 获取 Github 用户信息
export async function getUserInfo(token?: string) {
  const store = await Store.load('store.json');
  const accessToken = token || await store.get('accessToken')
  if (!accessToken) return;
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    
    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };
    
    const url = 'https://api.github.com/user';
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      await store.set('githubUsername', data.login);
      await store.save();
      return { data } as OctokitResponse<any>;
    }
    
    throw new Error('获取用户信息失败');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false;
  }
}

// 检查 Github 仓库
export async function checkSyncRepoState(name: string) {
  const store = await Store.load('store.json');
  const githubUsername = await store.get('githubUsername')
  const accessToken = await store.get('accessToken')
  if (!accessToken) return;
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  // 设置请求头
  const headers = new Headers();
  headers.append('Authorization', `Bearer ${accessToken}`);
  headers.append('Accept', 'application/vnd.github+json');
  headers.append('X-GitHub-Api-Version', '2022-11-28');
  
  const requestOptions = {
    method: 'GET',
    headers,
    proxy
  };
  
  const url = `https://api.github.com/repos/${githubUsername}/${name}`;
  const response = await fetch(url, requestOptions);
  
  if (response.status >= 200 && response.status < 300) {
    const data = await response.json();
    return data;
  }

  if (response.status === 404) return false

  throw new Error(`检查仓库状态失败: ${response.status}`)
}

export async function listUserRepositories(): Promise<string[]> {
  const store = await Store.load('store.json')
  const accessToken = await store.get<string>('accessToken')
  if (!accessToken) throw new Error('GitHub Access Token 未配置')

  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined
  const headers = new Headers()
  headers.append('Authorization', `Bearer ${accessToken}`)
  headers.append('Accept', 'application/vnd.github+json')
  headers.append('X-GitHub-Api-Version', '2022-11-28')

  const response = await fetch(
    'https://api.github.com/user/repos?affiliation=owner&sort=updated&per_page=100',
    { method: 'GET', headers, proxy }
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`获取仓库列表失败: ${response.status}`)
  }

  const repositories = await response.json() as GithubRepoInfo[]
  return repositories.map(repository => repository.name).filter(Boolean)
}

// 创建 Github 仓库
export async function createSyncRepo(name: string, isPrivate?: boolean) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  if (!accessToken) return;
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('Content-Type', 'application/json');
    
    const requestOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        description: 'This is a NoteGen sync repository.',
        private: isPrivate
      }),
      proxy
    };
    
    const url = 'https://api.github.com/user/repos';
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GithubRepoInfo;
      return data;
    }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return undefined;
  }
}

// 读取 release
export async function getRelease(): Promise<GithubRelease | false | undefined> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('accessToken')
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    // 设置请求头
    const headers = new Headers();
    if (accessToken) {
      headers.append('Authorization', `Bearer ${accessToken}`);
    }
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('If-None-Match', '');
    
    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };
    
    const url = `https://api.github.com/repos/codexu/note-gen/releases/latest`;
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GithubRelease;
      return data;
    }
    
    throw new Error('获取 release 失败');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}

// 读取 release 列表
export async function getReleases(options: GetReleasesOptions = {}): Promise<GithubRelease[] | false | undefined> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('accessToken')
  const cachedReleases = await store.get<GithubReleasesCache>(GITHUB_RELEASES_CACHE_KEY)

  if (
    !options.forceRefresh &&
    cachedReleases?.releases?.length &&
    Date.now() - cachedReleases.updatedAt < GITHUB_RELEASES_CACHE_TTL_MS
  ) {
    return cachedReleases.releases;
  }

  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined

  try {
    // 设置请求头
    const headers = new Headers();
    if (accessToken) {
      headers.append('Authorization', `Bearer ${accessToken}`);
    }
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('If-None-Match', '');

    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };

    const url = `https://api.github.com/repos/codexu/note-gen/releases?per_page=100`;
    const response = await fetch(url, requestOptions);

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GithubRelease[];
      await store.set(GITHUB_RELEASES_CACHE_KEY, {
        updatedAt: Date.now(),
        releases: data
      } satisfies GithubReleasesCache);
      await store.save();
      return data;
    }

    throw new Error('获取 release 列表失败');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    if (cachedReleases?.releases?.length) {
      return cachedReleases.releases;
    }

    return false
  }
}
