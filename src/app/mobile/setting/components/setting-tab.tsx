"use client";

import { useRouter } from "next/navigation";
import baseConfig from '@/app/core/setting/config'
import { useTranslations } from 'next-intl'

export function SettingTab() {
  const router = useRouter()
  const t = useTranslations('settings')
  
  // Add translations to the config
  const config = baseConfig.map(item => ({
    ...item,
    title: t(`${item.anchor}.title`)
  })).filter(item => item.anchor !== 'about')

  function handleNavigation(anchor: string) {
    router.push(`/mobile/setting/pages/${anchor}`)
  }

  return (
    <ul className="flex flex-col w-full">
      {
        config.map(item => {
          return (
            <li
              className="flex items-center gap-2 p-4 border-b last:border-b-0 w-full"
              key={item.anchor}
              onClick={() => handleNavigation(item.anchor)}
            >
              {item.icon}
              <span>{item.title}</span>
            </li>
          )
        })
      }
    </ul>
  )
}