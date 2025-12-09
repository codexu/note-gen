'use client'
import { useEffect } from 'react'
import baseConfig from "./config"
import useSettingStore from '@/stores/setting'
import { redirect } from 'next/navigation'

export default function Page() {
  const { lastSettingPage } = useSettingStore()
  
  useEffect(() => {
    // 重定向到最后访问的设置页面，如果没有则使用第一个设置项
    const targetPage = lastSettingPage || baseConfig[0].anchor
    const hasPage = baseConfig.some(item => item.anchor === targetPage)
    if (!hasPage) {
      redirect(`/core/setting/${baseConfig[0].anchor}`)
    }
    redirect(`/core/setting/${targetPage}`)
  }, [])
  
  // 渲染一个加载中状态，在重定向之前显示
  return <div className="flex items-center justify-center h-full">
    <p className="text-gray-500">加载中...</p>
  </div>
}