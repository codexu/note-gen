import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from '@tauri-apps/api/path';
import { getWorkspacePath } from "./workspace";

const RESOLVED_IMAGE_SRC_RE = /^(?:https?:|data:|blob:|asset:|tauri:|file:)/i
const HTTP_URL_RE = /^https?:\/\//i
let appDataDirPromise: Promise<string> | null = null
const convertedImageSrcCache = new Map<string, string>()
const convertedWorkspaceImageSrcCache = new Map<string, string>()

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isHttpUrl(url?: string | null) {
  return HTTP_URL_RE.test(url ?? '')
}

function normalizeAppDataAssetPath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

function getCachedAppDataDir() {
  appDataDirPromise ||= appDataDir()
  return appDataDirPromise
}

export async function convertImage(path: string) {
  if (RESOLVED_IMAGE_SRC_RE.test(path)) {
    return path
  }

  const normalizedPath = normalizeAppDataAssetPath(path)
  const cachedSrc = convertedImageSrcCache.get(normalizedPath)
  if (cachedSrc) {
    return cachedSrc
  }

  const appDataDirPath = await getCachedAppDataDir()
  const imagePath = appDataDirPath + normalizedPath
  const src = convertFileSrc(imagePath)
  convertedImageSrcCache.set(normalizedPath, src)
  return src
}

export async function convertImageByWorkspace(path: string) {
  const workspace = await getWorkspacePath()
  const cacheKey = `${workspace.isCustom ? workspace.path : 'app-data'}:${path}`
  const cachedSrc = convertedWorkspaceImageSrcCache.get(cacheKey)
  if (cachedSrc) {
    return cachedSrc
  }

  let fullPath: string
  if (workspace.isCustom) {
    fullPath = `${workspace.path}/${path}`
  } else {
    fullPath = `${await getCachedAppDataDir()}/article/${path}`
  }
  const src = convertFileSrc(fullPath)
  convertedWorkspaceImageSrcCache.set(cacheKey, src)
  return src
}

export function convertBytesToSize(bytes: number) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) {
    return '0 Bytes';
  }
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i];
}

export function arrayBuffer2String(buffer: ArrayBuffer) {
  const decoder = new TextDecoder('iso-8859-1');
  return decoder.decode(buffer);
}

export function scrollToBottom() {
  const md = document.querySelector('#chats-wrapper')
  if (md) {
    // 使用 requestAnimationFrame 确保在下一帧渲染后滚动
    requestAnimationFrame(() => {
      // 再使用 setTimeout 确保复杂内容（如代码块）已完全渲染
      setTimeout(() => {
        md.scroll(0, md.scrollHeight)
      }, 0)
    })
  }
}
