'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MoreHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import useArticleStore from '@/stores/article'
import useVaultIndexStore from '@/stores/vault-index'
import { rewriteNote } from '@/lib/note-rewrite'
import { applyFrontmatterEdit, inferPropertyType, validatePropertySource, type FrontmatterEdit, type Property, type PropertyType } from '@/lib/markdown/frontmatter-edit'
import { loadObsidianPropertyTypes } from '@/lib/obsidian-types'
import { chipValues, initialPropertyValue, propertiesForArticle, propertyIcons, rankPropertyKeys, yamlSourceOf } from './properties-model'

function PropertyRow({ property, save, disabled }: { property: Property; save: (edit: FrontmatterEdit) => Promise<boolean>; disabled: boolean }) {
  const t = useTranslations('properties')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(property.key)
  const [draft, setDraft] = useState(String(property.value ?? ''))
  const [chip, setChip] = useState('')
  useEffect(() => { setDraft(String(property.value ?? '')); setName(property.key) }, [property.value, property.key])
  const Icon = propertyIcons[property.type]
  const multiple = ['multitext', 'tags', 'aliases'].includes(property.type)
  async function setValue(value: unknown) {
    return save({ kind: 'set', key: property.key, value, type: property.type })
  }
  async function rename() {
    if (!name.trim()) { setName(property.key); setRenaming(false); return }
    if (await save({ kind: 'rename', key: property.key, newKey: name.trim() })) setRenaming(false)
  }
  const values = chipValues(property.value)
  return <div className="mb-3 rounded-lg border p-2">
    <div className="mb-2 flex items-center gap-2">
      <span title={property.type === 'unsupported' ? t('unsupported') : t(`types.${property.type}`)}><Icon className="size-4 text-ink" /></span>
      {renaming ? <Input autoFocus aria-label={t('rename')} value={name} disabled={disabled} onChange={event => setName(event.target.value)} onBlur={() => void rename()} onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') { setRenaming(false); setName(property.key) }
      }} /> : <button type="button" title={t('rename')} disabled={disabled || !property.editable} onDoubleClick={() => setRenaming(true)} className="min-w-0 flex-1 text-left font-medium [overflow-wrap:anywhere]">{property.key}</button>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" disabled={disabled || !property.editable} aria-label={property.key}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem onSelect={() => setRenaming(true)}>{t('rename')}</DropdownMenuItem><DropdownMenuItem onSelect={() => void save({ kind: 'remove', key: property.key })}>{t('remove')}</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </div>
    {!property.editable ? <><pre className="whitespace-pre-wrap break-all text-xs">{property.raw}</pre><p className="mt-1 text-xs text-muted-foreground">{t('unsupported')}</p></>
      : property.type === 'checkbox' ? <Checkbox aria-label={property.key} disabled={disabled} checked={property.value === true} onCheckedChange={checked => void setValue(checked === true)} />
        : multiple ? <div className="flex flex-wrap gap-1">
          {values.map((value, index) => <span key={`${index}:${value}`} className="inline-flex max-w-full items-center gap-1 rounded bg-hover px-2 py-1 text-xs text-ink font-medium"><span className="break-all">{property.type === 'tags' ? '#' + value.replace(/^#/, '') : value}</span><button type="button" disabled={disabled} aria-label={`${t('remove')} ${value}`} onClick={() => void setValue(values.filter((_, i) => i !== index))}><X className="size-3" /></button></span>)}
          <Input aria-label={property.key} disabled={disabled} placeholder={t('valuePlaceholder')} value={chip} onChange={event => setChip(event.target.value)} onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || !chip.trim()) return
            event.preventDefault()
            const value = property.type === 'tags' ? chip.trim().replace(/^#/, '') : chip.trim()
            void setValue([...values, value]).then(ok => { if (ok) setChip('') })
          }} />
        </div>
          : <Input aria-label={property.key} disabled={disabled} type={property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : property.type === 'datetime' ? 'datetime-local' : 'text'} step={property.type === 'number' ? 'any' : property.type === 'datetime' ? '1' : undefined} value={draft} placeholder={t('valuePlaceholder')} onChange={event => setDraft(event.target.value)} onBlur={() => {
            if (draft === String(property.value ?? '')) return
            if (property.type === 'number' && (!draft.trim() || !Number.isFinite(Number(draft)))) { setDraft(String(property.value ?? '')); return }
            void setValue(property.type === 'number' ? Number(draft) : draft)
          }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }} />}
  </div>
}

