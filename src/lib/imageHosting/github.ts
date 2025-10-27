import { Store } from "@tauri-apps/plugin-store";
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { GithubError, GithubRepoInfo } from "../sync/github.types";
import { toast } from '@/hooks/use-toast';
import { v4 as uuid } from 'uuid';
import { fileToBase64 } from "../sync/github";
import { getImageRepoName } from "../sync/repo-utils";

// 创建 Github 图床仓库
export async function createImageRepo(name: string, isPrivate?: boolean) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('githubImageAccessToken')
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

// 检查 Github 仓库
export async function checkImageRepoState(name: string) {
  const store = await Store.load('store.json');
  const githubUsername = await store.get('githubImageUsername')
  const accessToken = await store.get('githubImageAccessToken')
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

export async function uploadImageByGithub(file: File) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('githubImageAccessToken')
  const username = await store.get('githubImageUsername')
  const id = uuid()

  // 获取代理设置
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    const ext = file.type.split('/')[1]
    const filename = `${id}.${ext}`.replace(/\s/g, '_')
    
    // 获取实际使用的仓库名（自定义或默认）
    const repoName = await getImageRepoName()
    
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('Content-Type', 'application/json');

    const content = (await fileToBase64(file)).replace('data:application/octet-stream;base64,', '')
    
    const requestOptions = {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Upload ${filename}`,
        content,
        sha: '',
      }),
      proxy
    };
    
    const url = `https://api.github.com/repos/${username}/${repoName}/contents/${filename}`;
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();

      const store = await Store.load('store.json');
      const jsdelivr = await store.get('jsdelivr')
      let url = data.content.download_url
      if (jsdelivr) {
        await fetch(`https://purge.jsdelivr.net/gh/${username}/${repoName}@main/${data.content.name}`)
        url = `https://cdn.jsdelivr.net/gh/${username}/${repoName}@main/${data.content.name}`
      }
      return url
    }
    
    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Upload image failed'
    };
  } catch (error) {
    toast({
      title: 'Upload image failed',
      description: (error as GithubError).message,
      variant: 'destructive',
    })
  }
}

export async function getImageFiles({ path }: { path: string }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('githubImageAccessToken')
  if (!accessToken) return;
  
  const githubImageUsername = await store.get('githubImageUsername')
  path = path.replace(/\s/g, '_')
  
  // 获取实际使用的仓库名（自定义或默认）
  const repoName = await getImageRepoName()
  
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
    
    const url = `https://api.github.com/repos/${githubImageUsername}/${repoName}/contents/${path}`;
    
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