'use client'

import { useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWikiActionScope } from '@/components/wiki/use-wiki-action-scope'
import { useWikiErrorMessage } from '@/components/wiki/use-wiki-error-message'
import { getAllMarkdownFiles } from '@/lib/files'
import { getKnowledgeSettings } from '@/lib/knowledge-settings'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard } from '@/lib/wiki/context'
import { isWikiFolderPath } from '@/lib/wiki/path'
import { addWikiScope } from '@/lib/wiki/settings'
import { getWikiSourceDocument, getWikiSourcePolicy } from '@/lib/wiki/sources'

const kinds = ['article-folder', 'article'] as const
type SourceKind = typeof kinds[number]
type Choice = { id: string; label: string }

/** Load choices for the active source kind only. */
export function WikiSourcePicker({ contextId, disabled }: { contextId: string; disabled: boolean }) {
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<SourceKind>('article-folder')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(50)
  const [choices, setChoices] = useState<Choice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { busy, beginAction } = useWikiActionScope(`${contextId}:${kind}:${open}`)
  const kindId = useId()

  useEffect(() => {
    if (!open) return
    let active = true
    const workspace = captureWikiWorkspaceGuard()
    setChoices(null)
    setError(null)
    const load = async (): Promise<Choice[]> => {
      await assertWikiContextCurrent(contextId)
      const { enabledSourceTypes } = await getKnowledgeSettings()
      if (!enabledSourceTypes.includes('article')) return []
      const policy = await getWikiSourcePolicy(contextId)
      const files = (await getAllMarkdownFiles()).map(file => file.relativePath)
        .filter(path => !isWikiFolderPath(path) && policy.allowsArticle(path))
      if (kind === 'article') return files.sort().map(id => ({ id, label: id }))
      const folders = new Set<string>()
      for (const file of files) {
        const parts = file.split('/')
        for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'))
      }
      return [{ id: '', label: t('allArticles') }, ...[...folders].sort().map(id => ({ id, label: id }))]
    }
    void load().then(items => { if (active && workspace()) setChoices(items) })
      .catch(cause => { if (active && workspace()) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [open, kind, contextId, t, errorMessage])

  async function choose(choice: Choice) {
    const action = beginAction()
    try {
      await assertWikiContextCurrent(contextId)
      if (!action.isCurrent()) return
      if (kind === 'article') {
        const document = await getWikiSourceDocument(`article:${choice.id}`)
        if (!document) throw new Error('WIKI_SOURCE_NOT_FOUND')
        if (document.derived) throw new Error('WIKI_GENERATED_SOURCE')
      }
      if (!action.isCurrent()) return
      await addWikiScope({ kind, ...choice }, contextId)
      if (action.isCurrent()) setOpen(false)
    } catch (cause) {
      if (action.isCurrent()) setError(errorMessage(cause))
    } finally { action.finish() }
  }

  const results = choices?.filter(choice => choice.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setQuery(''); setLimit(50); setOpen(value) } }}>
    <DialogTrigger asChild><Button variant="outline" size="sm" disabled={disabled}><Plus data-icon="inline-start" />{t('folder.selectSources')}</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{t('folder.selectSources')}</DialogTitle><DialogDescription>{t('scopeDescription')}</DialogDescription></DialogHeader>
      <Field>
        <FieldLabel htmlFor={kindId}>{t('scopeKind')}</FieldLabel>
        <Select value={kind} disabled={busy} onValueChange={value => { setChoices(null); setQuery(''); setLimit(50); setKind(value as SourceKind) }}>
          <SelectTrigger id={kindId}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{kinds.map(value => <SelectItem key={value} value={value}>{t(`scopeKinds.${value}`)}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>
      <Input aria-label={t('scopeSearch')} placeholder={t('scopeSearch')} value={query} onChange={event => { setQuery(event.target.value); setLimit(50) }} />
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="flex max-h-[40dvh] flex-col gap-1 overflow-y-auto" aria-live="polite">
        {results?.slice(0, limit).map(choice => <Button key={choice.id} variant="ghost" className="justify-start" disabled={busy} onClick={() => void choose(choice)}>
          <Plus data-icon="inline-start" /><span className="truncate">{choice.label}</span>
        </Button>)}
        {results && results.length > limit ? <Button variant="outline" size="sm" onClick={() => setLimit(value => value + 50)}>{t('folder.showMore')}</Button> : null}
        {!error && !results?.length ? <p className="py-3 text-sm text-muted-foreground">{results ? t('folder.noMatchingSources') : t('scopeLoading')}</p> : null}
      </div>
    </DialogContent>
  </Dialog>
}
