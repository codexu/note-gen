'use client'
import { Store } from '@tauri-apps/plugin-store'
import { useRouter  } from 'next/navigation'
import { useEffect } from 'react'
import { isMobileDevice } from '@/lib/check'

// 默认首页 - Tavern 页面
const DEFAULT_PAGE = '/core/tavern'

export default function Home() {
  const router = useRouter()
  async function init() {
    const store = await Store.load('store.json')
    let currentPage = await store.get<string>('currentPage')
    
    if (isMobileDevice()) {
      // 移动端逻辑 - 默认进入 Tavern
      if (currentPage?.includes('/mobile')) {
        router.push(currentPage || '/mobile/chat')
      } else {
        // 移动端也默认进入 Tavern
        router.push(DEFAULT_PAGE)
      }
    } else {
      // PC 端逻辑：将旧路径重定向到 Tavern
      if (currentPage === '/core/article' || currentPage === '/core/record' || currentPage === '/core/main') {
        currentPage = DEFAULT_PAGE
        await store.set('currentPage', DEFAULT_PAGE)
        await store.save()
      }
      
      if (!currentPage?.includes('/mobile')) {
        router.push(currentPage || DEFAULT_PAGE)
      } else {
        router.push(DEFAULT_PAGE)
      }
    }
  }
  useEffect(() => {
    init()
  }, [])
}
