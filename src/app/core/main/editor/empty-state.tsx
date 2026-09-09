'use client'

import { FileText, MessageSquareText, Search, FolderOpen, GripVertical, SlidersHorizontal } from 'lucide-react'
import useArticleStore from '@/stores/article'
import { useTranslations } from 'next-intl'
import { open } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import Image from 'next/image'
import emitter from '@/lib/emitter'
import { useEffect, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import useShortcutStore from '@/stores/shortcut'
import useSettingStore from '@/stores/setting'
import { useSidebarStore } from '@/stores/sidebar'
import { getActiveOnboardingStep, getNextOnboardingStep, isOnboardingComplete, type OnboardingProgress, type OnboardingStepId } from './onboarding-state'
import { createNewNoteFromEmptyState } from './empty-state-actions'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { ActivityPanel } from '@/components/activity/activity-panel'
import { useActivityData } from '@/components/activity/use-activity-data'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const NEW_TAB_VISIBILITY_STORE_KEY = 'newTabSectionVisibility'

const NEW_TAB_SECTION_IDS = [
  'onboarding',
  'actions',
  'activity',
  'activityDetail',
] as const

const LEGACY_ACTIVITY_SECTION_IDS = ['activitySummary', 'activityHeatmap'] as const

type NewTabSectionId = typeof NEW_TAB_SECTION_IDS[number]
type NewTabSectionVisibility = Record<NewTabSectionId, boolean>

interface NewTabPreferences {
  visibility: NewTabSectionVisibility
  order: NewTabSectionId[]
}

const DEFAULT_NEW_TAB_VISIBILITY: NewTabSectionVisibility = {
  actions: true,
  onboarding: true,
  activity: true,
  activityDetail: false,
}

const DEFAULT_NEW_TAB_PREFERENCES: NewTabPreferences = {
  visibility: DEFAULT_NEW_TAB_VISIBILITY,
  order: [...NEW_TAB_SECTION_IDS],
}

type LegacyActivitySectionId = typeof LEGACY_ACTIVITY_SECTION_IDS[number]
type StoredNewTabSectionVisibility = Partial<NewTabSectionVisibility> & Partial<Record<LegacyActivitySectionId, boolean>>

type StoredNewTabPreferences = StoredNewTabSectionVisibility & {
  visibility?: StoredNewTabSectionVisibility
  order?: unknown
}

function isNewTabSectionId(value: unknown): value is NewTabSectionId {
  return typeof value === 'string' && NEW_TAB_SECTION_IDS.includes(value as NewTabSectionId)
}

function normalizeNewTabOrder(value: unknown): NewTabSectionId[] {
  if (!Array.isArray(value)) return [...DEFAULT_NEW_TAB_PREFERENCES.order]
  const saved = value
    .map(item => LEGACY_ACTIVITY_SECTION_IDS.includes(item as LegacyActivitySectionId) ? 'activity' : item)
    .filter(isNewTabSectionId)
  const unique = [...new Set(saved)]
  return [...unique, ...NEW_TAB_SECTION_IDS.filter(id => !unique.includes(id))]
}

interface SortableCustomizationItemProps {
  id: NewTabSectionId
  label: string
  dragLabel: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

function SortableCustomizationItem({
  id,
  label,
  dragLabel,
  checked,
  onCheckedChange,
}: SortableCustomizationItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <DropdownMenuCheckboxItem
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      checked={checked}
      onCheckedChange={value => onCheckedChange(value === true)}
      onSelect={event => event.preventDefault()}
    >
      <span
        aria-label={dragLabel}
        className="flex cursor-grab touch-none items-center active:cursor-grabbing"
        onClick={event => event.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenuCheckboxItem>
  )
}

interface ActionItem {
  icon: React.ReactNode
  title: string
  description: string
  shortcut?: string
  onClick: () => void
}

interface EmptyStateProps {
  enableShortcuts?: boolean
  onboardingProgress: OnboardingProgress
  activeOnboardingStep: OnboardingStepId | null
  visibleOnboardingStep: OnboardingStepId | null
  completedOnboardingStep: OnboardingStepId | null
  onStartOnboardingStep: (step: OnboardingStepId) => void | Promise<void>
  onContinueToNextStep: () => void | Promise<void>
  onResetOnboarding: () => void | Promise<void>
}

export function EmptyState({
  enableShortcuts = true,
  onboardingProgress,
  activeOnboardingStep,
  visibleOnboardingStep,
  completedOnboardingStep,
  onStartOnboardingStep,
  onContinueToNextStep,
  onResetOnboarding,
}: EmptyStateProps) {
  const { newFile } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const t = useTranslations('article.emptyState')
  const { shortcuts } = useShortcutStore()
  const { setWorkspacePath } = useSettingStore()
  const [textRecordShortcut, setTextRecordShortcut] = useState('')
  const [preferences, setPreferences] = useState(DEFAULT_NEW_TAB_PREFERENCES)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    let disposed = false
    void Store.load('store.json').then(async store => {
      const saved = await store.get<StoredNewTabPreferences>(NEW_TAB_VISIBILITY_STORE_KEY)
      if (disposed || !saved) return
      const savedVisibility = saved.visibility ?? saved
      const hasLegacyActivityVisibility = LEGACY_ACTIVITY_SECTION_IDS.some(
        section => typeof savedVisibility[section] === 'boolean',
      )
      const nextPreferences: NewTabPreferences = {
        visibility: {
          actions: typeof savedVisibility.actions === 'boolean' ? savedVisibility.actions : DEFAULT_NEW_TAB_VISIBILITY.actions,
          onboarding: typeof savedVisibility.onboarding === 'boolean' ? savedVisibility.onboarding : DEFAULT_NEW_TAB_VISIBILITY.onboarding,
          activity: typeof savedVisibility.activity === 'boolean'
            ? savedVisibility.activity
            : hasLegacyActivityVisibility
              ? LEGACY_ACTIVITY_SECTION_IDS.some(section => savedVisibility[section] === true)
              : DEFAULT_NEW_TAB_VISIBILITY.activity,
          activityDetail: typeof savedVisibility.activityDetail === 'boolean' ? savedVisibility.activityDetail : DEFAULT_NEW_TAB_VISIBILITY.activityDetail,
        },
        order: normalizeNewTabOrder(saved.order),
      }
      setPreferences(nextPreferences)
      await store.set(NEW_TAB_VISIBILITY_STORE_KEY, nextPreferences)
      await store.save()
    }).catch(error => {
      console.error('Failed to load new tab customization:', error)
    })
    return () => { disposed = true }
  }, [])

  const persistPreferences = (next: NewTabPreferences) => {
    void Store.load('store.json').then(async store => {
      await store.set(NEW_TAB_VISIBILITY_STORE_KEY, next)
      await store.save()
    }).catch(error => {
      console.error('Failed to save new tab customization:', error)
    })
  }

  const handleSectionVisibilityChange = (section: NewTabSectionId, checked: boolean) => {
    const next = {
      ...preferences,
      visibility: { ...preferences.visibility, [section]: checked },
    }
    setPreferences(next)
    persistPreferences(next)
  }

  const handleResetPreferences = () => {
    const next = {
      visibility: { ...DEFAULT_NEW_TAB_PREFERENCES.visibility },
      order: [...DEFAULT_NEW_TAB_PREFERENCES.order],
    }
    setPreferences(next)
    persistPreferences(next)
  }

  const handleResetOnboarding = async () => {
    if (!preferences.visibility.onboarding) {
      const next = {
        ...preferences,
        visibility: { ...preferences.visibility, onboarding: true },
      }
      setPreferences(next)
      persistPreferences(next)
    }
    await onResetOnboarding()
  }

  const handleCreateNote = async () => {
    await createNewNoteFromEmptyState({
      setLeftSidebarTab,
      newFile,
    })
  }

  // 注册快捷键
  useEffect(() => {
    if (!enableShortcuts) return
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + N 创建笔记
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        void handleCreateNote()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enableShortcuts, newFile, setLeftSidebarTab])

  // 读取文本记录快捷键
  useEffect(() => {
    const shortcut = shortcuts.find(s => s.key === 'quickRecordText')
    if (shortcut) {
      // 转换快捷键格式：CommandOrControl+Shift+T -> ⌘ ⇧ T
      const formatted = shortcut.value
        .replace('CommandOrControl', '⌘')
        .replace('Command', '⌘')
        .replace('Control', 'Ctrl')
        .replace('Shift', '⇧')
        .replace('Alt', '⌥')
        .replace('+', ' ')
      setTextRecordShortcut(formatted)
    }
  }, [shortcuts])

  const handleOpenWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择工作区目录'
      })
      
      if (selected && typeof selected === 'string') {
        await setWorkspacePath(selected)
        // 重新加载页面以应用新工作区
        window.location.reload()
      }
    } catch (error) {
      console.error('Failed to open workspace:', error)
    }
  }

  const handleOpenRecord = () => {
    // 触发文本记录弹窗
    emitter.emit('quickRecordTextHandler')
  }

  const handleGlobalSearch = () => {
    // 触发全局搜索弹窗 (Cmd/Ctrl + F)
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      ctrlKey: true,
      bubbles: true
    })
    window.dispatchEvent(event)
  }

  const actions: ActionItem[] = [
    {
      icon: <FileText data-icon="inline-start" />,
      title: t('actions.newNote.title'),
      description: t('actions.newNote.desc'),
      shortcut: '⌘ N',
      onClick: () => void handleCreateNote()
    },
    {
      icon: <MessageSquareText data-icon="inline-start" />,
      title: t('actions.newRecord.title'),
      description: t('actions.newRecord.desc'),
      shortcut: textRecordShortcut,
      onClick: handleOpenRecord
    },
    {
      icon: <Search data-icon="inline-start" />,
      title: t('actions.globalSearch.title'),
      description: t('actions.globalSearch.desc'),
      shortcut: '⌘ F',
      onClick: handleGlobalSearch
    },
    {
      icon: <FolderOpen data-icon="inline-start" />,
      title: t('actions.openWorkspace.title'),
      description: t('actions.openWorkspace.desc'),
      onClick: handleOpenWorkspace
    }
  ]

  const onboardingSteps: Array<{ id: OnboardingStepId; title: string; description: string }> = [
    {
      id: 'create-record',
      title: t('onboarding.steps.createRecord.title'),
      description: t('onboarding.steps.createRecord.desc'),
    },
    {
      id: 'organize-note',
      title: t('onboarding.steps.organizeNote.title'),
      description: t('onboarding.steps.organizeNote.desc'),
    },
    {
      id: 'ai-polish',
      title: t('onboarding.steps.aiPolish.title'),
      description: t('onboarding.steps.aiPolish.desc'),
    },
  ]
  const completedStep = onboardingSteps.find((step) => step.id === completedOnboardingStep) || null
  const nextOnboardingStepId = getNextOnboardingStep(onboardingProgress, completedOnboardingStep)
  const hasPendingNextStep = getActiveOnboardingStep(onboardingProgress) !== null
  const currentOnboardingStep = onboardingSteps.find((step) => step.id === activeOnboardingStep)
    || onboardingSteps.find((step) => step.id === nextOnboardingStepId)
    || null
  const currentOnboardingIndex = currentOnboardingStep
    ? onboardingSteps.findIndex((step) => step.id === currentOnboardingStep.id)
    : -1
  const completedOnboardingIndex = completedStep
    ? onboardingSteps.findIndex((step) => step.id === completedStep.id)
    : -1
  const showCompletedState = Boolean(completedStep && hasPendingNextStep)
  const onboardingComplete = isOnboardingComplete(onboardingProgress)
  const showOnboarding = showCompletedState || Boolean(currentOnboardingStep)
  const showActivity = preferences.visibility.activity || preferences.visibility.activityDetail
  const activity = useActivityData(showActivity)
  const customizationSections: Array<{ id: NewTabSectionId; label: string }> = [
    { id: 'actions', label: t('customize.sections.actions') },
    { id: 'onboarding', label: t('customize.sections.onboarding') },
    { id: 'activity', label: t('customize.sections.activity') },
    { id: 'activityDetail', label: t('customize.sections.activityDetail') },
  ]
  const sectionLabels = Object.fromEntries(
    customizationSections.map(section => [section.id, section.label]),
  ) as Record<NewTabSectionId, string>
  const visibleSectionIds = preferences.order.filter(section => (
    preferences.visibility[section] && (section !== 'onboarding' || showOnboarding)
  ))
  const activitySectionIds: NewTabSectionId[] = ['activity', 'activityDetail']
  const firstVisibleActivitySection = visibleSectionIds.find(section => activitySectionIds.includes(section))
  const renderedSectionIds = activity.data
    ? visibleSectionIds
    : visibleSectionIds.filter(section => (
      !activitySectionIds.includes(section) || section === firstVisibleActivitySection
    ))

  const handleSectionDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return
    const activeId = event.active.id as NewTabSectionId
    const overId = event.over.id as NewTabSectionId
    const oldIndex = preferences.order.indexOf(activeId)
    const newIndex = preferences.order.indexOf(overId)
    if (oldIndex < 0 || newIndex < 0) return
    const next = { ...preferences, order: arrayMove(preferences.order, oldIndex, newIndex) }
    setPreferences(next)
    persistPreferences(next)
  }

  const customizationMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal data-icon="inline-start" />
          {t('customize.title')}
        </Button>
      </DropdownMenuTrigger>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
        <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1rem)]">
          <DropdownMenuLabel>{t('customize.menuLabel')}</DropdownMenuLabel>
          <DropdownMenuGroup>
            <SortableContext items={preferences.order} strategy={verticalListSortingStrategy}>
              {preferences.order.map(sectionId => (
                <SortableCustomizationItem
                  key={sectionId}
                  id={sectionId}
                  label={sectionLabels[sectionId]}
                  dragLabel={t('customize.dragHandle', { section: sectionLabels[sectionId] })}
                  checked={preferences.visibility[sectionId]}
                  onCheckedChange={checked => handleSectionVisibilityChange(sectionId, checked)}
                />
              ))}
            </SortableContext>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {onboardingComplete && (
              <DropdownMenuItem onSelect={() => void handleResetOnboarding()}>
                {t('customize.resetOnboarding')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={handleResetPreferences}>
              {t('customize.reset')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DndContext>
    </DropdownMenu>
  )

  if (renderedSectionIds.length === 0) {
    return (
      <Empty className="h-full overflow-y-auto rounded-none bg-muted/20 px-6 py-10">
        <EmptyHeader className="max-w-xl flex-row gap-5 text-left">
          <EmptyMedia className="mb-0">
            <Image
              src="/app-icon.png"
              alt="NoteGen logo"
              width={96}
              height={96}
              priority
              className="size-24 shrink-0 rounded-3xl shadow-sm dark:invert"
            />
          </EmptyMedia>
          <div className="flex min-w-0 flex-col items-start gap-2">
            <EmptyTitle className="text-4xl font-semibold">NoteGen</EmptyTitle>
            <p className="text-base font-medium">{t('title')}</p>
            <EmptyDescription className="max-w-sm leading-6">{t('subtitle')}</EmptyDescription>
          </div>
        </EmptyHeader>
        <EmptyContent>{customizationMenu}</EmptyContent>
      </Empty>
    )
  }

  return (
    <Empty className="h-full justify-start overflow-y-auto rounded-none bg-muted/20 p-0 text-left text-pretty">
      <div className="@container/new-tab flex min-h-full w-full flex-col justify-center-safe">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-[clamp(1rem,4cqi,2.5rem)] py-[clamp(1.5rem,5cqi,2.5rem)]">
          <header className="flex flex-col items-start gap-4 @md/new-tab:flex-row @md/new-tab:justify-between @md/new-tab:gap-6">
            <div className="flex max-w-xl flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <Image
                  src="/app-icon.png"
                  alt="NoteGen logo"
                  width={36}
                  height={36}
                  priority
                  className="size-9 shrink-0 rounded-lg dark:invert"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <h1 className="font-heading text-xl leading-none font-semibold tracking-tight">NoteGen</h1>
                  <p className="text-sm leading-none font-medium">{t('title')}</p>
                </div>
              </div>
            </div>
            {customizationMenu}
          </header>

        <div className="flex flex-col gap-6">
          {renderedSectionIds.map(sectionId => (
            <Card key={sectionId}>
              {sectionId === 'actions' && (
                <>
                  <CardHeader>
                    <CardTitle>{sectionLabels.actions}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-2 @xl/new-tab:grid-cols-2 @4xl/new-tab:grid-cols-4">
                      {actions.map(action => (
                        <Button
                          type="button"
                          variant="outline"
                          key={action.title}
                          onClick={action.onClick}
                          className="h-auto min-h-20 min-w-0 items-center justify-start gap-3 whitespace-normal px-4 py-3 text-left has-data-[icon=inline-start]:pl-4"
                        >
                          {action.icon}
                          <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                            <span className="flex w-full items-center justify-between gap-2">
                              <span className="text-sm font-medium">{action.title}</span>
                              {action.shortcut && <Kbd className="hidden @md/new-tab:inline-flex">{action.shortcut}</Kbd>}
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">{action.description}</span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </>
              )}

              {sectionId === 'onboarding' && (
                <>
                  <CardHeader>
                    <CardTitle>{t('onboarding.title')}</CardTitle>
                    <CardDescription>{t('onboarding.subtitle')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {showCompletedState && completedStep ? (
                      <div className="flex flex-col gap-4 @lg/new-tab:flex-row @lg/new-tab:items-end @lg/new-tab:justify-between @lg/new-tab:gap-6">
                        <div className="flex flex-col gap-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            {t('onboarding.stepCompletedLabel', { current: completedOnboardingIndex + 1, total: onboardingSteps.length })}
                          </p>
                          <h4 className="text-sm font-medium">
                            {t(`onboarding.completedStates.${completedStep.id}.title`)}
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            {t(`onboarding.completedStates.${completedStep.id}.desc`)}
                          </p>
                        </div>
                        <Button type="button" size="xs" onClick={() => void onContinueToNextStep()}>
                          {t('onboarding.continue')}
                        </Button>
                      </div>
                    ) : currentOnboardingStep ? (
                      <div className="flex flex-col gap-4 @lg/new-tab:flex-row @lg/new-tab:items-end @lg/new-tab:justify-between @lg/new-tab:gap-6">
                        <div className="flex flex-col gap-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            {t('onboarding.stepLabel', { current: currentOnboardingIndex + 1, total: onboardingSteps.length })}
                          </p>
                          <h4 className="text-sm font-medium">{currentOnboardingStep.title}</h4>
                          <p className="text-xs text-muted-foreground">{currentOnboardingStep.description}</p>
                        </div>
                        <Button type="button" size="xs" onClick={() => void onStartOnboardingStep(currentOnboardingStep.id)}>
                          {visibleOnboardingStep === currentOnboardingStep.id ? t('onboarding.viewHint') : t('onboarding.start')}
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </>
              )}

              {activitySectionIds.includes(sectionId) && (
                <>
                  <CardHeader>
                    <CardTitle>{sectionLabels[sectionId]}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ActivityPanel
                      data={activity.data}
                      selectedDay={activity.selectedDay}
                      loading={activity.loading}
                      onSelectDay={activity.setSelectedDay}
                      showSummary={sectionId === 'activity'}
                      showHeatmap={sectionId === 'activity'}
                      showDetail={sectionId === 'activityDetail'}
                    />
                  </CardContent>
                </>
              )}
            </Card>
          ))}
        </div>

        <footer className="pb-4 pt-2 text-center">
          <p className="text-xs text-muted-foreground">
            查看使用文档：
            <a 
              href="https://notegen.top/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline ml-1"
            >
              https://notegen.top/
            </a>
          </p>
        </footer>
        </div>
      </div>
    </Empty>
  )
}
