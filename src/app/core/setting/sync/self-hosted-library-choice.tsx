'use client'

import { useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  automaticInitialLibrary, getInitialLibraryLocation, isInitialLibraryCandidate, readInitialLibraryChoice,
  readLibraryBindings, sameLibraryRoot, saveInitialLibraryChoice,
} from '@/lib/self-hosted-sync/initial-library-choice'
import { listLibraries, type SelfHostedLibrary } from '@/lib/self-hosted-sync/workspaces'
import useSettingStore from '@/stores/setting'

const AUTOMATIC = 'automatic'

interface LibraryOptions {
  profileId: string
  workspacePath: string
  localRoot: string
  candidates: SelfHostedLibrary[]
  otherAccountLibraries: SelfHostedLibrary[]
  automatic: SelfHostedLibrary | null | undefined
  workspaceId: string | null
}

export function SelfHostedLibraryChoice({ profileId, onReadyChange, onSavingChange }: {
  profileId: string
  onReadyChange?: (ready: boolean) => void
  onSavingChange?: (saving: boolean) => void
}) {
  const t = useTranslations('settings.sync.selfHosted')
  const id = useId()
  const workspacePath = useSettingStore(state => state.workspacePath)
  const [options, setOptions] = useState<LibraryOptions | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setOptions(null)
    setError('')
    void (async () => {
      const { localRoot, isDefault } = await getInitialLibraryLocation()
      const [libraries, workspaceId, bindings] = await Promise.all([
        listLibraries(profileId, { readOnly: true }),
        readInitialLibraryChoice(profileId, localRoot),
        readLibraryBindings(),
      ])
      const automaticId = automaticInitialLibrary(libraries, bindings, profileId, localRoot, isDefault, libraries.find(library => library.default)?.id)
      const automatic = automaticId === null ? null : libraries.find(library => library.id === automaticId && library.deletedAt === null)
      const candidates = libraries.filter(library => isInitialLibraryCandidate(library, profileId, localRoot, bindings.get(library.id)))
      const otherAccountLibraries = libraries.filter(library => {
        const binding = bindings.get(library.id)
        return library.deletedAt === null && binding && binding.profileId !== profileId
      })
      if (active) setOptions({ profileId, workspacePath, localRoot, workspaceId, automatic, candidates, otherAccountLibraries })
    })().catch(() => {
      if (active) setError(t('initialLibraryLoadFailed'))
    })
    return () => { active = false }
  }, [profileId, workspacePath, retry, t])

  const current = options?.profileId === profileId && options.workspacePath === workspacePath ? options : null
  const selectedUnavailable = Boolean(current?.workspaceId && !current.candidates.some(library => library.id === current.workspaceId))
  const selectedByOtherAccount = current && current.otherAccountLibraries.find(library => library.id === current.workspaceId)
  const needsChoice = Boolean(current && !current.workspaceId && current.automatic === undefined)
  const ready = Boolean(current && !selectedUnavailable && !needsChoice && !saving && !error)

  useEffect(() => {
    onReadyChange?.(ready)
    return () => onReadyChange?.(false)
  }, [onReadyChange, ready])

  async function changeChoice(value: string) {
    if (!current || saving || (value === AUTOMATIC && current.automatic === undefined)) return
    const workspaceId = value === AUTOMATIC ? null : value
    setSaving(true)
    onSavingChange?.(true)
    setError('')
    try {
      const { localRoot } = await getInitialLibraryLocation()
      if (!sameLibraryRoot(localRoot, current.localRoot) || (workspaceId && !current.candidates.some(library => library.id === workspaceId))) {
        throw new Error('Initial library selection changed')
      }
      await saveInitialLibraryChoice(profileId, localRoot, workspaceId)
      setOptions(previous => previous === current ? { ...previous, workspaceId } : previous)
    } catch {
      setError(t('initialLibrarySaveFailed'))
    } finally {
      setSaving(false)
      onSavingChange?.(false)
    }
  }

  return <Field>
    <FieldLabel htmlFor={id}>{t('initialLibraryTitle')}</FieldLabel>
    <FieldDescription>{t('initialLibraryDescription')}</FieldDescription>
    {current ? <>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t('initialLibraryLocalRoot')}</span>
        <span className="break-all">{current.localRoot}</span>
      </div>
      <Select value={current.workspaceId ?? (needsChoice ? '' : AUTOMATIC)} disabled={saving} onValueChange={value => void changeChoice(value)}>
        <SelectTrigger id={id} className="w-full min-w-0" aria-describedby={needsChoice || selectedUnavailable ? `${id}-required` : undefined}>
          <SelectValue placeholder={t('initialLibraryChoose')} />
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)] [&_[data-slot=select-item]]:[overflow-wrap:anywhere]">
          <SelectGroup>
            {current.automatic !== undefined && <SelectItem value={AUTOMATIC}>
              {current.automatic ? t('initialLibraryAutomaticExisting', { name: current.automatic.name }) : t('initialLibraryAutomaticNew')}
            </SelectItem>}
            {selectedUnavailable && current.workspaceId && <SelectItem disabled value={current.workspaceId}>
              {selectedByOtherAccount ? t('initialLibraryBoundToOtherAccount', { name: selectedByOtherAccount.name }) : t('initialLibraryUnavailable')}
            </SelectItem>}
            {current.candidates.map(library => <SelectItem key={library.id} value={library.id}>{library.name}</SelectItem>)}
            {current.otherAccountLibraries.filter(library => library.id !== current.workspaceId).map(library => <SelectItem key={library.id} disabled value={library.id}>
              {t('initialLibraryBoundToOtherAccount', { name: library.name })}
            </SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      {(needsChoice || selectedUnavailable) && <FieldDescription id={`${id}-required`} role="status">{t('initialLibraryRequired')}</FieldDescription>}
    </> : !error && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner />{t('initialLibraryLoading')}</p>}
    {error && <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-destructive" role="alert">{error}</p>
      {!current && <Button type="button" variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>{t('initialLibraryRetry')}</Button>}
    </div>}
  </Field>
}
