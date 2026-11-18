'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { useUiV3 } from '@/lib/fork-ui'
import { useOrganizeSettings } from '@/lib/organize/settings'

export function OrganizeSettings() {
  const v3 = useUiV3()
  const t = useTranslations('organize')
  const { ready, enabled, load, setEnabled } = useOrganizeSettings()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (v3) void load().catch(error => console.debug('[organize] settings unavailable', error))
  }, [v3, load])
  if (!v3) return null
  async function toggle(next: boolean) {
    setBusy(true)
    try { await setEnabled(next) }
    catch { toast.error(t('settingsError')) }
    finally { setBusy(false) }
  }
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-4">
      <div>
        <label htmlFor="auto-organize" className="text-sm font-medium">{t('title')}</label>
        <p id="auto-organize-desc" className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <Switch id="auto-organize" aria-describedby="auto-organize-desc" checked={enabled} disabled={!ready || busy}
        onCheckedChange={next => void toggle(next)} />
    </div>
  )
}
