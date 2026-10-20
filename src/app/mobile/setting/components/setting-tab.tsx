"use client";

import { useRouter } from "next/navigation";
import baseConfig, { type SettingNavigationGroup } from '@/app/core/setting/config'
import { useMessages, useTranslations } from 'next-intl'
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from 'react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import type { SettingSection } from '@/stores/settings-dialog'

const MOBILE_ME_SCROLL_KEY = 'mobile-me-scroll-top'
let mobileSettingQueryCache = ''

type MobileSettingNavigationItem =
  | {
      separator: SettingNavigationGroup
    }
  | {
      title: string
      icon: ReactNode
      anchor: SettingSection
    }

function collectSearchTerms(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectSearchTerms)
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectSearchTerms)
  }
  return []
}

export function SettingTab({
  restoreSheetOnNavigate = false,
  onNavigate,
}: {
  restoreSheetOnNavigate?: boolean
  onNavigate?: () => void
}) {
  const router = useRouter()
  const t = useTranslations('settings')
  const messages = useMessages()
  const [query, setQuery] = useState(() => mobileSettingQueryCache)
  const notMobilePages = ['about', 'backup', 'shortcuts', 'plugins']
  
  const config = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const settingsMessages = (
      messages as { settings?: Record<string, unknown> }
    ).settings ?? {}
    const exactAnchorQuery = baseConfig.some(item => (
      'anchor' in item && item.anchor.toLocaleLowerCase() === normalizedQuery
    ))
    const visibleConfig = baseConfig.reduce<MobileSettingNavigationItem[]>((items, item) => {
      if ('group' in item) {
        items.push({ separator: item.group })
      } else if (!notMobilePages.includes(item.anchor)) {
        const title = t(item.anchor === 'ai' ? 'ai.menuTitle' : `${item.anchor}.title`)
        const searchTerms = [
          item.anchor,
          title,
          ...collectSearchTerms(settingsMessages[item.anchor]),
        ]
        const matchesQuery = exactAnchorQuery
          ? item.anchor.toLocaleLowerCase() === normalizedQuery
          : searchTerms.some(term => term.toLocaleLowerCase().includes(normalizedQuery))
        if (!normalizedQuery || matchesQuery) {
          items.push({ ...item, title })
        }
      }
      return items
    }, [])

    return visibleConfig.filter((item, index, items) => {
      if (!('separator' in item)) return true
      return index < items.length - 1
        && !('separator' in items[index + 1])
        && items.slice(index + 1).some(next => !('separator' in next))
    })
  }, [messages, query, t])

  function handleNavigation(anchor: string) {
    const mePage = document.getElementById('mobile-me')
    if (mePage) {
      window.sessionStorage.setItem(MOBILE_ME_SCROLL_KEY, String(mePage.scrollTop))
    }
    if (restoreSheetOnNavigate) {
      window.sessionStorage.setItem('mobile-me-restore-open', 'true')
    }
    onNavigate?.()
    router.push(`/mobile/setting/pages/${anchor}`)
  }

  return (
    <div className="flex flex-col gap-5">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={event => {
            mobileSettingQueryCache = event.target.value
            setQuery(event.target.value)
          }}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
        />
      </InputGroup>

      {config.length > 0 ? (
        <ItemGroup className="gap-0">
          {config.map((item, index) => {
          if ('separator' in item) {
            return (
              <div key={`${item.separator}-${index}`} className="pb-1 pt-5 first:pt-0">
                <h2 className="px-1 text-xs font-medium text-muted-foreground">
                  {t(`navigationGroups.${item.separator}`)}
                </h2>
              </div>
            )
          }
          
          return (
            <Item key={item.anchor} asChild className="mobile-setting-inline-item rounded-xl px-1 active:bg-muted">
              <button type="button" onClick={() => handleNavigation(item.anchor)}>
                <ItemMedia variant="icon">{item.icon}</ItemMedia>
                <ItemContent>
                  <ItemTitle>{item.title}</ItemTitle>
                </ItemContent>
                <ItemActions className="mobile-setting-inline-action">
                  <ChevronRight className="size-4 text-muted-foreground" />
                </ItemActions>
              </button>
            </Item>
          )
          })}
        </ItemGroup>
      ) : (
        <Empty className="min-h-40 border-0 p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Search /></EmptyMedia>
            <EmptyTitle>{t('noSearchResults')}</EmptyTitle>
            <EmptyDescription>{t('searchPlaceholder')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
