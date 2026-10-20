'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Eye,
  EyeOff,
  Globe2,
  GripVertical,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Sparkles,
} from 'lucide-react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SettingType } from '../components/setting-base'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  CardDescription,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Switch } from '@/components/ui/switch'
import { OpenBroswer } from '@/components/open-broswer'
import { toast } from '@/hooks/use-toast'
import { checkWebSearchProvider } from '@/lib/web-search/service'
import {
  loadWebSearchSettings,
  saveWebSearchSettings,
  type WebSearchSettings,
} from '@/lib/web-search/settings'
import type { WebSearchApiProvider } from '../config'
import { cn } from '@/lib/utils'

const SEARCH_PROVIDERS: Array<{
  id: WebSearchApiProvider
  name: string
  avatar: string
  apiKeyUrl: string
}> = [
  {
    id: 'zhipu',
    name: '智谱 Web Search',
    avatar: '智',
    apiKeyUrl: 'https://open.bigmodel.cn/apikey/platform',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    avatar: 'T',
    apiKeyUrl: 'https://app.tavily.com/home',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    avatar: 'B',
    apiKeyUrl: 'https://api-dashboard.search.brave.com/app/keys',
  },
  {
    id: 'exa',
    name: 'Exa',
    avatar: 'E',
    apiKeyUrl: 'https://dashboard.exa.ai/api-keys',
  },
]

type CheckState = 'idle' | 'checking' | 'ok' | 'error'
type SearchProviderConfig = typeof SEARCH_PROVIDERS[number]

interface SortableProviderFieldProps {
  provider: SearchProviderConfig
  apiKey: string
  visible: boolean
  checkState: CheckState
  disabled: boolean
  mobile: boolean
  expanded: boolean
  labels: {
    drag: string
    getApiKey: string
    showApiKey: string
    hideApiKey: string
    placeholder: string
    testConnection: string
    testing: string
  }
  onApiKeyChange: (apiKey: string) => void
  onToggleVisibility: () => void
  onCheckConnection: () => void
  onToggleExpanded: () => void
}

