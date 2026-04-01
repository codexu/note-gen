import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http';
import { fetch as encodeFetch } from './encode-fetch'
import { buildRepoContentPath } from './remote-file'
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
  path
}: {
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
    // path 可能是完整路径（如 "视频文案/03_免费的笔记同步方案.md"）
    // 也可能是目录路径（如 "视频文案"）
    // filename 是文件名（如 "03_免费的笔记同步方案.md"）

    // 从 path 中分离目录和文件名
    let dirPath: string;
    let _filename: string;

    if (path) {
      const lastSlashIndex = path.lastIndexOf('/');
      if (lastSlashIndex > 0) {
        // path 包含目录和文件名
        dirPath = path.substring(0, lastSlashIndex);
        _filename = filename || path.substring(lastSlashIndex + 1);
      } else if (lastSlashIndex === -1 && path) {
        // path 是纯目录名（如 .settings），filename 单独传
        dirPath = path;
        _filename = filename || id;
      } else {
        // path 为空
        dirPath = '';
        _filename = filename || id;
      }
    } else {
      dirPath = '';
      _filename = filename || id;
    }

    // 将空格转换成下划线
    _filename = _filename.replace(/\s/g, '_');
    // 对文件名进行编码
    const encodedFilename = encodeURIComponent(_filename);

    // 组合完整路径
    let normalizedPath: string;
    if (dirPath) {
      const encodedDir = dirPath.split('/').map(p => encodeURIComponent(p.replace(/\s/g, '_'))).join('/');
      normalizedPath = `${encodedDir}/${encodedFilename}`;
    } else {
      normalizedPath = encodedFilename;
    }

    // 将内容转换为 Base64（Gitea API 要求）
    const base64Content = Buffer.from(file, 'utf-8').toString('base64')

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const requestBody: any = {
      branch: 'main',
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

    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${normalizedPath}`;
    // Gitea API: POST 创建新文件，PUT 更新现有文件
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

    // 422 表示文件已存在（需要 SHA 才能更新），返回 null 以便触发重试
    if (response.status === 422) {
      return null;
    }

    // 404 表示文件不存在，尝试用 POST 创建新文件
    if (response.status === 404) {
      const postMethod = 'POST';
      const postBody = { ...requestBody };
      delete postBody.sha; // POST 不需要 sha

      const postResponse = await fetch(url, {
        method: postMethod,
        headers,
        body: JSON.stringify(postBody),
        proxy
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

  } catch (error) {
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
    const encodedPath = path.replace(/\s/g, '_').split('/').map(encodeURIComponent).join('/');
    // Gitea API 使用 sha 参数来获取特定 commit/branch 的文件内容
    const shaParam = sha ? `?sha=${sha}` : '';
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}${shaParam}`;

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
      } as GiteaError;
    }

    return null;

  } catch (error) {
    // 重新抛出已处理的错误，静默处理其他错误
    if ((error as GiteaError).status) {
      throw error;
    }
    return null;
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

    const encodedPath = buildRepoContentPath({ path, preserveWhitespace: true })

    // 如果没有 sha，先获取文件信息
    let fileSha = sha;
    if (!fileSha) {
      const fileUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}`;
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

    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}`;
    
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
    const safePath = path.replace(/\s/g, '_');
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
    const fileEntry = treeData.tree?.find((item: any) => item.path === safePath);

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

    // 获取特定 commit 的文件内容，对 path 进行编码
    // 与 getFiles 保持一致：对每个路径部分分别进行编码
    const encodedPath = path.replace(/\s/g, '_').split('/').map(encodeURIComponent).join('/');
    // Gitea API 使用 sha 参数而不是 ref 参数来获取特定 commit 的文件内容
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}?sha=${ref}`;

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
