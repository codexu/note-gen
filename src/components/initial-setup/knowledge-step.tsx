'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Layers } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { KnowledgeSettingCard } from '@/components/wiki/knowledge-setting-card'
import { useWikiActionScope } from '@/components/wiki/use-wiki-action-scope'
import { getWikiContext } from '@/lib/wiki/context'
import { getWikiSettings, updateWikiSettings } from '@/lib/wiki/settings'
import useSettingStore from '@/stores/setting'
import type { WikiSettings } from '@/types/wiki'
import { SetupStepActions, type SetupStepProps } from './setup-step-actions'

type KnowledgeChoices = Pick<WikiSettings, 'enabled' | 'semanticSearchEnabled'>

export function SetupKnowledgeStep({ onBack, onNext }: SetupStepProps) {
  const t = useTranslations('initialSetup.knowledge')
  const wiki = useTranslations('wiki')
  const rag = useTranslations('settings.rag')
  const workspace = useSettingStore(state => state.workspacePath)
  const { busy, beginAction, getActionGuard } = useWikiActionScope(workspace)
  const [loaded, setLoaded] = useState<{ workspace: string; contextId: string; settings: KnowledgeChoices } | null>(null)
  const [draft, setDraft] = useState<Partial<KnowledgeChoices>>({})
  const [error, setError] = useState(false)
  const current = loaded?.workspace === workspace ? loaded : null

  const load = useCallback(async () => {
    const isCurrent = getActionGuard()
    setLoaded(null)
    setDraft({})
    setError(false)
    try {
      const context = await getWikiContext()
      const settings = await getWikiSettings(context.id)
      if (isCurrent()) setLoaded({ workspace, contextId: context.id, settings })
    } catch (cause) {
      if (isCurrent()) {
        console.error('Failed to read knowledge base settings:', cause)
        setError(true)
      }
    }
  }, [getActionGuard, workspace])

  useEffect(() => { void load() }, [load])

  function change(patch: Partial<KnowledgeChoices>) {
    setError(false)
    setDraft(previous => ({ ...previous, ...patch }))
  }

  async function save() {
    if (!current || busy) return
    const operation = beginAction()
    setError(false)
    try {
      if (Object.keys(draft).length > 0) await updateWikiSettings(draft, current.contextId)
      if (operation.isCurrent()) onNext()
    } catch (cause) {
      if (operation.isCurrent()) {
        console.error('Failed to save knowledge base settings:', cause)
        setError(true)
      }
    } finally {
      operation.finish()
    }
  }

  const wikiEnabled = draft.enabled ?? current?.settings.enabled ?? false
  const ragEnabled = draft.semanticSearchEnabled ?? current?.settings.semanticSearchEnabled ?? false

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="app-panel-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 py-2">
        {current ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <KnowledgeSettingCard title={wiki('wikiTitle')} description={wiki('wikiDescription')}
              icon={BookOpen} label={wiki('defaultMode')} enabled={wikiEnabled}
              actions={<Switch aria-label={wiki('enabled')} checked={wikiEnabled} disabled={busy}
                onCheckedChange={enabled => change({ enabled })} />} />
            <KnowledgeSettingCard title={rag('ragTitle')} description={t('ragDescription')}
              icon={Layers} label={wiki('optionalMode')} enabled={ragEnabled}
              actions={<Switch aria-label={rag('ragTitle')} checked={ragEnabled} disabled={busy}
                onCheckedChange={semanticSearchEnabled => change({ semanticSearchEnabled })} />} />
          </div>
        ) : !error && <div className="grid flex-1 place-items-center"><Spinner /></div>}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{t(current ? 'saveFailed' : 'loadFailed')}</AlertDescription>
            {!current && (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void load()}>
                {t('retry')}
              </Button>
            )}
          </Alert>
        )}
      </div>
      <SetupStepActions onBack={onBack} onNext={() => void save()} nextLabel={t('save')}
        busy={busy} disableBack={busy} disableNext={!current} />
    </div>
  )
}
