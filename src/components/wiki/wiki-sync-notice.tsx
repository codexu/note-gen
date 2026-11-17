'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useWikiErrorMessage } from './use-wiki-error-message'

export function WikiSyncNotice({ status }: { status: { phase: string; error: string | null } | null }) {
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => { if (status?.phase === 'idle') setLocalError(null) }, [status?.phase])
  if (status?.phase !== 'failed' && !localError) return null
  return <Alert variant="destructive">
    <AlertTitle>{t('syncFailed')}</AlertTitle>
    <AlertDescription className="flex flex-col gap-2">
      <span>{errorMessage(localError || status?.error || '')}</span>
      <Button variant="outline" size="sm" disabled={busy} className="self-start" onClick={async () => {
        setBusy(true)
        try { const { syncWikiNow } = await import('@/lib/wiki/sync'); await syncWikiNow(); setLocalError(null) }
        catch (error) { setLocalError(errorMessage(error)) }
        finally { setBusy(false) }
      }}><RefreshCw data-icon="inline-start" className={busy ? 'animate-spin' : undefined} />{t('retrySync')}</Button>
    </AlertDescription>
  </Alert>
}
