'use client'
import { clear, hasImage, hasText, readImageBase64, readText } from "tauri-plugin-clipboard-api";
import { useEffect, useRef } from 'react';
import { BaseDirectory, exists, mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { v4 as uuid } from "uuid";
import useChatStore from "@/stores/chat";
import useTagStore from "@/stores/tag";
import { Store } from "@tauri-apps/plugin-store";

export function ClipboardListener() {
  const { insert, chats, loading } = useChatStore()
  const chatsRef = useRef(chats)
  const { currentTagId } = useTagStore()

  async function readHandler() {
    const store = await Store.load('store.json')
    const isEnabled = await store.get<boolean>('clipboardMonitor')
    if (!isEnabled) return
    if (loading) return
    const hasImageRes = await hasImage()
    const hasTextRes = await hasText()

    if (hasImageRes) {
      await handleImage()
    } else if (hasTextRes) {
      await handleText()
    }
  }

  async function handleImage() {
    const isClipboardFolderExists = await exists('clipboard', { baseDir: BaseDirectory.AppData})
    if (!isClipboardFolderExists) {
      await mkdir('clipboard', { baseDir: BaseDirectory.AppData })
    }
    const image = await readImageBase64()
    const uint8Array = Uint8Array.from(atob(image), c => c.charCodeAt(0)) || new Uint8Array()
    const path = `clipboard/${uuid()}.png`
    await writeFile(path, uint8Array, { baseDir: BaseDirectory.AppData })
    await clear()
    await insert({
      role: 'system',
      content: '',
      type: 'clipboard',
      image: `/${path}`,
      tagId: currentTagId,
      inserted: false
    })
  }

  async function handleText() {
    const text = await readText()
    const chatsContent = chatsRef.current.map(item => item.content)
    if (!chatsContent.includes(text)) {
      await insert({
        role: 'system',
        content: text,
        type: 'clipboard',
        tagId: currentTagId,
        inserted: false
      })
    }
  }

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]); 

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    
    async function initListen() {
      unlisten = await listen('tauri://focus', readHandler)
    }
    initListen()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  return <></>
}