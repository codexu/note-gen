'use client'
import { Store } from '@tauri-apps/plugin-store'
import { useRouter  } from 'next/navigation'
import { useEffect } from 'react'
import { isMobileDevice } from '@/lib/check'

export default function Home() {
  const router = useRouter()
  async function init() {
    const store = await Store.load('store.json')
    let currentPage = await store.get<string>('currentPage')
    
    if (isMobileDevice()) {
      // 移动端逻辑
      if (currentPage?.includes('/mobile')) {
        router.push(currentPage || '/mobile/chat')
      } else {
        router.push('/mobile/chat')
      }
    } else {
      // PC 端逻辑：将旧路径重定向到新的 /core/main
      if (currentPage === '/core/article' || currentPage === '/core/record') {
        currentPage = '/core/main'
        await store.set('currentPage', '/core/main')
        await store.save()
      }
      
      if (!currentPage?.includes('/mobile')) {
        router.push(currentPage || '/core/main')
      } else {
        router.push('/core/main')
      }
    }
  }
  useEffect(() => {
    init()
  }, [])
}
