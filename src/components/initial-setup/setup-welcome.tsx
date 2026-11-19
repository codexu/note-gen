'use client'

import type { Ref } from 'react'
import { ArrowRight, ChevronRight, FolderOpen, MessagesSquare, PencilLine, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { collectGroupedChatModels, findGroupedChatModel } from '@/app/core/main/chat/model-selection'
import { isNoteGenProvider } from '@/app/model-config'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import type { InitialSetupStep } from '@/lib/initial-setup'
import { getWorkspaceDisplayName } from '@/lib/workspace-name'
import useSettingStore from '@/stores/setting'
import { useWorkspaceNamesStore } from '@/stores/workspace-names'
import { SYNC_PLATFORM_INFO } from '@/types/sync'

type ConfigurationPage = Exclude<InitialSetupStep, 'welcome'>

interface SetupWelcomeProps {
  headingRef: Ref<HTMLHeadingElement>
  onCapture: () => void
  onLeave: () => void
  onConfigure: (page: ConfigurationPage) => void
  leaveLabel: string
}

export function SetupWelcome({ headingRef, onCapture, onLeave, onConfigure, leaveLabel }: SetupWelcomeProps) {
  const t = useTranslations('initialSetup')
  const syncText = useTranslations('settings.sync')
  const modelText = useTranslations('settings.defaultModel')
  const workspace = useSettingStore(state => state.workspacePath)
  const names = useWorkspaceNamesStore(state => state.names)
  const primaryModel = useSettingStore(state => state.primaryModel)
  const configs = useSettingStore(state => state.aiModelList)
  const activeModel = findGroupedChatModel(collectGroupedChatModels(configs), primaryModel)
  let modelName = primaryModel ? modelText('modelUnavailable') : t('welcome.noModel')
  if (activeModel) {
    modelName = isNoteGenProvider(activeModel.configKey, activeModel.configTitle)
      ? t('model.free')
      : activeModel.model.model
  }
  const sync = useSettingStore(state => state.primaryBackupMethod)
  const syncName = sync === 'local' || sync === 'cloudFolder' || sync === 'selfHosted'
    ? syncText(`${sync}.title`)
    : SYNC_PLATFORM_INFO[sync].name
  const settings = [
    { page: 'workspace', icon: FolderOpen, value: getWorkspaceDisplayName(workspace, t('welcome.defaultFolder'), names) },
    { page: 'model', icon: MessagesSquare, value: modelName },
    { page: 'sync', icon: RefreshCw, value: syncName },
  ] as const

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <div className="flex flex-col items-start sm:items-center sm:text-center">
        <h1 ref={headingRef} id="initial-setup-title" tabIndex={-1}
          className="text-balance text-[2rem] leading-[1.15] font-semibold tracking-tight outline-none sm:text-[2.75rem]">
          {t('welcome.title')}
        </h1>
        <p id="initial-setup-description" className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-7 text-muted-foreground sm:text-balance">
          {t('welcome.description')}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2 sm:mt-7 sm:justify-center">
          <Button size="lg" type="button" onClick={onCapture} className="h-11 px-4">
            <PencilLine data-icon="inline-start" />{t('welcome.capture')}
          </Button>
          <Button size="lg" type="button" variant="ghost" onClick={onLeave} className="h-11">
            {leaveLabel}<ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <section aria-labelledby="setup-options-heading" className="flex flex-col gap-3 border-t pt-5 sm:pt-6">
        <h2 id="setup-options-heading" className="text-sm font-medium">{t('welcome.preferences')}</h2>
        <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          {settings.map(({ page, icon: Icon, value }) => (
            <Item key={page} variant="outline" asChild className="flex-nowrap hover:bg-muted/60">
              <button type="button" id={`initial-setup-open-${page}`} onClick={() => onConfigure(page)} className="text-start">
                <ItemMedia variant="icon" className="size-8 shrink-0 rounded-md bg-muted"><Icon aria-hidden="true" /></ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>{t(`steps.${page}`)}</ItemTitle>
                  <ItemDescription className="truncate" title={value}>{value}</ItemDescription>
                </ItemContent>
                <ItemActions><ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" /></ItemActions>
              </button>
            </Item>
          ))}
        </div>
      </section>
    </div>
  )
}
