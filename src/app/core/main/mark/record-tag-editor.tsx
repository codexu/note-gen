'use client'

import { useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { getMarkById, updateRecordTags, type Mark } from '@/db/marks'
import { recordTagIds } from '@/lib/record-tags'
import useTagStore from '@/stores/tag'
import useMarkStore from '@/stores/mark'
import { toast } from '@/hooks/use-toast'

export function RecordTagEditor({ mark, open, onOpenChange, onSaved, onCloseAutoFocus }: {
  mark: Mark
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (mark: Mark) => void
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>['onCloseAutoFocus']
}) {
  const t = useTranslations('record.tagging')
  const common = useTranslations('common')
  const id = useId()
  const tags = useTagStore(state => state.tags)
  const fetchTags = useTagStore(state => state.fetchTags)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number[]>([])
  const [primary, setPrimary] = useState(mark.tagId)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const saving = useRef(false)
  const originalTagIds = useRef<number[]>([])
  const name = search.trim().replace(/^#/, '').split('/').map(part => part.trim()).join('/')
  const canCreate = name.length > 0 && name.split('/').every(Boolean) && !tags.some(tag => tag.name === name) && !pending.includes(name)
  const query = search.toLocaleLowerCase()
  const choices = open && !loading
    ? tags.filter(tag => tag.name.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name))
    : []

  useLayoutEffect(() => {
    if (!open) return
    setLoading(true)
    let cancelled = false
    void Promise.all([getMarkById(mark.id), fetchTags()]).then(([fresh]) => {
      if (cancelled) return
      if (!fresh || fresh.deleted) {
        onOpenChange(false)
        return
      }
      const selectedIds = recordTagIds(fresh)
      setPrimary(fresh.tagId)
      setSelected(selectedIds)
      originalTagIds.current = selectedIds
      setSearch('')
      setPending([])
      setLoading(false)
    }).catch(error => {
      if (cancelled) return
      onOpenChange(false)
      toast({ title: common('error'), description: String(error), variant: 'destructive' })
    })
    return () => { cancelled = true }
  }, [common, fetchTags, mark.id, onOpenChange, open])

  async function save() {
    if (loading || saving.current) return
    saving.current = true
    setIsSaving(true)
    try {
      await updateRecordTags(mark.id, selected, originalTagIds.current, pending, primary)
      onOpenChange(false)
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
    } finally { saving.current = false; setIsSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving.current) onOpenChange(next) }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader><DialogTitle>{t('manage')}</DialogTitle><DialogDescription>{t('help')}</DialogDescription></DialogHeader>
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
            {common('loading')}
          </p>
        ) : <FieldSet disabled={isSaving}>
          <FieldLegend className="sr-only">{t('manage')}</FieldLegend>
          <FieldGroup>
            <Field><FieldLabel htmlFor={`${id}-search`}>{t('search')}</FieldLabel>
              <Input id={`${id}-search`} value={search} onChange={event => setSearch(event.target.value)} />
            </Field>
            <div className="max-h-64 overflow-y-auto">
              {choices.map(tag => (
                <Field key={tag.id} orientation="horizontal" className="min-h-10" style={{ paddingInlineStart: Math.min(tag.name.split('/').length - 1, 6) * 12 }}>
                  <Checkbox id={`${id}-tag-${tag.id}`} checked={selected.includes(tag.id)} disabled={isSaving || tag.id === primary}
                    onCheckedChange={checked => setSelected(ids => checked ? [...new Set([...ids, tag.id])] : ids.filter(id => id !== tag.id))} />
                  <FieldLabel htmlFor={`${id}-tag-${tag.id}`} className="min-w-0 break-all">{tag.name}{tag.id === primary ? ` (${t('primary')})` : ''}</FieldLabel>
                </Field>
              ))}
              {pending.map(path => (
                <Field key={path} orientation="horizontal" className="min-h-10">
                  <Checkbox id={`${id}-pending-${path}`} checked disabled={isSaving} onCheckedChange={() => setPending(paths => paths.filter(item => item !== path))} />
                  <FieldLabel htmlFor={`${id}-pending-${path}`} className="break-all">{path}</FieldLabel>
                </Field>
              ))}
            </div>
            {canCreate ? <Button variant="outline" className="h-auto max-w-full whitespace-normal break-all" onClick={() => { setPending(paths => [...paths, name]); setSearch('') }}>{t('create', { name })}</Button> : null}
          </FieldGroup>
        </FieldSet>}
        <DialogFooter>
          <Button variant="outline" disabled={isSaving} onClick={() => onOpenChange(false)}>{common('cancel')}</Button>
          <Button disabled={loading || isSaving} onClick={() => void save()}>{isSaving ? common('saving') : common('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
