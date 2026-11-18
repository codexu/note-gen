'use client'

// Fork：編輯器頂端的 frontmatter 屬性卡片（取代唯讀的 <pre>）。
// - 閱讀：純展示（日期依語系、核取方塊顯示是／否、[[連結]]可點、空值不顯示）；「編輯」進入編輯。
// - 編輯：每個值依型別換成元件，改完只寫回被改的那一行（applyFrontmatterEditToBlock，行尾註解與其他行原樣）。
// - 寫回只更新節點 attr `raw`；磁碟寫入交給編輯器原本的防抖存檔，不呼叫 rewriteNote，所以不會重載編輯器。
// - 收合狀態是全域設定（frontmatterCollapsed）。巢狀、多行、錨點的屬性維持原文唯讀。
import { NodeViewWrapper, useEditorState, type ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronDown, Code2, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  applyFrontmatterEditToBlock,
  inferPropertyType,
  listProperties,
  validatePropertySource,
  type FrontmatterEdit,
  type Property,
  type PropertyType,
} from '@/lib/markdown/frontmatter-edit'
import { parseWikilink } from '@/lib/markdown/wikilink'
import { loadObsidianPropertyTypes } from '@/lib/obsidian-types'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import useVaultIndexStore from '@/stores/vault-index'
import {
  chipValues,
  formatPropertyDate,
  initialPropertyValue,
  propertyIcons,
  rankPropertyKeys,
  suggestPropertyValues,
  yamlSourceOf,
} from '../../properties/properties-model'
import { openWikilink } from './wikilink-extension'

type Mode = 'read' | 'edit' | 'source'
type Apply = (edit: FrontmatterEdit) => boolean

const LIST_TYPES: PropertyType[] = ['multitext', 'tags', 'aliases']
const isWikilinkText = (value: string) => /^\[\[[^\]]+\]\]$/.test(value.trim())

function WikilinkText({ value }: { value: string }) {
  const link = parseWikilink(value.trim())
  const label = value.trim().replace(/^\[\[|\]\]$/g, '')
  if (!link) return <>{value}</>
  return (
    <button
      type="button"
      className="cursor-pointer text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
      onClick={() => void openWikilink(link).catch(error => console.error('[frontmatter] open failed', error))}
    >
      {label}
    </button>
  )
}

function ReadValue({ property }: { property: Property }) {
  const t = useTranslations('properties')
  const locale = useLocale()
  const { type, value } = property
  if (type === 'unsupported') return <pre className="m-0 whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">{property.raw}</pre>
  if (type === 'checkbox') return value === true ? <span className="text-green-600 dark:text-green-400">✓ {t('yes')}</span> : <span className="text-muted-foreground">✗ {t('no')}</span>
  if (type === 'date' || type === 'datetime') return <>{formatPropertyDate(value, locale)}</>
  if (LIST_TYPES.includes(type)) {
    return <span className="flex flex-wrap gap-1">{chipValues(value).map((item, index) => (
      <span key={`${index}:${item}`} className="rounded-full border bg-muted/40 px-2 text-xs leading-5">
        {isWikilinkText(item) ? <WikilinkText value={item} /> : type === 'tags' ? `#${item.replace(/^#/, '')}` : item}
      </span>
    ))}</span>
  }
  const text = String(value ?? '')
  return isWikilinkText(text) ? <WikilinkText value={text} /> : <span className={cn(property.key === 'title' && 'font-semibold')}>{text}</span>
}

function isEmptyValue(property: Property): boolean {
  if (property.type === 'unsupported' || property.type === 'checkbox') return false
  const { value } = property
  return value === '' || value == null || (Array.isArray(value) && value.length === 0)
}

function ReadBody({ properties }: { properties: Property[] }) {
  const shown = properties.filter(property => !isEmptyValue(property))
  if (!shown.length) return null
  return (
    <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 px-3 pb-2.5 pl-8 text-[13px]">
      {shown.map(property => (
        <div key={property.key} className="contents">
          <dt className="text-muted-foreground">{property.key}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]"><ReadValue property={property} /></dd>
        </div>
      ))}
    </dl>
  )
}

