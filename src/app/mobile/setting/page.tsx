'use client'

import { LanguageSwitch } from "@/components/language-switch"
import { SettingTab } from "./components/setting-tab"
import { ModeToggle } from "@/components/mode-toggle"
import Updater from "@/app/core/setting/about/updater"

export default function Setting() {
  return <div className="flex w-full h-[calc(100vh-168px)] flex-col">
    <div className="h-16 flex items-center justify-end p-2 border-b overflow-hidden">
      <LanguageSwitch />
      <ModeToggle />
    </div>
    <div className="flex-1 overflow-y-auto">
      <div className="p-2 my-4">
        <Updater />
      </div>
      <SettingTab />
    </div>
  </div>
}