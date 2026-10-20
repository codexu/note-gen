'use client'
import { SettingWorkspace } from "./setting-workspace"
import { SettingAssets } from "./setting-assets"
import { SettingSection, SettingType } from "../components/setting-base"
import { FolderOpen } from "lucide-react"
import { useTranslations } from 'next-intl'

export default function SettingFilePage() {
  const t = useTranslations('settings.file')

  return (
    <SettingType
      id="file"
      title={t('title')}
      desc={t('desc')}
      icon={<FolderOpen className="w-5 h-5" />}
    >
      <div className="flex flex-col gap-6">
        <SettingSection title={t('workspace.current')}>
          <SettingWorkspace showTitle={false} />
        </SettingSection>
        <SettingSection title={t('assets.title')}>
          <SettingAssets showTitle={false} />
        </SettingSection>
      </div>
    </SettingType>
  )
}
