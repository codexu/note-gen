import { toast } from '@/hooks/use-toast';
import { Octokit } from '@octokit/core'
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { RepoNames } from './github.types';

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
  { ext, file, filename, sha, message, repo }:
  { ext: string, file: string, filename?: string, sha?: string, message?: string, repo: RepoNames }) 
{
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  const octokit = new Octokit({
    auth: accessToken
  })
  const githubUsername = await store.get('githubUsername')
  try {
    let _filename = ''
    if (filename) {
      _filename = `${filename}`
    } else {
      _filename = `${uuid()}.${ext}`
    }
    // 将空格转换成下划线
    _filename = _filename.replace(/\s/g, '_')
    const res = await octokit.request(`PUT /repos/${githubUsername}/${repo}/contents/${_filename}`, {
      message: message || `Upload ${filename}`,
      content: file,
      sha,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      },
    })
    return res;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    toast({
      title: '上传失败',
      description: '请检查网络或配置是否正确。',
      variant: 'destructive',
    })
  }
}

export async function getFiles({ path, repo }: { path: string, repo: RepoNames }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  const octokit = new Octokit({
    auth: accessToken
  })
  const githubUsername = await store.get('githubUsername')
  path = path.replace(/\s/g, '_')
  try {
    const res = await octokit.request(`GET /repos/${githubUsername}/${repo}/contents/${path}`, {
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
        'If-None-Match': ''
      }
    })
    return res.data;
  } catch (error) {
    console.log(error);
    toast({
      title: '同步失败',
      description: '请检查网络或配置是否正确。',
      variant: 'destructive',
    })
    return [];
  }
}

export async function deleteFile({ path, sha, repo }: { path: string, sha: string, repo: RepoNames }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  const octokit = new Octokit({
    auth: accessToken
  })
  const githubUsername = await store.get('githubUsername')
  try {
    const res = await octokit.request(`DELETE /repos/${githubUsername}/${repo}/contents/${path}`, {
      sha,
      message: `Delete ${path}`,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    return res.data;
  } catch (error) {
    console.log(error);
    return false
  }
}

export async function getFileCommits({ path, repo }: { path: string, repo: RepoNames }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  const octokit = new Octokit({
    auth: accessToken
  })
  const githubUsername = await store.get('githubUsername')
  path = path.replace(/\s/g, '_')
  try {
    const res = await octokit.request(`GET /repos/${githubUsername}/${repo}/commits?path=${path}`, {
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
        'If-None-Match': ''
      }
    })
    return res.data;
  } catch (error) {
    console.log(error);
    return false
  }
}

// 获取 Github 用户信息
export async function getUserInfo() {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  const octokit = new Octokit({
    auth: accessToken
  })
  try {
    const res = await octokit.request(`GET /user`, {
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      }
    })
    return res;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false;
  }
}

// 检查 Github 仓库
export async function checkyncRepo(name: string) {
  const store = await Store.load('store.json');
  const githubUsername = await store.get('githubUsername')
  const accessToken = await store.get('accessToken')
  const octokit = new Octokit({
    auth: accessToken
  })
  return octokit.request(`Get /repos/${githubUsername}/${name}`)
}

// 创建 Github 仓库
export async function createSyncRepo(name: string) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  const octokit = new Octokit({
    auth: accessToken
  })
  const res = await octokit.request(`POST /user/repos`, {
    name,
    description: 'This is a NoteGen sync repository.',
  })
  .then(() => {
    toast({
      title: '仓库创建成功',
      description: `仓库名：${name}`,
    })
  })
  .catch(error => {
    return error.response.status
  })
  
  return res;
}