function SortableProviderField({
  provider,
  apiKey,
  visible,
  checkState,
  disabled,
  mobile,
  expanded,
  labels,
  onApiKeyChange,
  onToggleVisibility,
  onCheckConnection,
  onToggleExpanded,
}: SortableProviderFieldProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  function renderCheckIcon() {
    if (checkState === 'checking') {
      return <LoaderCircle className="animate-spin" />
    }
    if (checkState === 'ok') {
      return <CheckCircle2 className="text-primary" />
    }
    if (checkState === 'error') {
      return <CircleX className="text-destructive" />
    }
    return <PlugZap />
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="listitem"
      className={cn('relative', !mobile && 'pl-8')}
    >
      {!mobile ? <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 left-0 -translate-y-1/2 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        disabled={disabled}
        aria-label={labels.drag}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button> : null}

      <Field className="rounded-lg border p-3" data-disabled={disabled}>
        <div className="flex min-w-0 items-center gap-2">
        {mobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            disabled={disabled}
            aria-label={labels.drag}
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </Button>
        ) : null}
        <Avatar size="sm">
          <AvatarFallback>{provider.avatar}</AvatarFallback>
        </Avatar>
        <FieldLabel
          htmlFor={`web-search-key-${provider.id}`}
          className="min-w-0 flex-1 truncate"
        >
          {provider.name}
        </FieldLabel>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!apiKey.trim() || checkState === 'checking'}
          aria-label={checkState === 'checking' ? labels.testing : labels.testConnection}
          onClick={onCheckConnection}
        >
          {renderCheckIcon()}
        </Button>
        {mobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={provider.name}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
          </Button>
        ) : null}
        </div>

        {!mobile || expanded ? <div className="flex min-w-0 gap-2">
          <InputGroup className={cn('min-w-0 flex-1', mobile && 'h-11')}>
            <InputGroupAddon><KeyRound /></InputGroupAddon>
            <InputGroupInput
              id={`web-search-key-${provider.id}`}
              type={visible ? 'text' : 'password'}
              value={apiKey}
              disabled={disabled}
              autoComplete="off"
              aria-label={labels.placeholder}
              placeholder={labels.placeholder}
              onChange={(event) => onApiKeyChange(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                disabled={!apiKey}
                aria-label={visible ? labels.hideApiKey : labels.showApiKey}
                onClick={onToggleVisibility}
              >
                {visible ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <OpenBroswer
            type="button"
            url={provider.apiKeyUrl}
            title={labels.getApiKey}
            className={cn('shrink-0', mobile && 'h-11')}
          />
        </div> : null}
      </Field>
    </div>
  )
}

export default function WebSearchSettingPage({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations('settings.webSearch')
  const [settings, setSettings] = useState<WebSearchSettings>()
  const [visibleKeys, setVisibleKeys] = useState<Partial<Record<WebSearchApiProvider, boolean>>>({})
  const [checkStates, setCheckStates] = useState<Partial<Record<WebSearchApiProvider, CheckState>>>({})
  const [expandedProviders, setExpandedProviders] = useState<Set<WebSearchApiProvider>>(new Set())
  const settingsRef = useRef<WebSearchSettings | undefined>(undefined)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveTimerRef = useRef<number | undefined>(undefined)
  const checkRequestRef = useRef<{
    provider: WebSearchApiProvider
    controller: AbortController
  } | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  useEffect(() => {
    let cancelled = false

    loadWebSearchSettings().then((loaded) => {
      if (cancelled) return
      settingsRef.current = loaded
      setSettings(loaded)
    })

    return () => {
      cancelled = true
      checkRequestRef.current?.controller.abort()
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current)
        const pendingSettings = settingsRef.current
        if (pendingSettings) {
          writeQueueRef.current = writeQueueRef.current.then(
            () => saveWebSearchSettings(pendingSettings)
          )
        }
      }
    }
  }, [])

  function persistSettings(next: WebSearchSettings, delay = false) {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }

    const enqueueSave = () => {
      writeQueueRef.current = writeQueueRef.current.then(() => saveWebSearchSettings(next))
    }
    if (!delay) {
      enqueueSave()
      return
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined
      enqueueSave()
    }, 350)
  }

  function updateSettings(patch: Partial<WebSearchSettings>, delaySave = false) {
    const next = {
      ...(settingsRef.current || {
        nativeEnabled: true,
        thirdPartyEnabled: true,
        basicEnabled: true,
        provider: 'auto' as const,
        apiKeys: {},
        providerOrder: SEARCH_PROVIDERS.map(provider => provider.id),
      }),
      ...patch,
    }
    settingsRef.current = next
    setSettings(next)
    persistSettings(next, delaySave)
  }

  function updateApiKey(provider: WebSearchApiProvider, apiKey: string) {
    setCheckStates(current => ({ ...current, [provider]: 'idle' }))
    updateSettings(
      {
        apiKeys: {
          ...(settingsRef.current?.apiKeys || {}),
          [provider]: apiKey,
        },
      },
      true
    )
  }

  async function handleCheckConnection(provider: WebSearchApiProvider) {
    const apiKey = settingsRef.current?.apiKeys[provider]?.trim()
    if (!apiKey) return

    const previousRequest = checkRequestRef.current
    previousRequest?.controller.abort()
    if (previousRequest) {
      setCheckStates(current => ({ ...current, [previousRequest.provider]: 'idle' }))
    }

    const controller = new AbortController()
    checkRequestRef.current = { provider, controller }
    setCheckStates(current => ({ ...current, [provider]: 'checking' }))

    try {
      const result = await checkWebSearchProvider(provider, apiKey, controller.signal)
      setCheckStates(current => ({ ...current, [provider]: 'ok' }))
      toast({ description: t('testSuccess', { count: result.sources.length }) })
    } catch (error) {
      if (controller.signal.aborted) return
      setCheckStates(current => ({ ...current, [provider]: 'error' }))
      toast({
        variant: 'destructive',
        description: t('testFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      if (checkRequestRef.current?.controller === controller) {
        checkRequestRef.current = null
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const currentOrder = settingsRef.current?.providerOrder
      || SEARCH_PROVIDERS.map(provider => provider.id)
    const oldIndex = currentOrder.indexOf(active.id as WebSearchApiProvider)
    const newIndex = currentOrder.indexOf(over.id as WebSearchApiProvider)
    if (oldIndex < 0 || newIndex < 0) return

    updateSettings({ providerOrder: arrayMove(currentOrder, oldIndex, newIndex) })
  }

  const providerOrder = settings?.providerOrder
    || SEARCH_PROVIDERS.map(provider => provider.id)
  const orderedProviders = providerOrder.flatMap(providerId => (
    SEARCH_PROVIDERS.filter(provider => provider.id === providerId)
  ))

  return (
    <SettingType id="webSearch" title={t('title')} desc={t('desc')} icon={<Globe2 />}>
      <div className="flex flex-col">
          <div className="rounded-xl border border-dashed bg-muted/20 p-4 sm:p-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t('nativeLayerTitle')}</CardTitle>
                  <CardDescription>{t('nativeLayerDesc')}</CardDescription>
                </div>
              </div>
              <Switch
                aria-label={t('nativeEnabled')}
                checked={settings?.nativeEnabled !== false}
                disabled={!settings}
                onCheckedChange={(nativeEnabled) => updateSettings({ nativeEnabled })}
              />
            </div>
          </div>

          <div className="flex h-14 items-center gap-3 pl-5 text-muted-foreground sm:pl-8">
            <div className="h-full w-px bg-border" />
            <ArrowDown className="size-4 shrink-0" />
            <span className="text-xs font-medium">
              {settings?.nativeEnabled === false
                ? t('fallbackWhenNativeDisabled')
                : t('fallbackWhenUnavailable')}
            </span>
          </div>

          <div className="rounded-xl border border-dashed bg-card">
            <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <KeyRound className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t('thirdPartyLayerTitle')}</CardTitle>
                  <CardDescription>{t('thirdPartyLayerDesc')}</CardDescription>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Switch
                  aria-label={t('thirdPartyEnabled')}
                  checked={settings?.thirdPartyEnabled !== false}
                  disabled={!settings}
                  onCheckedChange={(thirdPartyEnabled) => updateSettings({ thirdPartyEnabled })}
                />
              </div>
            </div>

            <div className="p-4 pt-0 sm:p-5 sm:pt-0">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedProviders.map(provider => provider.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <FieldGroup className="gap-2">
                    {orderedProviders.map(provider => (
                      <SortableProviderField
                        key={provider.id}
                        provider={provider}
                        apiKey={settings?.apiKeys[provider.id] || ''}
                        visible={visibleKeys[provider.id] === true}
                        checkState={checkStates[provider.id] || 'idle'}
                        disabled={!settings}
                        mobile={mobile}
                        expanded={expandedProviders.has(provider.id)}
                        labels={{
                          drag: t('dragProvider', { provider: provider.name }),
                          getApiKey: t('getApiKey'),
                          showApiKey: t('showApiKey'),
                          hideApiKey: t('hideApiKey'),
                          placeholder: t('providerApiKeyPlaceholder', { provider: provider.name }),
                          testConnection: t('testConnection'),
                          testing: t('testing'),
                        }}
                        onApiKeyChange={(apiKey) => updateApiKey(provider.id, apiKey)}
                        onToggleVisibility={() => setVisibleKeys(current => ({
                          ...current,
                          [provider.id]: current[provider.id] !== true,
                        }))}
                        onCheckConnection={() => void handleCheckConnection(provider.id)}
                        onToggleExpanded={() => setExpandedProviders(current => {
                          const next = new Set(current)
                          if (next.has(provider.id)) next.delete(provider.id)
                          else next.add(provider.id)
                          return next
                        })}
                      />
                    ))}
                  </FieldGroup>
                </SortableContext>
              </DndContext>
            </div>
          </div>

          <div className="flex h-14 items-center gap-3 pl-5 text-muted-foreground sm:pl-8">
            <div className="h-full w-px bg-border" />
            <ArrowDown className="size-4 shrink-0" />
            <span className="text-xs font-medium">
              {settings?.thirdPartyEnabled === false
                ? t('fallbackWhenDisabled')
                : t('fallbackWhenUnavailable')}
            </span>
          </div>

          <div className="rounded-xl border border-dashed bg-muted/10 p-4 sm:p-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Globe2 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t('basicLayerTitle')}</CardTitle>
                  <CardDescription>{t('basicLayerDesc')}</CardDescription>
                </div>
              </div>
              <Switch
                aria-label={t('basicEnabled')}
                checked={settings?.basicEnabled !== false}
                disabled={!settings}
                onCheckedChange={(basicEnabled) => updateSettings({ basicEnabled })}
              />
            </div>
          </div>
      </div>
    </SettingType>
  )
}