export default function PropertiesPanel() {
  const t = useTranslations('properties')
  const path = useArticleStore(state => state.activeFilePath) ?? ''
  const article = useArticleStore(state => state.currentArticle)
  const workspace = useVaultIndexStore(state => state.workspace)
  const notes = useVaultIndexStore(state => state.notes)
  const [types, setTypes] = useState<Record<string, PropertyType>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [source, setSource] = useState('')
  const [adding, setAdding] = useState(false)
  const [key, setKey] = useState('')
  const type = inferPropertyType(key.trim(), null, types)
  const suggestionsId = useId()
  useEffect(() => {
    let current = true
    setTypes({})
    void loadObsidianPropertyTypes().then(value => { if (current) setTypes(value) })
    return () => { current = false }
  }, [workspace])
  useEffect(() => { setError(''); setSourceMode(false); setAdding(false); setKey('') }, [path, workspace])
  const result = useMemo(() => {
    try { return { properties: propertiesForArticle(article, types), error: '' } }
    catch (error) { return { properties: [], error: String(error) } }
  }, [article, types])
  const keys = useMemo(() => rankPropertyKeys(notes.values(), key), [notes, key])
  async function save(edit: FrontmatterEdit): Promise<boolean> {
    setError('')
    setBusy(true)
    try {
      await rewriteNote(path, content => applyFrontmatterEdit(content, edit, types))
      return true
    } catch (error) { setError(`${t('saveFailed')}: ${String(error)}`); return false }
    finally { setBusy(false) }
  }
  function openSource() { setSource(yamlSourceOf(article)); setSourceMode(true); setError('') }
  return <aside aria-label={t('title')} className="h-full overflow-y-auto p-3 text-sm">
    {!/\.md$/i.test(path) ? <p className="py-4 text-muted-foreground">{t('notMarkdown')}</p> : <>
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold">{t('title')}</h2><Button variant="ghost" size="sm" disabled={busy} onClick={() => sourceMode ? setSourceMode(false) : openSource()}>{t('source')}</Button></div>
      {(error || result.error) && <p role="alert" className="mb-2 whitespace-pre-wrap break-all text-destructive">{error || `${t('invalidYaml')}: ${result.error}`}</p>}
      {sourceMode ? <><Textarea aria-label={t('source')} disabled={busy} value={source} onChange={event => setSource(event.target.value)} className="min-h-60 font-mono text-xs" /><Button className="mt-2" disabled={busy} onClick={() => {
        try { validatePropertySource(source) } catch (error) { setError(`${t('invalidYaml')}: ${String(error)}`); return }
        void save({ kind: 'replaceSource', yaml: source }).then(ok => { if (ok) setSourceMode(false) })
      }}>{t('apply')}</Button></> : <>
        {!result.error && result.properties.length === 0 && <p className="py-4 text-muted-foreground">{t('empty')}</p>}
        {result.properties.map(property => <PropertyRow key={`${path}:${property.key}`} property={property} save={save} disabled={busy} />)}
        {!result.error && (adding ? <form className="grid gap-2 rounded-lg border p-2" onSubmit={event => {
          event.preventDefault()
          if (!key.trim()) return
          if (result.properties.some(property => property.key === key.trim())) { setError(t('keyExists')); return }
          void save({ kind: 'set', key: key.trim(), type, value: initialPropertyValue(type) }).then(ok => { if (ok) { setAdding(false); setKey('') } })
        }}>
          <Input autoFocus aria-label={t('keyPlaceholder')} disabled={busy} list={suggestionsId} value={key} placeholder={t('keyPlaceholder')} onChange={event => {
            const value = event.target.value
            setKey(value)
          }} />
          <datalist id={suggestionsId}>{keys.filter(key => !result.properties.some(property => property.key === key)).map(key => <option key={key} value={key} />)}</datalist>
          <p aria-label={t('type')} className="text-xs text-muted-foreground">{t(`types.${type}`)}</p>
          <Button disabled={busy || !key.trim()} type="submit">{t('add')}</Button>
        </form> : <Button variant="outline" disabled={busy} onClick={() => setAdding(true)}>{t('add')}</Button>)}
      </>}
    </>}
  </aside>
}
