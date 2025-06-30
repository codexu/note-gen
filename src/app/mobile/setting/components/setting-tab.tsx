"use client";

import { useRouter } from "next/navigation";
import baseConfig from '@/app/core/setting/config'
import { useTranslations } from 'next-intl'
import { ChevronRight } from "lucide-react";

export function SettingTab() {
  const router = useRouter()
  const t = useTranslations('settings')
  const notMobilePages = ['about', 'file']
  
  // Add translations to the config
  const config = baseConfig.filter(item => typeof item !== 'string').map(item => ({
    ...item,
    title: t(`${item.anchor}.title`)
  })).filter(item => !notMobilePages.includes(item.anchor))

  function handleNavigation(anchor: string) {
    router.push(`/mobile/setting/pages/${anchor}`)
  }

  return (
    <ul className="flex flex-col w-full">
      {
        config.map(item => {
          return (
            <li
              className="flex items-center gap-2 p-4 border-b last:border-b-0 w-full justify-between"
              key={item.anchor}
              onClick={() => handleNavigation(item.anchor)}
            >
              <div className="flex items-center gap-4">
                {item.icon}
                <span className="text-sm">{item.title}</span>
              </div>
              <ChevronRight className="size-4" />
            </li>
          )
        })
      }
    </ul>
  )
}