'use client'

import { SettingTab } from "./components/setting-tab"

export default function SettingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div id="setting-page" className="flex h-full">
      <SettingTab />
      <div className="flex-1 p-8 overflow-y-auto h-full">
        {children}
      </div>
    </div>
  )
}
