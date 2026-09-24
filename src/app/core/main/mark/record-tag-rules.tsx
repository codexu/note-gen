'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import useTagStore from '@/stores/tag'
import useMarkStore from '@/stores/mark'
import { tagPaths, tagPathMatches } from '@/lib/record-tags'

export function RecordTagRules() {
  const t = useTranslations('record.tagging')
  const filter = useTranslations('record.mark.toolbar.filter')
  const id = useId()
  const tags = useTagStore(state => state.tags)
  const { recordFilters, setRecordTagRules, setRecordTagId, recordTagFiltersAdjusted } = useMarkStore()
  const rules = recordFilters.tagRules
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const paths = [...new Set([...tagPaths(tags), ...rules.include, ...rules.exclude])].sort((a, b) => a.localeCompare(b))
  const visiblePaths = paths.filter(path => search
    ? path.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    : !collapsed.some(parent => parent !== path && tagPathMatches(path, parent)))

  return (
    <FieldSet>
      <FieldLegend>{t('rules')}</FieldLegend>
      <FieldDescription>{t('rulesHelp')}</FieldDescription>
      {recordTagFiltersAdjusted ? <FieldDescription role="status">{t('filtersAdjusted')}</FieldDescription> : null}
      <FieldGroup className="gap-3">
        <Field><FieldLabel htmlFor={`${id}-scope`}>{filter('tag')}</FieldLabel>
          <Select value={String(recordFilters.tagId)} onValueChange={value => setRecordTagId(value === 'all' ? 'all' : Number(value))}>
            <SelectTrigger id={`${id}-scope`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="all">{filter('allTags')}</SelectItem>
              {tags.map(tag => <SelectItem key={tag.id} value={String(tag.id)}>{tag.name}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field><FieldLabel htmlFor={`${id}-mode`}>{t('match')}</FieldLabel>
          <Select value={rules.match} onValueChange={value => setRecordTagRules({ ...rules, match: value === 'any' ? 'any' : 'all' })}>
            <SelectTrigger id={`${id}-mode`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="all">{t('all')}</SelectItem><SelectItem value="any">{t('any')}</SelectItem></SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field><FieldLabel className="sr-only" htmlFor={`${id}-search`}>{t('search')}</FieldLabel>
          <Input id={`${id}-search`} placeholder={t('search')} value={search} onChange={event => setSearch(event.target.value)} />
        </Field>
        <div className="max-h-56 overflow-y-auto">
          {visiblePaths.map(path => {
            const hasChildren = paths.some(child => child !== path && tagPathMatches(child, path))
            return (
              <Field key={path} orientation="horizontal" className="min-h-11 gap-2" style={{ paddingInlineStart: Math.min(path.split('/').length - 1, 4) * 8 }}>
                {hasChildren ? <Button size="icon" variant="ghost" aria-label={path} aria-expanded={!collapsed.includes(path)} onClick={() => setCollapsed(items => items.includes(path) ? items.filter(item => item !== path) : [...items, path])}>
                  {collapsed.includes(path) ? <ChevronRight /> : <ChevronDown />}
                </Button> : null}
                <FieldLabel htmlFor={`${id}-${path}`} className="min-w-0 flex-1 break-all">{path}</FieldLabel>
                <Select value={rules.exclude.includes(path) ? 'exclude' : rules.include.includes(path) ? 'include' : 'ignore'} onValueChange={value => setRecordTagRules({
                  ...rules,
                  include: [...rules.include.filter(item => item !== path), ...(value === 'include' ? [path] : [])],
                  exclude: [...rules.exclude.filter(item => item !== path), ...(value === 'exclude' ? [path] : [])],
                })}>
                  <SelectTrigger id={`${id}-${path}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="ignore">{t('ignore')}</SelectItem>
                    <SelectItem value="include">{t('include')}</SelectItem>
                    <SelectItem value="exclude">{t('exclude')}</SelectItem>
                  </SelectGroup></SelectContent>
                </Select>
              </Field>
            )
          })}
        </div>
      </FieldGroup>
    </FieldSet>
  )
}
