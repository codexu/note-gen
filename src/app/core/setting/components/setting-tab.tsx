"use client";

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation";
import baseConfig from '../config'
import { useTranslations } from 'next-intl'
import useSettingStore from "@/stores/setting"
import UploadStore from "./upload-store";
import { Separator } from "@/components/ui/separator";

export function SettingTab() {
  const [currentPage, setCurrentPage] = useState('about')
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('settings')
  const { setLastSettingPage } = useSettingStore()
  
  // Add translations to the config
  const config = baseConfig.map(item => {
    if (typeof item === 'string') return item
    return {
      ...item,
      title: t(`${item.anchor}.title`)
    }
  })

  function handleNavigation(anchor: string) {
    setCurrentPage(anchor)
    router.push(`/core/setting/${anchor}`)
    // 记录最后访问的设置页面
    setLastSettingPage(anchor)
  }

  useEffect(() => {
    // 从当前URL路径中提取当前页面
    const pageName = pathname.split('/').pop()
    if (pageName && pageName !== 'setting') {
      setCurrentPage(pageName)
      // 记录最后访问的设置页面
      setLastSettingPage(pageName)
    }
  }, [pathname, setLastSettingPage])

  return (
    <div className="flex flex-col w-56 justify-between h-screen bg-sidebar border-r">
      <ul className="w-full p-4 flex flex-col justify-between flex-1 overflow-y-auto">
        {
          config.map((item, index) => {
            if (typeof item === 'string') return (
              <Separator key={index} className="my-2" />
            )
            return (
              <li
                key={item.anchor}
                className={currentPage === item.anchor ? '!bg-zinc-800 text-white setting-anchor' : 'setting-anchor'}
                onClick={() => handleNavigation(item.anchor)}
              >
                {item.icon}
                <span>{item.title}</span>
              </li>
            )
          })
        }
      </ul>
      <UploadStore />
    </div>
  )
}