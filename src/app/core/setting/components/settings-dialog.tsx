'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import dynamic from 'next/dynamic'
import { Spinner } from '@/components/ui/spinner'
import useSettingStore from '@/stores/setting'
import {
  settingSections,
  isPluginSettingSection,
  type SettingSection,
  useSettingsDialogStore,
} from '@/stores/settings-dialog'
import { hasPluginSettingsContent } from '@/lib/plugins/display-preferences'
import { useShallow } from 'zustand/react/shallow'
import { usePluginStore } from '@/stores/plugins'

const SettingsDialogTabs = dynamic(() => import('./settings-dialog-tabs'), {
  ssr: false,
  loading: () => <Spinner className="m-auto text-muted-foreground" />,
})

export function SettingsDialog() {
  const t = useTranslations('settings')
  const settingsPlugins = usePluginStore(useShallow(state => state.installed.filter(plugin =>
    state.isEnabled(plugin.manifest.id) && hasPluginSettingsContent(plugin))))
  const initialized = usePluginStore(state => state.initialized)
  const { lastSettingPage, setLastSettingPage } = useSettingStore()
  const {
    open,
    activeSection,
    closeSettings,
    setActiveSection,
  } = useSettingsDialogStore()
  const contentRef = useRef<HTMLDivElement>(null)
  const [mountedSections, setMountedSections] = useState<SettingSection[]>([activeSection])
  const pluginSectionAvailable = useCallback((section: string) => settingsPlugins.some(plugin =>
    `plugin:${plugin.manifest.id}` === section), [settingsPlugins])
  const selectedSection = isPluginSettingSection(activeSection) && initialized && !pluginSectionAvailable(activeSection)
    ? 'plugins' : activeSection
  const sectionsToRender = [...new Set([...mountedSections, selectedSection])].filter(section =>
    !isPluginSettingSection(section) || pluginSectionAvailable(section))

  useEffect(() => {
    if (initialized && isPluginSettingSection(activeSection) && !pluginSectionAvailable(activeSection)) {
      setActiveSection('plugins')
      setLastSettingPage('plugins')
    }
  }, [initialized, pluginSectionAvailable, activeSection, setActiveSection, setLastSettingPage])

  useEffect(() => {
    if (open) return

    const storedSection =
      lastSettingPage === 'dev' || lastSettingPage === 'chat'
        ? 'general'
        : lastSettingPage === 'webClipper'
          ? 'record'
          : lastSettingPage
    if (isPluginSettingSection(storedSection)) {
      if (!initialized) return
      const nextSection = pluginSectionAvailable(storedSection) ? storedSection : 'plugins'
      setActiveSection(nextSection)
      if (nextSection !== storedSection) setLastSettingPage(nextSection)
    } else if (settingSections.includes(storedSection as SettingSection)) {
      setActiveSection(storedSection as SettingSection)
    }
    if (lastSettingPage === 'dev' || lastSettingPage === 'chat' || lastSettingPage === 'webClipper') {
      setLastSettingPage(lastSettingPage === 'webClipper' ? 'record' : 'general')
    }
  }, [lastSettingPage, open, setActiveSection, setLastSettingPage, initialized, pluginSectionAvailable])

  useLayoutEffect(() => {
    const scrollViewport = contentRef.current?.querySelector<HTMLElement>('[data-setting-scroll] [data-slot="scroll-area-viewport"]')
    scrollViewport?.scrollTo({ top: 0 })
    setMountedSections((sections) => sections.includes(activeSection)
      ? sections
      : [...sections, activeSection])
  }, [activeSection])

  function handleSectionChange(section: string) {
    setActiveSection(section as SettingSection)
    setLastSettingPage(section)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeSettings()}>
      <DialogContent
        showCloseButton
        className="flex h-[min(840px,calc(100vh-2rem))] w-[calc(100vw-3rem)] max-w-[1280px] gap-0 overflow-hidden p-0 sm:w-[calc(100vw-3rem)] sm:max-w-[1280px]"
      >
        <DialogTitle className="sr-only">{t('title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('title')}</DialogDescription>
        <SettingsDialogTabs
          selectedSection={selectedSection}
          sectionsToRender={sectionsToRender}
          onSectionChange={handleSectionChange}
          contentRef={contentRef}
        />
      </DialogContent>
    </Dialog>
  )
}
