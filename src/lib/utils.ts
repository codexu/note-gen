import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from '@tauri-apps/api/path';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function convertImage(path: string) {
  const appDataDirPath = await appDataDir()
  const imagePath = appDataDirPath + path
  return convertFileSrc(imagePath)
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
    md.scroll(0, md.scrollHeight)
  }
}