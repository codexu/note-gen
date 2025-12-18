'use client'
import { SettingTab } from "./components/setting-tab"
import Updater from "@/app/core/setting/about/updater"

export default function Setting() {
  return <div id="mobile-setting" className="flex w-full h-full overflow-y-auto flex-col">
    <div className="h-12 flex items-center justify-between p-2 border-b overflow-hidden">
      <div className="flex items-center gap-2">
      </div>
    </div>
    <div className="flex-1 overflow-y-auto">
      <div className="p-2 my-4">
        <Updater />
      </div>
      <SettingTab />
    </div>
  </div>
}