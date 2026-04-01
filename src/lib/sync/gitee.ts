import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { buildRepoContentPath, buildRepoContentsEndpoint, pickNestedFileEntry } from './remote-file'
export { decodeBase64ToString } from './remote-file'
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

function looksLikeFilePath(path?: string) {
  const lastSegment = path?.split('/').filter(Boolean).pop() || ''
  return lastSegment.includes('.')
}

export async function uploadFile(
  { file, filename, sha, message, repo, path }:
  { file: string, filename?: string, sha?: string, message?: string, repo: string, path?: string })
{
  const store = await Store.load('store.json');
  const accessToken = await store.get('giteeAccessToken')
  const giteeUsername = await store.get('giteeUsername')
  const id = uuid()
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    let targetPath = path
    let resolvedExistingFile: GiteeFile | null = null
    if (path) {
      const existingFile = await getFiles({ path, repo })
      if (existingFile && !Array.isArray(existingFile)) {
        resolvedExistingFile = existingFile
        targetPath = existingFile.path || path
        sha = existingFile.sha || sha
      }
    }

    const finalPath = resolvedExistingFile
      ? buildRepoContentPath({ path: targetPath })
      : targetPath
      ? buildRepoContentPath({ path: targetPath, filename })
      : buildRepoContentPath({ filename: filename || id })

    // 将内容转换为 Base64（Gitee API 要求）
    const base64Content = Buffer.from(file, 'utf-8').toString('base64')

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
        branch: 'master',
        sha
      }),
      proxy
    };

    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}${buildRepoContentsEndpoint(finalPath)}`;
    const response = await fetch(url, requestOptions);

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
          branch: 'master',
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
    toast({
      title: '同步失败',
      description: (error as GiteeError).message,
      variant: 'destructive',
    })
  }
}

export async function getFiles({ path, repo, ref }: { path: string, repo: string, ref?: string }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) return;

  const giteeUsername = await store.get<string>('giteeUsername')
  const normalizedPath = buildRepoContentPath({ path })

  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined

  try {
    // 构建 URL 参数
    let urlParams = `access_token=${accessToken}`
    if (ref) {
      urlParams += `&ref=${ref}`
    }

    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}${buildRepoContentsEndpoint(normalizedPath)}?${urlParams}`;
    
    const requestOptions = {
      method: 'GET',
      proxy
    };
    
    try {
      const response = await fetch(url, requestOptions);
      if (response.status >= 200 && response.status < 300) {
        const data = await response.json();
        if (Array.isArray(data) && looksLikeFilePath(path)) {
          const nestedFile = pickNestedFileEntry(data, path)
          if (nestedFile?.path && nestedFile.path !== path) {
            return await getFiles({ path: nestedFile.path, repo, ref })
          }
        }
        return data;
      }
      return null;
    } catch {
      return null;
    }
  } catch (error) {
    if ((error as GiteeError).status !== 404) {
      toast({
        title: '查询失败',
        description: (error as GiteeError).message,
        variant: 'destructive',
      })
    }
  }
}

export async function deleteFile({ path, sha, repo }: { path: string, sha: string, repo: string }) {
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
    params.append('access_token', accessToken);
    params.append('path', path);
    params.append('per_page', '100');
    
    const requestOptions = {
      method: 'GET',
      proxy
    };
    
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/commits?${params.toString()}`;
    
    const response = await fetch(url, requestOptions);
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
    // 设置请求参数
    const params = new URLSearchParams();
    params.append('access_token', accessToken);
    
    const requestOptions = {
      method: 'GET',
      proxy,
      // 添加超时设置
      timeout: 10000 // 10秒超时
    };
    
    const url = `https://gitee.com/api/v5/user?${params.toString()}`;
    
    const response = await fetch(url, requestOptions);
    const data = await response.json();
    
    // 保存用户名到存储
    await store.set('giteeUsername', data.login);
    
    return data;
  } catch {
    // 不显示 toast，避免在检测过程中干扰用户
    throw {
      status: 0,
      message: '获取用户信息失败'
    };
  }
}

// 检查 Gitee 仓库
export async function checkSyncRepoState(name: string) {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) {
    return;
  }
  
  const giteeUsername = await store.get<string>('giteeUsername')
  
  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    // 设置请求参数
    const params = new URLSearchParams();
    params.append('access_token', accessToken);
    
    const requestOptions = {
      method: 'GET',
      proxy,
      // 添加超时设置
      timeout: 10000 // 10秒超时
    };
    
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${name}?${params.toString()}`;
    
    const response = await fetch(url, requestOptions);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
    }
    
    throw {
      status: response.status,
      message: '仓库不存在'
    };
  } catch (error) {
    if ((error as GiteeError).status === 404) {
      return null;
    }
    throw error;
  }
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
