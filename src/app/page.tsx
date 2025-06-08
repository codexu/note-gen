'use client'
import { redirect } from 'next/navigation'
import { useEffect } from 'react'

export default function Home() {
  async function init() {
    // Check if we're in Tauri environment
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { Store } = await import('@tauri-apps/plugin-store')
        const store = await Store.load('store.json')
        const currentPage = await store.get<string>('currentPage')
        redirect(currentPage || '/core/record')
      } catch (error) {
        console.log('Tauri store not available:', error)
        redirect('/core/record')
      }
    } else {
      // Running in browser - redirect to default page
      console.log('Running in browser mode - redirecting to default page')
      redirect('/core/record')
    }
  }
  
  useEffect(() => {
    init()
  }, [])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">NoteGen</h1>
        <p className="text-muted-foreground">Loading...</p>
        <div className="flex justify-center space-x-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
        </div>
      </div>
    </div>
  )
}