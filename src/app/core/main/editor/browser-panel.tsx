'use client'

import { useCallback, useEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react'
import Image from 'next/image'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ArrowLeft, ArrowRight, Bookmark, ChevronDown, ChevronRight, CircleAlert, Clock3, ExternalLink, Globe2, House, RotateCw, Search, Star, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { checkIsTauri } from '@/lib/check'
import { cn } from '@/lib/utils'
import { ControlLink } from '@/app/core/main/mark/control-link'
import useArticleStore from '@/stores/article'
import useBrowserLibraryStore, { type BrowserEntry, type BrowserSearchEngine } from '@/stores/browser'

type BrowserLocation = { tabId: string; url: string; complete: boolean; title?: string }
type BrowserHistoryState = { canGoBack: boolean; canGoForward: boolean }
type Bounds = { x: number; y: number; width: number; height: number }

function measureBrowserBounds(slot: HTMLElement): Bounds | null {
  const rect = slot.getBoundingClientRect()
  let left = Math.max(0, rect.left)
  let top = Math.max(0, rect.top)
  let right = Math.min(window.innerWidth, rect.right)
  let bottom = Math.min(window.innerHeight, rect.bottom)
  for (let parent = slot.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const boundary = parent.getBoundingClientRect()
    left = Math.max(left, boundary.left)
    top = Math.max(top, boundary.top)
    right = Math.min(right, boundary.right)
    bottom = Math.min(bottom, boundary.bottom)
  }
  return right - left >= 1 && bottom - top >= 1
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null
}

function avoidBrowserOverlays(bounds: Bounds | null, overlays: DOMRect[]): Bounds | null {
  if (!bounds) return null
  let visible = bounds
  for (const overlay of overlays) {
    const left = Math.max(visible.x, overlay.left - 4)
    const top = Math.max(visible.y, overlay.top - 4)
    const right = Math.min(visible.x + visible.width, overlay.right + 4)
    const bottom = Math.min(visible.y + visible.height, overlay.bottom + 4)
    if (right <= left || bottom <= top) continue
    const candidates: Bounds[] = [
      { x: visible.x, y: visible.y, width: left - visible.x, height: visible.height },
      { x: right, y: visible.y, width: visible.x + visible.width - right, height: visible.height },
      { x: visible.x, y: visible.y, width: visible.width, height: top - visible.y },
      { x: visible.x, y: bottom, width: visible.width, height: visible.y + visible.height - bottom },
    ].filter(candidate => candidate.width >= 1 && candidate.height >= 1)
    if (candidates.length === 0) return null
    visible = candidates.reduce((largest, candidate) => (
      candidate.width * candidate.height > largest.width * largest.height ? candidate : largest
    ))
  }
  return visible
}

function normalizeAddress(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.toString() : null
  } catch {
    return null
  }
}