function EditRow({ property, apply, notePath }: { property: Property; apply: Apply; notePath: string }) {
  const t = useTranslations('properties')
  const listId = useId()
  const notes = useVaultIndexStore(state => state.notes)
  const [draft, setDraft] = useState(String(property.value ?? ''))
  const [chip, setChip] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  useEffect(() => { setDraft(String(property.value ?? '')) }, [property.value])
  const Icon = propertyIcons[property.type]
  const set = (value: unknown) => apply({ kind: 'set', key: property.key, value, type: property.type })

  function commitDraft() {
    if (draft === String(property.value ?? '')) return
    if (property.type === 'number') {
      if (!draft.trim() || !Number.isFinite(Number(draft))) { setDraft(String(property.value ?? '')); return }
      set(Number(draft))
      return
    }
    set(draft)
  }

  let control: React.ReactNode
  if (!property.editable) {
    control = <><pre className="m-0 whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">{property.raw}</pre><p className="m-0 mt-0.5 text-[11px] text-muted-foreground">{t('nestedHint')}</p></>
  } else if (property.type === 'checkbox') {
    control = <Switch aria-label={property.key} checked={property.value === true} onCheckedChange={checked => set(checked)} />
  } else if (LIST_TYPES.includes(property.type)) {
    const values = chipValues(property.value)
    control = (
      <div className="flex flex-wrap items-center gap-1">
        {values.map((value, index) => (
          <span key={`${index}:${value}`} className="inline-flex max-w-full items-center gap-1 rounded bg-hover px-2 py-0.5 text-xs text-ink font-medium">
            <span className="break-all">{property.type === 'tags' ? `#${value.replace(/^#/, '')}` : value}</span>
            <button type="button" aria-label={`${t('remove')} ${value}`} onClick={() => set(values.filter((_, i) => i !== index))}><X className="size-3" /></button>
          </span>
        ))}
        <input
          aria-label={property.key}
          className="min-w-20 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
          placeholder={t('addPlaceholder')}
          value={chip}
          onChange={event => setChip(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || !chip.trim()) return
            event.preventDefault()
            const value = property.type === 'tags' ? chip.trim().replace(/^#/, '') : chip.trim()
            if (set([...values, value])) setChip('')
          }}
        />
      </div>
    )
  } else {
    const inputType = property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : property.type === 'datetime' ? 'datetime-local' : 'text'
    const hasList = property.type === 'text' || property.type === 'number'
    control = (
      <>
        <Input
          aria-label={property.key}
          className="h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input focus-visible:bg-background"
          type={inputType}
          step={property.type === 'number' ? 'any' : property.type === 'datetime' ? '1' : undefined}
          list={hasList ? listId : undefined}
          value={draft}
          placeholder={t('valuePlaceholder')}
          onFocus={() => { if (hasList) setSuggestions(suggestPropertyValues(notes.values(), property.key, notePath)) }}
          onChange={event => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur()
            if (event.key === 'Escape') { setDraft(String(property.value ?? '')); event.currentTarget.blur() }
          }}
        />
        {hasList ? <datalist id={listId}>{suggestions.map(value => <option key={value} value={value} />)}</datalist> : null}
      </>
    )
  }

  return (
    <div className="group grid grid-cols-[7.5rem_1fr_1.5rem] items-start gap-2 px-2.5 py-1 hover:bg-hover">
      <div className="flex items-center gap-1.5 pt-1 text-muted-foreground [overflow-wrap:anywhere]">
        <Icon className="size-3.5 shrink-0 text-ink" />
        <span title={property.type === 'unsupported' ? t('unsupported') : t(`types.${property.type}`)}>{property.key}</span>
      </div>
      <div className="min-w-0">{control}</div>
      <button
        type="button"
        className="mt-1 text-muted-foreground opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
        aria-label={`${t('remove')} ${property.key}`}
        onClick={() => apply({ kind: 'remove', key: property.key })}
      ><X className="size-3.5" /></button>
    </div>
  )
}

function AddRow({ properties, types, apply }: { properties: Property[]; types: Record<string, PropertyType>; apply: Apply }) {
  const t = useTranslations('properties')
  const listId = useId()
  const notes = useVaultIndexStore(state => state.notes)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const known = useMemo(
    () => (open ? rankPropertyKeys(notes.values(), key).filter(item => !properties.some(property => property.key === item)) : []),
    [open, notes, key, properties],
  )
  if (!open) return <div className="border-t px-2.5 py-1.5"><button type="button" className="text-sm text-ink" onClick={() => setOpen(true)}>＋ {t('add')}</button></div>
  const submit = () => {
    const name = key.trim()
    if (!name) return
    if (properties.some(property => property.key === name)) return
    const type = inferPropertyType(name, null, types)
    if (apply({ kind: 'set', key: name, value: initialPropertyValue(type), type })) { setKey(''); setOpen(false) }
  }
  return (
    <div className="border-t px-2.5 py-1.5">
      <Input
        autoFocus
        aria-label={t('keyPlaceholder')}
        className="h-7"
        list={listId}
        placeholder={t('keyPlaceholder')}
        value={key}
        onChange={event => setKey(event.target.value)}
        onBlur={() => { if (!key.trim()) setOpen(false) }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
          if (event.key === 'Escape') { setKey(''); setOpen(false) }
        }}
      />
      <datalist id={listId}>{known.map(item => <option key={item} value={item} />)}</datalist>
    </div>
  )
}

