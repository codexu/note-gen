'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { loadOrganizeHistory, useOrganizeHistory } from '@/lib/organize/history'
import { saveOrganizeSnapshotCopies, undoOrganizeChange } from '@/lib/organize/review'
import { currentWorkspaceIdentity } from '@/lib/organize/vault-io'
import useSettingStore from '@/stores/setting'

export function OrganizeHistory() {
  const t = useTranslations('organize')
  const workspace = useSettingStore(state => state.workspacePath)
  const [identity, setIdentity] = useState<{ workspace: string; value: string } | null>(null)
  const rows = useOrganizeHistory(state => state.rows)
  const loaded = useOrganizeHistory(state => state.workspace)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void currentWorkspaceIdentity().then(async value => {
      if (cancelled) return
      setIdentity({ workspace, value })
      await loadOrganizeHistory(value)
    }).catch(error => console.debug('[organize] history unavailable', error))
    return () => { cancelled = true }
  }, [workspace])

  if (identity?.workspace !== workspace || identity.value !== loaded || !rows.length) return null

  async function undo(id: string) {
    setBusy(id)
    try {
      if (await undoOrganizeChange(id)) toast.success(t('undone'))
      else toast.error(t('undoFailed'), {
        // 筆記之後被改過或同名重建時無法原地還原：改把整理前的內容另存成新檔
        action: { label: t('saveSnapshot'), onClick: () => void saveOrganizeSnapshotCopies(id)
          .then(paths => toast.success(t('snapshotSaved', { count: paths.length })))
          .catch(() => toast.error(t('snapshotFailed'))) },
      })
    } finally { setBusy(null) }
  }

  return (
    <details className="shrink-0 border-b border-line-soft px-4 py-2">
      <summary className="cursor-pointer text-sm">{t('history')}</summary>
      <ul className="max-h-48 overflow-y-auto py-1">
        {rows.map(row => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-1">
            <span className="break-all text-sm">{row.title}</span>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void undo(row.id)}>
              {t(row.status === 'prepared' ? 'recover' : 'undo')}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  )
}
