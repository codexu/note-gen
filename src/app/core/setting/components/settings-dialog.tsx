'use client'

import { type ComponentType, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import useSettingStore from '@/stores/setting'
import {
  settingSections,
  type SettingSection,
  useSettingsDialogStore,
} from '@/stores/settings-dialog'
import AboutPage from '../about/page'
import AiPage from '../ai/page'
import AudioPage from '../audio/page'
import CanvasSettingPage from '../canvas/page'
import EditorSettingPage from '../editor/page'
import SettingFilePage from '../file/page'
import GeneralSettingsPage from '../general/page'
import ImageHostingPage from '../imageHosting/page'
import ImageMethodPage from '../imageMethod/page'
import McpSettingPage from '../mcp/page'
import MemoriesSettingsPage from '../memories/page'
import PromptSettingPage from '../prompt/page'
import RagSettingPage from '../rag/page'
import RecordSettingPage from '../record/page'
import ShortcutsPage from '../shortcuts/page'
import SkillsSettingPage from '../skills/page'
import PluginsSettingPage from '../plugins/page'
import SyncPage from '../sync/page'
import BackupPage from '../backup/page'
import TemplatePage from '../template/page'
import WebSearchSettingPage from '../webSearch/page'
import { SettingTab } from './setting-tab'

const settingPages: Record<SettingSection, ComponentType> = {
  about: AboutPage,
  general: GeneralSettingsPage,
  record: RecordSettingPage,
  editor: EditorSettingPage,
  canvas: CanvasSettingPage,
  sync: SyncPage,
  backup: BackupPage,
  imageHosting: ImageHostingPage,
  ai: AiPage,
  webSearch: WebSearchSettingPage,
  rag: RagSettingPage,
  mcp: McpSettingPage,
  skills: SkillsSettingPage,
  plugins: PluginsSettingPage,
  prompt: PromptSettingPage,
  memories: MemoriesSettingsPage,
  template: TemplatePage,
  file: SettingFilePage,
  shortcuts: ShortcutsPage,
  imageMethod: ImageMethodPage,
  audio: AudioPage,
}

export function SettingsDialog() {
  const t = useTranslations('settings')
  const { lastSettingPage, setLastSettingPage } = useSettingStore()
  const {
    open,
    activeSection,
    closeSettings,
    setActiveSection,
  } = useSettingsDialogStore()
  const contentRef = useRef<HTMLDivElement>(null)
  const [mountedSections, setMountedSections] = useState<SettingSection[]>([activeSection])
  const sectionsToRender = mountedSections.includes(activeSection)
    ? mountedSections
    : [...mountedSections, activeSection]

  useEffect(() => {
    if (open) return

    const storedSection =
      lastSettingPage === 'dev' || lastSettingPage === 'chat'
        ? 'general'
        : lastSettingPage === 'webClipper'
          ? 'record'
          : lastSettingPage
    if (settingSections.includes(storedSection as SettingSection)) {
      setActiveSection(storedSection as SettingSection)
    }
    if (lastSettingPage === 'dev' || lastSettingPage === 'chat' || lastSettingPage === 'webClipper') {
      setLastSettingPage(lastSettingPage === 'webClipper' ? 'record' : 'general')
    }
  }, [lastSettingPage, open, setActiveSection, setLastSettingPage])

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
        <Tabs
          orientation="vertical"
          value={activeSection}
          onValueChange={handleSectionChange}
          className="h-full min-h-0 w-full flex-1 gap-0"
        >
          <SettingTab />
          {sectionsToRender.map((section) => {
            const SettingPage = settingPages[section]
            return (
              <TabsContent
                key={section}
                ref={section === activeSection ? contentRef : undefined}
                value={section}
                forceMount
                className="h-full min-h-0 min-w-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
              >
                <SettingPage />
              </TabsContent>
            )
          })}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
