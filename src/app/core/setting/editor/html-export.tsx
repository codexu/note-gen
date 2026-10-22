'use client'

import { useTranslations } from 'next-intl'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import useSettingStore from '@/stores/setting'
import { SettingSection } from '../components/setting-base'

export default function HtmlExportSettings() {
  const t = useTranslations('settings.editor.htmlExport')
  const { htmlExportConfig, setHtmlExportConfig } = useSettingStore()

  return (
    <SettingSection title={t('title')} desc={t('desc')}>
      <FieldGroup>
        {(['css', 'javascript'] as const).map(key => (
          <Field key={key}>
            <FieldLabel htmlFor={`html-export-${key}`}>{t(key)}</FieldLabel>
            <Textarea
              id={`html-export-${key}`}
              value={htmlExportConfig[key]}
              rows={5}
              maxRows={16}
              spellCheck={false}
              className="font-mono text-sm"
              onChange={event => void setHtmlExportConfig({
                ...useSettingStore.getState().htmlExportConfig,
                [key]: event.target.value,
              })}
            />
          </Field>
        ))}
      </FieldGroup>
    </SettingSection>
  )
}
