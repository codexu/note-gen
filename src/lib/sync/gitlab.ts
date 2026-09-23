import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http';
import { fetch as encodeFetch } from './encode-fetch'
import { buildRemoteLogicalPath, debugSyncPath, encodeRemoteFileContent } from './remote-file'
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

// 获取 Gitlab 实例的 API 基础 URL 

function resolveUploadPath(path: string | undefined, filename: string | undefined, fallbackFilename: string) {
  if (filename) {
    return buildRemoteLogicalPath({ path, filename })
  }

  return path?.replace(/^\/+|\/+$/g, '') || fallbackFilename
}

const DEFAULT_BRANCH_CACHE_TTL = 5 * 60 * 1000
const defaultBranchCache = new Map<string, { branch: string, cachedAt: number }>()

async function getDefaultBranch(repo: string) {
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

async function getGitlabApiBaseUrl(): Promise<string> {
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
  path
}: {
  file: string | Uint8Array;
  filename?: string;
  sha?: string;
  message?: string;
  repo: string;
  path?: string;
}) {
  try {
    const store = await Store.load('store.json');
    const gitlabUsername = await store.get<string>('gitlabUsername');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!gitlabUsername || !projectId) {
      throw new Error('Gitlab 用户名或项目 ID 未配置');
    }

    const branch = await getDefaultBranch(repo)
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

    const requestBody = {
      branch,
      content: base64Content,
      commit_message: message || `Upload ${filename || id}`,
      encoding: 'base64'
    };

    // 如果是更新文件，需要添加 last_commit_id
    if (sha) {
      // 获取文件的最新提交 ID
      const commitsUrl = `${baseUrl}/projects/${projectId}/repository/commits?path=${encodeURIComponent(targetPath)}&per_page=1`;
      const commitsResponse = await fetch(commitsUrl, {
        method: 'GET',
        headers,
        proxy
      });

      if (commitsResponse.ok) {
        const commits = await commitsResponse.json() as GitlabCommit[];
        if (commits.length > 0) {
          (requestBody as any).last_commit_id = commits[0].id;
        }
      }
    }

    const url = `${baseUrl}/projects/${projectId}/repository/files/${encodedTargetPath}`;

    // 首先尝试使用 Commits API 创建文件（会自动创建目录）
    // GitLab Commits API 可以通过一次 commit 创建多个文件，包括父目录
    const commitsApiUrl = `${baseUrl}/projects/${projectId}/repository/commits`;

    const commitActions = [{
      action: sha ? 'update' : 'create',
      file_path: targetPath,
      content: base64Content,
      encoding: 'base64'
    }];

    const commitBody = {
      branch,
      commit_message: message || `Upload ${filename || id}`,
      actions: commitActions
    };

    const commitResponse = await fetch(commitsApiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(commitBody),
      proxy
    });

    if (commitResponse.status >= 200 && commitResponse.status < 300) {
      const data = await commitResponse.json();
      return { data } as GitlabResponse<any>;
    }

    // 如果是 400 错误，可能文件已存在，尝试用 PUT 更新
    if (commitResponse.status === 400) {
      const commitErrorData = await commitResponse.json();

      // 检查是否是文件已存在的错误
      if (commitErrorData.error && commitErrorData.error.includes('already exists')) {
        // 获取当前文件的 SHA
        const fileUrl = `${baseUrl}/projects/${projectId}/repository/files/${encodedTargetPath}?ref=${encodeURIComponent(branch)}`;
        const fileResponse = await fetch(fileUrl, {
          method: 'GET',
          headers,
          proxy
        });

        let fileSha = '';
        if (fileResponse.ok) {
          const fileData = await fileResponse.json();
          fileSha = fileData.blob_id || fileData.sha;
        }

        // 使用 PUT 更新文件
        const putBody = {
          branch,
          content: base64Content,
          commit_message: message || `Update ${filename || id}`,
          encoding: 'base64',
          sha: fileSha
        };

        const putResponse = await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify(putBody),
          proxy
        });

        if (putResponse.status >= 200 && putResponse.status < 300) {
          const data = await putResponse.json();
          return { data } as GitlabResponse<any>;
        }

        const putErrorData = await putResponse.json();
        throw {
          status: putResponse.status,
          message: putErrorData.message || '更新文件失败'
        } as GitlabError;
      }

      throw {
        status: commitResponse.status,
        message: commitErrorData.error || '同步失败'
      } as GitlabError;
    }

    // 其他错误
    const commitErrorData = await commitResponse.json();
    throw {
      status: commitResponse.status,
      message: commitErrorData.error || commitErrorData.message || '同步失败'
    } as GitlabError;

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
export async function deleteFile({ path, repo }: { path: string; sha?: string; repo: string }) {
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

    // 获取文件的最新提交 ID，对 path 进行编码
    const encodedPath = encodeURIComponent(path);
    const commitsUrl = `${baseUrl}/projects/${projectId}/repository/commits?path=${encodedPath}&per_page=1`;
    const commitsResponse = await fetch(commitsUrl, {
      method: 'GET',
      headers,
      proxy
    });

    let lastCommitId = '';
    if (commitsResponse.ok) {
      const commits = await commitsResponse.json() as GitlabCommit[];
      if (commits.length > 0) {
        lastCommitId = commits[0].id;
      }
    }

    const url = `${baseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(path)}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        branch,
        commit_message: `Delete ${path}`,
        last_commit_id: lastCommitId
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
    } as GitlabError;

  } catch (error) {
    toast({
      title: '删除文件失败',
      description: (error as GitlabError).message || '删除文件时发生错误',
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
export async function getFileContent({ path, ref, repo }: { path: string; ref: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!projectId) {
      throw new Error('项目 ID 未配置');
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // 使用 Gitlab API 获取特定 commit 的文件内容
    const url = `${baseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}`;

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
    } as GitlabError;

  } catch (error) {
    toast({
      title: '获取文件内容失败',
      description: (error as GitlabError).message || '获取文件内容时发生错误',
      variant: 'destructive',
    });
    throw error;
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