export function FrontmatterCardView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const t = useTranslations('properties')
  const raw = String(node.attrs.raw ?? '')
  const editable = useEditorState({ editor, selector: ctx => ctx.editor.isEditable })
  const collapsed = useSettingStore(state => state.frontmatterCollapsed)
  const setCollapsed = useSettingStore(state => state.setFrontmatterCollapsed)
  const workspace = useVaultIndexStore(state => state.workspace)
  const notePath = useArticleStore(state => state.activeFilePath) ?? ''
  const [types, setTypes] = useState<Record<string, PropertyType>>({})
  const [mode, setMode] = useState<Mode>('read')
  const [error, setError] = useState('')
  const [source, setSource] = useState('')
  const view: Mode = editable ? mode : 'read'

  useEffect(() => {
    let current = true
    void loadObsidianPropertyTypes().then(value => { if (current) setTypes(value) })
    return () => { current = false }
  }, [workspace])

  const parsed = useMemo(() => {
    try { return { properties: listProperties(raw, types), error: '' } }
    catch (cause) { return { properties: [] as Property[], error: cause instanceof Error ? cause.message : String(cause) } }
  }, [raw, types])

  /** 寫回節點；刪光最後一個屬性時移除整個 frontmatter 節點。成功回傳 true。 */
  const apply: Apply = edit => {
    try {
      const next = applyFrontmatterEditToBlock(raw, edit, types)
      setError('')
      if (!next) { deleteNode(); return true }
      if (next !== raw) updateAttributes({ raw: next })
      return true
    } catch (cause) {
      setError(`${t('saveFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`)
      return false
    }
  }

  const title = parsed.properties.find(property => property.key === 'title' && !isEmptyValue(property))
  const tags = parsed.properties.find(property => property.type === 'tags')

  return (
    <NodeViewWrapper
      as="div"
      data-type="frontmatter"
      contentEditable={false}
      className={cn('notegen-frontmatter-card my-2 select-text rounded-lg text-sm', view === 'read' ? 'border border-transparent' : 'border bg-background')}
    >
      <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
        <button
          type="button"
          aria-label={collapsed ? t('expand') : t('collapse')}
          aria-expanded={!collapsed}
          className="rounded p-0.5 hover:bg-muted"
          onClick={() => void setCollapsed(!collapsed)}
        ><ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} /></button>
        <button type="button" className="select-none" onClick={() => void setCollapsed(!collapsed)}>
          {t('title')} · {parsed.error ? '—' : t('count', { count: parsed.properties.length })}
        </button>
        <span className="flex-1" />
        {editable && view === 'read' && !collapsed ? <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setMode('edit')}><Pencil className="size-3" />{t('edit')}</Button> : null}
        {view !== 'read' && !collapsed ? <>
          <Button size="sm" variant={view === 'source' ? 'secondary' : 'ghost'} className="h-6 px-2 text-xs" onClick={() => {
            if (view === 'source') { setMode('edit'); return }
            setSource(yamlSourceOf(raw)); setError(''); setMode('source')
          }}><Code2 className="size-3" />{t('source')}</Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { deleteNode() }}><Trash2 className="size-3" />{t('removeAll')}</Button>
        </> : null}
        {view !== 'read' ? <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setMode('read'); setError('') }}>{t('done')}</Button> : null}
      </div>

      {error ? <p role="alert" className="m-0 whitespace-pre-wrap break-all px-3 pb-1 text-xs text-destructive">{error}</p> : null}

      {collapsed ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 pl-8 text-xs text-muted-foreground">
          {parsed.error ? <span className="text-destructive">{t('invalidYaml')}</span> : <>
            {title ? <b className="font-semibold text-foreground">{String(title.value)}</b> : null}
            {tags ? chipValues(tags.value).map((item, index) => <span key={`${index}:${item}`} className="rounded bg-hover px-1.5 text-ink font-medium">#{item.replace(/^#/, '')}</span>) : null}
            <span>· {t('collapsedHint')}</span>
          </>}
        </div>
      ) : parsed.error ? (
        <div className="px-3 pb-2">
          <p role="alert" className="m-0 whitespace-pre-wrap break-all text-xs text-destructive">{t('invalidYaml')}: {parsed.error}</p>
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">{t('errorHint')}</p>
          <pre className="m-0 mt-1 whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">{raw.replace(/(?:\r?\n)+$/, '')}</pre>
        </div>
      ) : view === 'read' ? (
        <ReadBody properties={parsed.properties} />
      ) : view === 'edit' ? (
        <div className="pb-1">
          {parsed.properties.map(property => <EditRow key={property.key} property={property} apply={apply} notePath={notePath} />)}
          <AddRow properties={parsed.properties} types={types} apply={apply} />
        </div>
      ) : (
        <div className="px-2.5 pb-2.5">
          <Textarea aria-label={t('source')} spellCheck={false} value={source} onChange={event => setSource(event.target.value)} className="min-h-40 font-mono text-xs" />
          <Button className="mt-2" size="sm" onClick={() => {
            try { validatePropertySource(source) } catch (cause) { setError(`${t('invalidYaml')}: ${cause instanceof Error ? cause.message : String(cause)}`); return }
            const next = source.trim() ? applyFrontmatterEditToBlock(raw, { kind: 'replaceSource', yaml: source }, types) : ''
            if (!next) deleteNode()
            else { if (next !== raw) updateAttributes({ raw: next }); setMode('edit'); setError('') }
          }}>{t('apply')}</Button>
        </div>
      )}
    </NodeViewWrapper>
  )
}
