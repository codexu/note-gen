'use client'
import { Store } from '@tauri-apps/plugin-store'
import { redirect } from 'next/navigation'
import { useEffect } from 'react'
import { isMobileDevice } from '@/lib/check'

export default function Home() {
  async function init() {
    const store = await Store.load('store.json')
    const currentPage = await store.get<string>('currentPage')
    if (isMobileDevice()) {
      redirect('/mobile/chat')
    } else {
      redirect(currentPage || '/core/record')
    }
  }
  useEffect(() => {
    init()
  }, [])
}