function browserTitle(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function browserTabTitle(tabId: string, url: string, title?: string): string {
  if (title !== undefined) return title.trim() || browserTitle(url)
  const tab = useArticleStore.getState().openTabs.find(item => item.id === tabId)
  return tab?.url === url ? tab.name : browserTitle(url)
}

function historyTime(timestamp: number, now: number, locale: string): string {
  const elapsed = Math.max(0, now - timestamp)
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (elapsed < 60_000) return relative.format(0, 'second')
  if (elapsed < 3_600_000) return relative.format(-Math.floor(elapsed / 60_000), 'minute')
  if (elapsed < 86_400_000) return relative.format(-Math.floor(elapsed / 3_600_000), 'hour')
  if (elapsed < 7 * 86_400_000) return relative.format(-Math.floor(elapsed / 86_400_000), 'day')
  const date = new Date(timestamp)
  return date.toLocaleString(locale, {
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const searchEngines: { id: BrowserSearchEngine; name: string; url: (query: string) => string }[] = [
  { id: 'bing', name: 'Bing', url: query => `https://www.bing.com/search?q=${encodeURIComponent(query)}` },
  { id: 'google', name: 'Google', url: query => `https://www.google.com/search?q=${encodeURIComponent(query)}` },
  { id: 'baidu', name: '百度', url: query => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}` },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: query => `https://duckduckgo.com/?q=${encodeURIComponent(query)}` },
]

function BrowserToolbarButton({ tooltip, ...props }: ComponentProps<typeof Button> & { tooltip: string }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex shrink-0">
        <Button {...props} aria-label={tooltip} />
      </span>
    </TooltipTrigger>
    <TooltipContent side="top">{tooltip}</TooltipContent>
  </Tooltip>
}

function resolveSearchAddress(value: string, engine: BrowserSearchEngine): string {
  const query = value.trim()
  const looksLikeAddress = /^https?:\/\//i.test(query)
    || /^localhost(?::\d+)?(?:[/?#]|$)/i.test(query)
    || /^[^\s/]+\.[^\s/]+(?:[/?#:]|$)/.test(query)
  return looksLikeAddress ? query : (searchEngines.find(item => item.id === engine) ?? searchEngines[0]).url(query)
}

export function BrowserPanel({ tabId, url, visible }: { tabId: string; url?: string; visible: boolean }) {
  const t = useTranslations('tabContext')
  const locale = useLocale()
  const { resolvedTheme } = useTheme()
  const nativeTheme = resolvedTheme === 'dark' ? 'dark' : resolvedTheme === 'light' ? 'light' : null
  const updateBrowserTab = useArticleStore(state => state.updateBrowserTab)
  const history = useBrowserLibraryStore(state => state.history)
  const bookmarks = useBrowserLibraryStore(state => state.bookmarks)
  const searchEngine = useBrowserLibraryStore(state => state.searchEngine)
  const setSearchEngine = useBrowserLibraryStore(state => state.setSearchEngine)
  const libraryLoaded = useBrowserLibraryStore(state => state.loaded)
  const loadLibrary = useBrowserLibraryStore(state => state.load)
  const recordVisit = useBrowserLibraryStore(state => state.recordVisit)
  const toggleBookmark = useBrowserLibraryStore(state => state.toggleBookmark)
  const clearHistory = useBrowserLibraryStore(state => state.clearHistory)
  const [address, setAddress] = useState(url ?? '')
  const [searchTerm, setSearchTerm] = useState('')
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(5)
  const [historyNow, setHistoryNow] = useState(() => Date.now())
  const [libraryView, setLibraryView] = useState<'bookmarks' | null>(null)
  const [homeVisible, setHomeVisible] = useState(false)
  const [listenerReady, setListenerReady] = useState(false)
  const [nativeReady, setNativeReady] = useState(false)
  const [historyState, setHistoryState] = useState<BrowserHistoryState>({ canGoBack: false, canGoForward: false })
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [pageSnapshot, setPageSnapshot] = useState<string | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const createdRef = useRef(false)
  const creatingRef = useRef(false)
  const resettingRef = useRef(false)
  const disposedRef = useRef(false)
  const visibleRef = useRef(visible)
  const homeVisibleRef = useRef(homeVisible)
  const desiredUrlRef = useRef(url ?? '')
  const locationVersionRef = useRef(0)
  const historyRequestVersionRef = useRef(0)
  const lastRecordedUrlRef = useRef('')
  const lastBoundsRef = useRef<Bounds | null>(null)
  const overlayElementsRef = useRef<Element[]>([])
  const overlayActiveRef = useRef(false)
  const overlayVersionRef = useRef(0)
  const snapshotFailedRef = useRef(false)
  const geometryVisibleRef = useRef(true)
  const visibilityPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const latestThemeRef = useRef(nativeTheme)
  latestThemeRef.current = nativeTheme

  const requestNativeVisibility = useCallback((requested: boolean) => {
    visibilityPromiseRef.current = visibilityPromiseRef.current.catch(() => {}).then(async () => {
      if (!createdRef.current || disposedRef.current) return
      await invoke('browser_set_visible', {
        tabId,
        visible: requested && visibleRef.current && geometryVisibleRef.current,
      })
    })
    return visibilityPromiseRef.current
  }, [tabId])

  const refreshHistoryState = useCallback(() => {
    if (!createdRef.current || disposedRef.current) return
    const version = ++historyRequestVersionRef.current
    void invoke<BrowserHistoryState>('browser_history_state', { tabId }).then(state => {
      if (version === historyRequestVersionRef.current && !disposedRef.current && createdRef.current) {
        setHistoryState(state)
      }
    }).catch(() => {})
  }, [tabId])

  const shown = visible && !overlayOpen && libraryView === null && !homeVisible
  const canNavigateBack = nativeReady && !homeVisible && (historyState.canGoBack || !!url)
  const canNavigateForward = nativeReady && (homeVisible ? !!url : historyState.canGoForward)
  const isBookmarked = !homeVisible && bookmarks.some(entry => entry.url === url)
  const selectedSearchEngine = searchEngines.find(item => item.id === searchEngine) ?? searchEngines[0]
  visibleRef.current = shown
  homeVisibleRef.current = homeVisible
  desiredUrlRef.current = url ?? ''

  useEffect(() => {
    void loadLibrary().catch(reason => setError(String(reason)))
  }, [loadLibrary])

  useEffect(() => {
    if (!visible || (url && !homeVisible)) return
    setHistoryNow(Date.now())
    const timer = window.setInterval(() => setHistoryNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [visible, url, homeVisible])

  useEffect(() => {
    if (!nativeTheme || !checkIsTauri()) return
    void invoke('browser_set_theme', { theme: nativeTheme }).catch(reason => setError(String(reason)))
  }, [nativeTheme])

  useEffect(() => {
    const update = () => {
      // Radix positions portaled content after mounting it. Its first rect can still be
      // zero-sized or outside the page, so detect the open state instead of its rect.
      const blocked = !!document.querySelector(
        '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])',
      )
      overlayElementsRef.current = Array.from(document.querySelectorAll(
        '[role="menu"]:not([data-state="closed"]), [role="listbox"]:not([data-state="closed"]), [data-slot="popover-content"][data-state="open"]',
      ))
      const active = visible && !!desiredUrlRef.current && !homeVisible && !libraryView && createdRef.current
        && (blocked || overlayElementsRef.current.length > 0)
      if (!active) {
        if (overlayActiveRef.current) {
          overlayActiveRef.current = false
          const version = ++overlayVersionRef.current
          const hadSnapshot = !snapshotFailedRef.current
          snapshotFailedRef.current = false
          setOverlayOpen(false)
          if (hadSnapshot && visible && !!desiredUrlRef.current && !homeVisible && !libraryView && createdRef.current) {
            visibleRef.current = true
            void requestNativeVisibility(true).catch(() => {}).finally(() => {
              if (overlayVersionRef.current === version) setPageSnapshot(null)
            })
          } else {
            setPageSnapshot(null)
          }
        }
        return
      }
      if (overlayActiveRef.current) return
      overlayActiveRef.current = true
      const version = ++overlayVersionRef.current
      void invoke<string>('browser_snapshot', { tabId }).then(snapshot => {
        if (overlayVersionRef.current !== version || disposedRef.current) return
        setPageSnapshot(snapshot)
        setOverlayOpen(true)
      }).catch(() => {
        if (overlayVersionRef.current !== version || disposedRef.current) return
        snapshotFailedRef.current = true
        if (blocked) setOverlayOpen(true)
      })
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-state'] })
    return () => {
      observer.disconnect()
      overlayVersionRef.current += 1
    }
  }, [visible, homeVisible, libraryView, requestNativeVisibility, tabId])

  useEffect(() => {
    if (!checkIsTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listen<BrowserLocation>('browser:location', event => {
      if (resettingRef.current || event.payload.tabId !== tabId || !normalizeAddress(event.payload.url)) return
      createdRef.current = true
      setNativeReady(true)
      locationVersionRef.current += 1
      if (!event.payload.complete && event.payload.title === undefined) {
        historyRequestVersionRef.current += 1
        setHistoryState({ canGoBack: false, canGoForward: false })
      }
      if (!homeVisibleRef.current && document.activeElement !== inputRef.current) setAddress(event.payload.url)
      const title = browserTabTitle(tabId, event.payload.url, event.payload.title)
      void updateBrowserTab(tabId, event.payload.url, title)
      if (event.payload.complete && lastRecordedUrlRef.current !== event.payload.url) {
        lastRecordedUrlRef.current = event.payload.url
        void recordVisit(event.payload.url, title).catch(reason => setError(String(reason)))
      }
      if (event.payload.complete) refreshHistoryState()
    }).then(stop => {
      if (cancelled) stop()
      else {
        unlisten = stop
        setListenerReady(true)
      }
    }).catch(reason => {
      if (!cancelled) setError(String(reason))
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [recordVisit, refreshHistoryState, tabId, updateBrowserTab])

  useEffect(() => {
    if (!visible || overlayOpen || libraryView || (url && !homeVisible)) return
    searchRef.current?.focus()
  }, [visible, overlayOpen, libraryView, homeVisible, url])

  useEffect(() => {
    if (!shown || !url || !listenerReady || !nativeTheme || createdRef.current || creatingRef.current || !checkIsTauri()) return
    const slot = slotRef.current
    if (!slot) return
    const bounds = measureBrowserBounds(slot)
    if (!bounds) return
    creatingRef.current = true
    setError('')
    void invoke('browser_create', { tabId, url, theme: nativeTheme, ...bounds }).then(async () => {
      createdRef.current = true
      if (!disposedRef.current) setNativeReady(true)
      if (latestThemeRef.current && latestThemeRef.current !== nativeTheme) {
        await invoke('browser_set_theme', { theme: latestThemeRef.current }).catch(reason => {
          if (!disposedRef.current) setError(String(reason))
        })
      }
      if (disposedRef.current) {
        if (!useArticleStore.getState().openTabs.some(tab => tab.id === tabId)) {
          await invoke('browser_close', { tabId })
        }
        return
      }
      if (!visibleRef.current) await requestNativeVisibility(false)
      const nextUrl = desiredUrlRef.current
      if (nextUrl && nextUrl !== url) await invoke('browser_navigate', { tabId, url: nextUrl })
    }).catch(reason => {
      if (!disposedRef.current) setError(String(reason))
    }).finally(() => { creatingRef.current = false })
  }, [listenerReady, nativeTheme, requestNativeVisibility, tabId, url, shown])

  useEffect(() => {
    if (!nativeReady) return
    const bounds = shown && slotRef.current
      ? snapshotFailedRef.current
        ? avoidBrowserOverlays(measureBrowserBounds(slotRef.current), overlayElementsRef.current.map(element => element.getBoundingClientRect()))
        : measureBrowserBounds(slotRef.current)
      : null
    const update = shown && bounds
      ? invoke('browser_set_bounds', { tabId, ...bounds }).then(() => {
        lastBoundsRef.current = bounds
        geometryVisibleRef.current = true
        return requestNativeVisibility(true)
      })
      : requestNativeVisibility(false)
    void update.catch(reason => {
      if (!disposedRef.current) setError(String(reason))
    })
  }, [nativeReady, requestNativeVisibility, shown, tabId])

  useEffect(() => {
    if (!nativeReady || !shown) return
    let frame = 0
    const updateBounds = () => {
      const next = slotRef.current
        ? snapshotFailedRef.current
          ? avoidBrowserOverlays(measureBrowserBounds(slotRef.current), overlayElementsRef.current.map(element => element.getBoundingClientRect()))
          : measureBrowserBounds(slotRef.current)
        : null
      if (!next) {
        if (geometryVisibleRef.current) {
          geometryVisibleRef.current = false
          void requestNativeVisibility(false).catch(() => {})
        }
      } else {
        const previous = lastBoundsRef.current
        if (!previous || Object.keys(next).some(key => Math.abs(next[key as keyof Bounds] - previous[key as keyof Bounds]) > 0.5)) {
          lastBoundsRef.current = next
          void invoke('browser_set_bounds', { tabId, ...next }).then(() => {
            if (!geometryVisibleRef.current) {
              geometryVisibleRef.current = true
              return requestNativeVisibility(true)
            }
          }).catch(() => {})
        } else if (!geometryVisibleRef.current) {
          geometryVisibleRef.current = true
          void requestNativeVisibility(true).catch(() => {})
        }
      }
      frame = requestAnimationFrame(updateBounds)
    }
    frame = requestAnimationFrame(updateBounds)
    return () => cancelAnimationFrame(frame)
  }, [nativeReady, requestNativeVisibility, tabId, shown])

  useEffect(() => {
    if (!nativeReady || !shown) return
    const syncUrl = () => {
      refreshHistoryState()
      const version = locationVersionRef.current
      void invoke<string>('browser_get_url', { tabId }).then(currentUrl => {
        if (!normalizeAddress(currentUrl) || disposedRef.current || version !== locationVersionRef.current) return
        if (!homeVisibleRef.current && document.activeElement !== inputRef.current) setAddress(currentUrl)
        const title = browserTabTitle(tabId, currentUrl)
        void updateBrowserTab(tabId, currentUrl, title)
        if (lastRecordedUrlRef.current !== currentUrl) {
          lastRecordedUrlRef.current = currentUrl
          void recordVisit(currentUrl, title).catch(reason => setError(String(reason)))
        }
      }).catch(() => {})
    }
    refreshHistoryState()
    const timer = window.setInterval(syncUrl, 1500)
    return () => window.clearInterval(timer)
  }, [nativeReady, shown, recordVisit, refreshHistoryState, tabId, updateBrowserTab])

  useEffect(() => {
    disposedRef.current = false
    return () => { disposedRef.current = true }
  }, [tabId])

  const showHome = useCallback(() => {
    homeVisibleRef.current = true
    visibleRef.current = false
    setHomeVisible(true)
    setLibraryView(null)
    setAddress('')
    void requestNativeVisibility(false).catch(reason => {
      if (!disposedRef.current) setError(String(reason))
    })
  }, [requestNativeVisibility])

  const navigateHistory = useCallback(async (direction: 'back' | 'forward') => {
    if (direction === 'forward' && homeVisible) {
      homeVisibleRef.current = false
      setHomeVisible(false)
      setAddress(url ?? '')
      return
    }
    if (!nativeReady || homeVisible) return
    try {
      const moved = await invoke<boolean>('browser_history', { tabId, direction })
      if (!moved && direction === 'back') showHome()
    } catch (reason) {
      setError(String(reason))
      toast.error(t('browserOpenFailed'))
    }
  }, [homeVisible, nativeReady, showHome, t, tabId, url])

  const navigateTo = useCallback(async (value: string) => {
    const nextUrl = normalizeAddress(value)
    if (!nextUrl) {
      toast.error(t('browserInvalidUrl'))
      return
    }
    setLibraryView(null)
    setAddress(nextUrl)
    setError('')
    try {
      if (homeVisibleRef.current && createdRef.current) {
        resettingRef.current = true
        await requestNativeVisibility(false)
        await invoke('browser_close', { tabId })
        createdRef.current = false
        setNativeReady(false)
        setHistoryState({ canGoBack: false, canGoForward: false })
        historyRequestVersionRef.current += 1
        lastBoundsRef.current = null
        geometryVisibleRef.current = true
        const update = updateBrowserTab(tabId, nextUrl, browserTitle(nextUrl))
        homeVisibleRef.current = false
        setHomeVisible(false)
        resettingRef.current = false
        await update
      } else if (createdRef.current) {
        await invoke('browser_navigate', { tabId, url: nextUrl })
      } else {
        const update = updateBrowserTab(tabId, nextUrl, browserTitle(nextUrl))
        if (homeVisibleRef.current) {
          homeVisibleRef.current = false
          setHomeVisible(false)
        }
        await update
      }
      inputRef.current?.blur()
    } catch (reason) {
      resettingRef.current = false
      if (homeVisibleRef.current) setAddress('')
      setError(String(reason))
      toast.error(t('browserOpenFailed'))
    }
  }, [requestNativeVisibility, tabId, t, updateBrowserTab])

  const submitAddress = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (address.trim()) void navigateTo(resolveSearchAddress(address, searchEngine))
  }, [address, navigateTo, searchEngine])

  const submitSearch = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (searchTerm.trim()) void navigateTo(resolveSearchAddress(searchTerm, searchEngine))
  }, [navigateTo, searchEngine, searchTerm])

  const changeBookmark = useCallback(() => {
    if (!url) return
    void toggleBookmark(url, browserTabTitle(tabId, url)).catch(reason => {
      setError(String(reason))
      toast.error(t('browserOpenFailed'))
    })
  }, [t, tabId, toggleBookmark, url])

  const clearBrowserHistory = useCallback(() => {
    setVisibleHistoryCount(5)
    void clearHistory().catch(reason => setError(String(reason)))
  }, [clearHistory])

  const renderEntries = (entries: BrowserEntry[], section: 'bookmarks' | 'history') => {
    if (!libraryLoaded) {
      return <div className="flex flex-col gap-3" aria-label={t('browserLibraryLoading')}>
        {[0, 1, 2].map(index => <Skeleton key={index} className="h-7 w-full" />)}
      </div>
    }

    if (entries.length === 0) {
      const Icon = section === 'bookmarks' ? Bookmark : Clock3
      return <Empty className={section === 'history' ? 'min-h-24' : 'min-h-44'}>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Icon /></EmptyMedia>
          <EmptyTitle>{t(section === 'bookmarks' ? 'browserNoBookmarks' : 'browserNoHistory')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    }

    if (section === 'history') {
      return <div className="flex min-w-0 flex-col gap-0.5">
        {entries.map(entry => (
          <Button key={entry.url} variant="ghost" className="h-8 w-full min-w-0 justify-between gap-4 px-2 text-left" title={entry.url} onClick={() => void navigateTo(entry.url)}>
            <span className="min-w-0 flex-1 truncate font-normal">{entry.title || browserTitle(entry.url)}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">{historyTime(entry.timestamp, historyNow, locale)}</span>
          </Button>
        ))}
      </div>
    }

    return <div className="flex min-w-0 flex-col gap-1">
      {entries.map(entry => (
        <div key={entry.url} className="group flex min-w-0 items-center gap-1 rounded-lg hover:bg-muted/50">
          <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start px-2.5 py-2 text-left" onClick={() => void navigateTo(entry.url)}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{entry.title}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">{entry.url}</span>
            </span>
          </Button>
          <BrowserToolbarButton tooltip={t('browserRemoveBookmark')} variant="ghost" size="icon-sm" className="mr-1 text-muted-foreground opacity-70 group-hover:opacity-100" onClick={() => {
            void toggleBookmark(entry.url, entry.title).catch(reason => setError(String(reason)))
          }}><X data-icon="inline-start" /></BrowserToolbarButton>
        </div>
      ))}
    </div>
  }

  const renderHistoryContent = () => <div className="flex min-w-0 flex-col gap-2">
    {renderEntries(history.slice(0, visibleHistoryCount), 'history')}
    {libraryLoaded && history.length > visibleHistoryCount && (
      <Button variant="ghost" size="sm" className="self-center" onClick={() => setVisibleHistoryCount(count => count + 5)}>{t('browserLoadMore')}</Button>
    )}
  </div>

  const renderLibraryCard = () => <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bookmark className="size-4" />
          {t('browserBookmarks')}
        </CardTitle>
      </CardHeader>
      <CardContent>{renderEntries(bookmarks, 'bookmarks')}</CardContent>
    </Card>

  const runBrowserCommand = useCallback((command: string, values?: Record<string, string>) => {
    if (!nativeReady) return
    void invoke(command, { tabId, ...values }).catch(reason => {
      setError(String(reason))
      toast.error(t('browserOpenFailed'))
    })
  }, [nativeReady, tabId, t])

  return (
    <TooltipProvider>
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-2">
        <BrowserToolbarButton tooltip={t('navigateBack')} variant="ghost" size="icon-sm" disabled={!canNavigateBack} onClick={() => void navigateHistory('back')}><ArrowLeft data-icon="inline-start" /></BrowserToolbarButton>
        <BrowserToolbarButton tooltip={t('navigateForward')} variant="ghost" size="icon-sm" disabled={!canNavigateForward} onClick={() => void navigateHistory('forward')}><ArrowRight data-icon="inline-start" /></BrowserToolbarButton>
        <BrowserToolbarButton tooltip={t('browserReload')} variant="ghost" size="icon-sm" disabled={!nativeReady || homeVisible} onClick={() => runBrowserCommand('browser_reload')}><RotateCw data-icon="inline-start" /></BrowserToolbarButton>
        <BrowserToolbarButton tooltip={t('browserBackToStart')} variant="ghost" size="icon-sm" disabled={!url || homeVisible} onClick={showHome}><House data-icon="inline-start" /></BrowserToolbarButton>
        <form onSubmit={submitAddress} className="min-w-0 flex-1 px-1">
          <InputGroup focusRing="subtle">
            <InputGroupInput
              ref={inputRef}
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={address}
              onChange={event => setAddress(event.target.value)}
              onFocus={event => event.currentTarget.select()}
              placeholder={t('browserSearchPlaceholder')}
              aria-label={t('browserSearchPlaceholder')}
            />
            <InputGroupAddon><Globe2 /></InputGroupAddon>
          </InputGroup>
        </form>
        <BrowserToolbarButton tooltip={isBookmarked ? t('browserRemoveBookmark') : t('browserAddBookmark')} variant="ghost" size="icon-sm" aria-pressed={isBookmarked} disabled={!url || homeVisible || !libraryLoaded} onClick={changeBookmark}>
          <Star data-icon="inline-start" className={cn(isBookmarked && 'fill-current text-primary')} />
        </BrowserToolbarButton>
        <ControlLink pageUrl={!homeVisible ? url : undefined} browserTabId={tabId} browserToolbar />
        <BrowserToolbarButton tooltip={t('browserOpenExternal')} variant="ghost" size="icon-sm" disabled={!url || homeVisible} onClick={() => { if (url) void openUrl(url) }}><ExternalLink data-icon="inline-start" /></BrowserToolbarButton>
      </div>
      <div ref={slotRef} className="relative min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {pageSnapshot && <div aria-hidden="true" className="absolute inset-0 bg-background bg-[length:100%_100%] bg-no-repeat" style={{ backgroundImage: `url("${pageSnapshot}")` }} />}
        {(!url || homeVisible) && !libraryView && (
          <div className="h-full w-full min-w-0 overflow-x-hidden overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-5xl min-w-0 flex-col px-5 pb-12 pt-12 md:px-8 md:pt-20">
              <div className="flex w-full min-w-0 flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-3">
                  <Image src="/app-icon.png" alt="NoteGen" width={56} height={56} className="size-14 rounded-2xl dark:invert" />
                  <h1 className="font-heading text-2xl font-semibold tracking-tight">{t('browserStartTitle')}</h1>
                </div>
                <form onSubmit={submitSearch} className="w-full min-w-0">
                  <InputGroup focusRing="subtle" className="h-12 rounded-full shadow-sm">
                    <InputGroupInput
                      ref={searchRef}
                      type="search"
                      value={searchTerm}
                      onChange={event => setSearchTerm(event.target.value)}
                      placeholder={t('browserSearchPlaceholder')}
                      aria-label={t('browserSearchPlaceholder')}
                    />
                    <InputGroupAddon><Search /></InputGroupAddon>
                    <InputGroupAddon align="inline-end">
                      <Tooltip>
                        <TooltipTrigger asChild><span className="inline-flex"><InputGroupButton type="submit" size="icon-xs" aria-label={t('browserSearch')} disabled={!searchTerm.trim()}><ArrowRight data-icon="inline-end" /></InputGroupButton></span></TooltipTrigger>
                        <TooltipContent side="top">{t('browserSearch')}</TooltipContent>
                      </Tooltip>
                    </InputGroupAddon>
                  </InputGroup>
                </form>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label={t('browserSearchEngine')} disabled={!libraryLoaded}>
                      {t('browserSearchEngine')}: {selectedSearchEngine.name}<ChevronDown data-icon="inline-end" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center">
                    <DropdownMenuLabel>{t('browserSearchEngine')}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={searchEngine} onValueChange={value => {
                      void setSearchEngine(value as BrowserSearchEngine).catch(reason => setError(String(reason)))
                    }}>
                      {searchEngines.map(engine => <DropdownMenuRadioItem key={engine.id} value={engine.id}>{engine.name}</DropdownMenuRadioItem>)}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <section className="mt-12 flex min-w-0 flex-col gap-3" aria-label={t('browserBookmarks')}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 font-heading text-sm font-medium"><Bookmark className="size-4" />{t('browserBookmarks')}</h2>
                  {bookmarks.length > 0 && <Button variant="ghost" size="sm" onClick={() => setLibraryView('bookmarks')}>{t('browserViewAll')}<ChevronRight data-icon="inline-end" /></Button>}
                </div>
                {!libraryLoaded ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3">
                    {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}
                  </div>
                ) : bookmarks.length === 0 ? (
                  <Empty className="min-h-32 border border-dashed"><EmptyHeader><EmptyMedia variant="icon"><Bookmark /></EmptyMedia><EmptyTitle>{t('browserNoBookmarks')}</EmptyTitle></EmptyHeader></Empty>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3">
                    {bookmarks.slice(0, 8).map(entry => (
                      <Button key={entry.url} variant="ghost" className="h-24 min-w-0 flex-col gap-2 px-2 py-3" title={entry.url} onClick={() => void navigateTo(entry.url)}>
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-foreground">{browserTitle(entry.url).replace(/^www\./, '').charAt(0).toUpperCase()}</span>
                        <span className="w-full truncate text-center text-xs font-normal">{entry.title}</span>
                      </Button>
                    ))}
                  </div>
                )}
              </section>

              <section className="mt-8 min-w-0" aria-label={t('browserHistory')}>
                <Card size="sm" className="min-w-0">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Clock3 className="size-4" />{t('browserHistory')}</CardTitle>
                    {history.length > 0 && <CardAction><Button variant="ghost" size="sm" onClick={clearBrowserHistory}>{t('browserClearHistory')}</Button></CardAction>}
                  </CardHeader>
                  <CardContent>{renderHistoryContent()}</CardContent>
                </Card>
              </section>
            </div>
          </div>
        )}
        {libraryView && (
          <div className="h-full w-full min-w-0 overflow-x-hidden overflow-y-auto">
            <div className="flex w-full min-w-0 flex-col gap-6 px-5 py-6 md:px-8">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground"><Globe2 className="size-5" /></div>
                  <h2 className="truncate font-heading text-xl font-semibold">{t('browserBookmarks')}</h2>
                </div>
                <Button variant="outline" size="sm" onClick={() => setLibraryView(null)}>{t(url && !homeVisible ? 'browserBackToPage' : 'browserBackToStart')}</Button>
              </div>
              {renderLibraryCard()}
            </div>
          </div>
        )}
        {url && !libraryView && !checkIsTauri() && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('browserUnavailable')}</div>}
        {error && <Alert variant="destructive" className="absolute inset-x-4 top-4 w-auto"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      </div>
    </div>
    </TooltipProvider>
  )
}
