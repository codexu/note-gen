'use client'

import type { ComponentType, RefObject } from 'react'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { isPluginSettingSection, type BuiltinSettingSection, type SettingSection } from '@/stores/settings-dialog'
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
import { PluginSettingsPage } from '../plugins/plugin-settings-page'

const settingPages: Record<BuiltinSettingSection, ComponentType> = {
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

interface SettingsDialogTabsProps {
  selectedSection: SettingSection
  sectionsToRender: SettingSection[]
  onSectionChange: (section: string) => void
  contentRef: RefObject<HTMLDivElement | null>
}

export default function SettingsDialogTabs({ selectedSection, sectionsToRender, onSectionChange, contentRef }: SettingsDialogTabsProps) {
  return (
    <Tabs
      orientation="vertical"
      value={selectedSection}
      onValueChange={onSectionChange}
      className="h-full min-h-0 w-full flex-1 gap-0"
    >
      <SettingTab />
      {sectionsToRender.map((section) => {
        const SettingPage = isPluginSettingSection(section) ? null : settingPages[section]
        return (
          <TabsContent
            key={section}
            ref={section === selectedSection ? contentRef : undefined}
            value={section}
            forceMount
            className="h-full min-h-0 min-w-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
          >
            {isPluginSettingSection(section) ? <PluginSettingsPage pluginId={section.slice('plugin:'.length)} /> : SettingPage ? <SettingPage /> : null}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
