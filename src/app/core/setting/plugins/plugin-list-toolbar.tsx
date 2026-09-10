'use client'

import { useTranslations } from 'next-intl'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'

export function PluginListToolbar({ query, onQueryChange, placeholder, searchLabel, refreshing, disabled, onRefresh }: {
  query: string
  onQueryChange: (value: string) => void
  placeholder: string
  searchLabel: string
  refreshing: boolean
  disabled: boolean
  onRefresh: () => void
}) {
  const t = useTranslations('settings.plugins')
  return (
    <div className="flex items-center gap-2">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput value={query} onChange={event => onQueryChange(event.target.value)} placeholder={placeholder} aria-label={searchLabel} />
      </InputGroup>
      <Button variant="outline" size="default" disabled={disabled || refreshing} aria-busy={refreshing} onClick={onRefresh}>
        {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
        {refreshing ? t('actions.refreshing') : t('actions.refresh')}
      </Button>
    </div>
  )
}
