'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { OpenBroswer } from '@/components/open-broswer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface TokenInputControlProps {
  value: string
  onChange: React.ChangeEventHandler<HTMLInputElement>
  visible: boolean
  onVisibleChange: (visible: boolean) => void
  tokenUrl: string
  placeholder: string
  disabled?: boolean
  docsSection?: 'sync' | 'image-hosting'
}

export function TokenInputControl({
  value,
  onChange,
  visible,
  onVisibleChange,
  tokenUrl,
  placeholder,
  disabled = false,
  docsSection = 'sync',
}: TokenInputControlProps) {
  const locale = useLocale()
  const t = useTranslations()
  const docsLocale = locale === 'zh' || locale === 'zh-TW' ? 'cn' : 'en'
  const docsUrl = `https://notegen.top/${docsLocale}/docs/settings/${docsSection}#token-permissions-guide`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex min-w-0 flex-1 gap-2">
          <Input
            className="min-w-0 flex-1"
            value={value}
            onChange={onChange}
            type={visible ? 'text' : 'password'}
            placeholder={placeholder}
            disabled={disabled}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => onVisibleChange(!visible)}
            aria-label={t('settings.sync.toggleTokenVisibility')}
            title={t('settings.sync.toggleTokenVisibility')}
            disabled={disabled}
          >
            {visible ? <Eye /> : <EyeOff />}
          </Button>
        </div>
        {tokenUrl === '#' ? (
          <Button className="w-full sm:w-auto" disabled>{t('settings.sync.newToken')}</Button>
        ) : (
          <OpenBroswer
            type="button"
            url={tokenUrl}
            title={t('settings.sync.newToken')}
            className="w-full sm:w-auto"
          />
        )}
      </div>
      <OpenBroswer
        url={docsUrl}
        title={t('settings.sync.tokenPermissionGuide')}
        className="text-sm text-blue-500 hover:underline"
      />
    </div>
  )
}
