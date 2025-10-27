import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http';
import { fetch as encodeFetch } from './encode-fetch'
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

// 获取 Gitea 实例的 API 基础 URL 
async function getGiteaApiBaseUrl(): Promise<string> {
  const store = await Store.load('store.json');
  const instanceType = await store.get<GiteaInstanceType>('giteaInstanceType') || GiteaInstanceType.OFFICIAL;
  
  if (instanceType === GiteaInstanceType.SELF_HOSTED) {
    const customUrl = await store.get<string>('giteaCustomUrl') || '';
    return `${customUrl}/api/v1`;
  }
  
  const instance = GITEA_INSTANCES[instanceType];
  return `${instance.baseUrl}/api/v1`;
}

// 获取通用请求头
async function getCommonHeaders(): Promise<any> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteaAccessToken');
  
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

/**
 * 上传文件到 Gitea 仓库
 * @param params 上传参数
 */
export async function uploadFile({
  ext,
  file,
  filename,
  sha,
  message,
  repo,
  path
}: {
  ext: string;
  file: string;
  filename?: string;
  sha?: string;
  message?: string;
  repo: string;
  path?: string;
}) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('Gitea 用户名未配置');
    }

    const id = uuid();
    let _filename = '';
    if (filename) {
      _filename = `${filename}`;
    } else {
      _filename = `${id}.${ext}`;
    }
    // 将空格转换成下划线
    _filename = _filename.replace(/\s/g, '_');
    const _path = path ? `${path}/${_filename}` : _filename;

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const requestBody: any = {
      branch: 'main',
      content: file,
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

    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${_path}`;
    const method = sha ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(requestBody),
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return { data } as GiteaResponse<any>;
    }

    if (response.status === 400) {
      return null;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '同步失败'
    } as GiteaError;

  } catch (error) {
    console.error('Gitea 上传文件失败:', error);
    toast({
      title: '同步失败',
      description: (error as GiteaError).message || '上传文件时发生错误',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 获取 Gitea 仓库文件列表
 * @param params 查询参数
 */
export async function getFiles({ path, repo }: { path: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('用户名未配置');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${path}`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      
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

    if (response.status >= 400 && response.status < 500) {
      return null
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '获取文件列表失败'
    } as GiteaError;

  } catch (error) {
    console.error('Gitea 获取文件列表失败:', error);
    toast({
      title: '获取文件列表失败',
      description: (error as GiteaError).message || '获取文件列表时发生错误',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 删除 Gitea 仓库文件
 * @param params 删除参数
 */
export async function deleteFile({ path, sha, repo }: { path: string; sha?: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('用户名未配置');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 如果没有 sha，先获取文件信息
    let fileSha = sha;
    if (!fileSha) {
      const fileUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${path}`;
      const fileResponse = await fetch(fileUrl, {
        method: 'GET',
        headers,
        proxy
      });
      
      if (fileResponse.ok) {
        const fileData = await fileResponse.json() as GiteaFileContent;
        fileSha = fileData.sha;
      }
    }

    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${path}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        branch: 'main',
        message: `Delete ${path}`,
        sha: fileSha
      }),
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      return true
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || '删除文件失败'
    } as GiteaError;

  } catch (error) {
    console.error('Gitea 删除文件失败:', error);
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
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/commits?sha=main&path=${path}`;

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
export async function getFileContent({ path, ref, repo }: { path: string; ref: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('用户名未配置');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 获取特定 commit 的文件内容
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${path}?ref=${ref}`;

    const response = await encodeFetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GiteaFileContent;
      return {
        content: data.content || '',
        encoding: data.encoding || 'base64'
      };
    }

    if (response.status >= 400 && response.status < 500) {
      return {
        content: '',
        encoding: 'base64'
      }
    }

    const errorData = await response.text();
    throw {
      status: response.status,
      message: errorData || '获取文件内容失败'
    } as GiteaError;

  } catch (error) {
    console.error('Gitea 获取文件内容失败:', error);
    toast({
      title: '获取文件内容失败',
      description: (error as GiteaError).message || '获取文件内容时发生错误',
      variant: 'destructive',
    });
    throw error;
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
    console.error('Gitea 获取用户信息失败:', error);
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
    console.error('Gitea 检查仓库状态失败:', error);
    throw error;
  }
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
    console.error('Gitea 创建仓库失败:', error);
    toast({
      title: '创建仓库失败',
      description: (error as GiteaError).message || '创建仓库时发生错误',
      variant: 'destructive',
    });
    return null;
  }
}
