'use client'
import { Store } from '@tauri-apps/plugin-store'
import { useRouter  } from 'next/navigation'
import { useEffect } from 'react'
import { isMobileDevice } from '@/lib/check'

export default function Home() {
  const router = useRouter()
  async function init() {
    const store = await Store.load('store.json')
    const currentPage = await store.get<string>('currentPage')
    if (isMobileDevice()) {
      if (currentPage?.includes('/mobile')) {
        router.push(currentPage || '/mobile/chat')
      } else {
        router.push('/mobile/chat')
      }
    } else {
      if (!currentPage?.includes('/mobile')) {
        router.push(currentPage || '/core/record')
      } else {
        router.push('/core/record')
      }
    }
  }
  useEffect(() => {
    init()
  }, [])
}
