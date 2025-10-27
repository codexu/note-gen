import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { GithubError, GithubRepoInfo, OctokitResponse } from './github.types';
import { fetch, Proxy } from '@tauri-apps/plugin-http'

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

export function decodeBase64ToString(str: string){
  return decodeURIComponent(atob(str).split('').map(function (c) {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
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

export async function uploadFile(
  { ext, file, filename, sha, message, repo, path }:
  { ext: string, file: string, filename?: string, sha?: string, message?: string, repo: string, path?: string }) 
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
    let _filename = ''
    if (filename) {
      _filename = `${filename}`
    } else {
      _filename = `${id}.${ext}`
    }
    // 将空格转换成下划线
    _filename = encodeURIComponent(_filename.replace(/\s/g, '_'))
    const _path = path ? `/${path}`: ''
    
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
        content: file,
        sha
      }),
      proxy
    };
    
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents${_path}/${_filename}`;
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

export async function getFiles({ path, repo }: { path: string, repo: string }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  if (!accessToken) return;
  
  const githubUsername = await store.get('githubUsername')
  path = encodeURIComponent(path.replace(/\s/g, '_'))
  
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
    
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents/${path}`;
    
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
    
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents/${encodeURIComponent(path)}`;
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
    }
    throw new Error('删除文件失败');
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
  path = encodeURIComponent(path.replace(/\s/g, '_'))
  
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
    
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/commits?path=${path}`;
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
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
  
  return false
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
export async function getRelease() {
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
    headers.append('If-None-Match', '');
    
    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };
    
    const url = `https://api.github.com/repos/codexu/note-gen/releases/latest`;
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
    }
    
    throw new Error('获取 release 失败');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}
