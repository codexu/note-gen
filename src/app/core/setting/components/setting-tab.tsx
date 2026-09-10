'use client'

import { useMemo, useState } from 'react'
import baseConfig from '../config'
import { useMessages, useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import useUpdateStore from '@/stores/update'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

function collectSearchTerms(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []

  return Object.values(value).flatMap(collectSearchTerms)
}

export function SettingTab() {
  const t = useTranslations('settings')
  const messages = useMessages()
  const { hasUpdate } = useUpdateStore()
  const [query, setQuery] = useState('')
  
  // Add translations to the config
  const config = useMemo(() => {
    const settingMessages = messages.settings as Record<string, unknown> | undefined

    return baseConfig.map(item => {
      if ('group' in item) {
        return {
          ...item,
          title: t(`navigationGroups.${item.group}`),
        }
      }
      return {
        ...item,
        title: t(item.anchor === 'ai' ? 'ai.menuTitle' : `${item.anchor}.title`),
        searchTerms: collectSearchTerms(settingMessages?.[item.anchor]),
      }
    })
  }, [messages.settings, t])

  const filteredConfig = useMemo(() => {
    const searchText = query.trim().toLocaleLowerCase()
    if (!searchText) return config

    const matches: typeof config = []
    let index = 0

    while (index < config.length) {
      const item = config[index]
      if (!('group' in item)) {
        if (
          item.title.toLocaleLowerCase().includes(searchText)
          || item.searchTerms.some(term =>
            term.toLocaleLowerCase().includes(searchText)
          )
        ) {
          matches.push(item)
        }
        index += 1
        continue
      }

      let groupEnd = index + 1
      while (groupEnd < config.length && !('group' in config[groupEnd])) {
        groupEnd += 1
      }

      const groupItems = config.slice(index + 1, groupEnd)
      const matchedItems = item.title.toLocaleLowerCase().includes(searchText)
        ? groupItems
        : groupItems.filter(groupItem => (
            !('group' in groupItem)
            && (
              groupItem.title.toLocaleLowerCase().includes(searchText)
              || groupItem.searchTerms.some(term =>
                term.toLocaleLowerCase().includes(searchText)
              )
            )
          ))

      if (matchedItems.length > 0) {
        matches.push(item, ...matchedItems)
      }
      index = groupEnd
    }

    return matches
  }, [config, query])

  return (
    <div className="flex h-full min-h-0 w-56 shrink-0 flex-col border-r bg-sidebar py-4">
      <div className="shrink-0 px-3">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
          />
        </InputGroup>
      </div>

      {filteredConfig.length === 0 ? (
        <Empty className="min-h-32 p-4">
          <EmptyDescription>{t('noSearchResults')}</EmptyDescription>
        </Empty>
      ) : (
        <TabsList
          variant="sidebar"
          className="!h-auto min-h-0 w-full flex-1 items-stretch justify-start overflow-y-auto rounded-none bg-transparent px-3 py-0"
          aria-label={t('title')}
        >
          {filteredConfig.map((item) => {
            if ('group' in item) {
              return (
                <div
                  key={`group:${item.group}`}
                  role="presentation"
                  className="px-2.5 pb-1 pt-5 text-[11px] font-normal text-muted-foreground/60 first:pt-3"
                >
                  {item.title}
                </div>
              )
            }

            return (
              <TabsTrigger
                key={`section:${item.anchor}`}
                value={item.anchor}
                className="h-8 flex-none px-2.5 has-data-[icon=inline-start]:pl-2.5"
              >
                <span data-icon="inline-start">{item.icon}</span>
                <span className="truncate">{item.title}</span>
                {item.anchor === 'about' && hasUpdate ? (
                  <Badge
                    variant="destructive"
                    className="ml-auto size-2 shrink-0 p-0"
                    aria-hidden
                  />
                ) : null}
              </TabsTrigger>
            )
          })}
        </TabsList>
      )}
    </div>
  )
}
