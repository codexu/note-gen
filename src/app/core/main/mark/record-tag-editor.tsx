'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { getMarkById, updateRecordTags, type Mark } from '@/db/marks'
import { recordTagIds } from '@/lib/record-tags'
import useTagStore from '@/stores/tag'
import useMarkStore from '@/stores/mark'
import { toast } from '@/hooks/use-toast'

export function RecordTagEditor({ mark, onSaved }: { mark: Mark; onSaved?: (mark: Mark) => void }) {
  const t = useTranslations('record.tagging')
  const common = useTranslations('common')
  const id = useId()
  const { tags, fetchTags } = useTagStore()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [primary, setPrimary] = useState(mark.tagId)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const originalTagIds = useRef<number[]>([])
  const name = search.trim().replace(/^#/, '').split('/').map(part => part.trim()).join('/')
  const canCreate = name.length > 0 && name.split('/').every(Boolean) && !tags.some(tag => tag.name === name) && !pending.includes(name)
  const choices = tags.filter(tag => tag.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  async function changeOpen(next: boolean) {
    if (saving.current) return
    if (!next) { setOpen(false); return }
    setBusy(true)
    try {
      const [fresh] = await Promise.all([getMarkById(mark.id), fetchTags()])
      if (!fresh || fresh.deleted) return
      setPrimary(fresh.tagId)
      setSelected(recordTagIds(fresh))
      originalTagIds.current = recordTagIds(fresh)
      setSearch('')
      setPending([])
      setOpen(true)
    } catch (error) {
      toast({ title: common('error'), description: String(error), variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function save() {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    try {
      await updateRecordTags(mark.id, selected, originalTagIds.current, pending, primary)
      setOpen(false)
      // A refresh failure is not a failed save; the transaction is already committed.
      try {
        const saved = await getMarkById(mark.id)
        if (saved) {
          originalTagIds.current = recordTagIds(saved)
          onSaved?.(saved)
        }
        await fetchTags()
        await Promise.all([useMarkStore.getState().fetchMarks(), useMarkStore.getState().fetchAllMarks()])
      } catch (error) {
        toast({ title: common('error'), description: t('savedRefreshFailed'), variant: 'destructive' })
        console.error('Record tags saved but refresh failed:', error)
      }
    } catch (error) {
      toast({ title: common('error'), description: String(error), variant: 'destructive' })
    } finally { saving.current = false; setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={next => void changeOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={mark.deleted === 1 || busy}>
          <Tags data-icon="inline-start" />{t('manage')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('manage')}</DialogTitle><DialogDescription>{t('help')}</DialogDescription></DialogHeader>
        <FieldSet disabled={busy}>
          <FieldLegend className="sr-only">{t('manage')}</FieldLegend>
          <FieldGroup>
            <Field><FieldLabel htmlFor={`${id}-search`}>{t('search')}</FieldLabel>
              <Input id={`${id}-search`} value={search} onChange={event => setSearch(event.target.value)} />
            </Field>
            <div className="max-h-64 overflow-y-auto">
              {choices.map(tag => (
                <Field key={tag.id} orientation="horizontal" className="min-h-10" style={{ paddingInlineStart: Math.min(tag.name.split('/').length - 1, 6) * 12 }}>
                  <Checkbox id={`${id}-tag-${tag.id}`} checked={selected.includes(tag.id)} disabled={busy || tag.id === primary}
                    onCheckedChange={checked => setSelected(ids => checked ? [...new Set([...ids, tag.id])] : ids.filter(id => id !== tag.id))} />
                  <FieldLabel htmlFor={`${id}-tag-${tag.id}`} className="min-w-0 break-all">{tag.name}{tag.id === primary ? ` (${t('primary')})` : ''}</FieldLabel>
                </Field>
              ))}
              {pending.map(path => (
                <Field key={path} orientation="horizontal" className="min-h-10">
                  <Checkbox id={`${id}-pending-${path}`} checked disabled={busy} onCheckedChange={() => setPending(paths => paths.filter(item => item !== path))} />
                  <FieldLabel htmlFor={`${id}-pending-${path}`} className="break-all">{path}</FieldLabel>
                </Field>
              ))}
            </div>
            {canCreate ? <Button variant="outline" className="h-auto max-w-full whitespace-normal break-all" onClick={() => { setPending(paths => [...paths, name]); setSearch('') }}>{t('create', { name })}</Button> : null}
          </FieldGroup>
        </FieldSet>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{common('cancel')}</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? common('saving') : common('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
