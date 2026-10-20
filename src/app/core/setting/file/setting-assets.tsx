'use client'
import { Input } from "@/components/ui/input"
import { useTranslations } from 'next-intl'
import useSettingStore from "@/stores/setting"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"

export function SettingAssets({ showTitle = true }: { showTitle?: boolean }) {
  const t = useTranslations('settings.file.assets')
  const { assetsPath, setAssetsPath } = useSettingStore()
  return (
    <Field>
      {showTitle ? <FieldLabel htmlFor="assets-path">{t('title')}</FieldLabel> : null}
      <Input
        id="assets-path"
        aria-label={t('title')}
        placeholder={t('select')}
        value={assetsPath}
        onChange={(e) => setAssetsPath(e.target.value)}
      />
      <FieldDescription>{t('desc')}</FieldDescription>
    </Field>
  )
}
