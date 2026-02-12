import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from '@tauri-apps/api/path';
import { getWorkspacePath } from "./workspace";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function convertImage(path: string) {
  const appDataDirPath = await appDataDir()
  const imagePath = appDataDirPath + path
  return convertFileSrc(imagePath)
}

export async function convertImageByWorkspace(path: string) {
  const workspace = await getWorkspacePath()
  let fullPath: string
  if (workspace.isCustom) {
    fullPath = `${workspace.path}/${path}`
  } else {
    fullPath = `${await appDataDir()}/article/${path}`
  }
  return convertFileSrc(fullPath)
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