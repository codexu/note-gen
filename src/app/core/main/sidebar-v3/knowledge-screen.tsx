'use client'

// Fork（almanac ALMNC-20）：v5「知識」頁。把原本左側欄下半部的 Timeline、Canvas、Tags 搬進來，
// 設定放在左側欄的大綱與外掛左側欄視圖也是這裡的分頁；提示詞庫是它自己的頁（分頁切過去）；筆記檔案樹留在側欄 MyVault。
import { useTranslations } from 'next-intl'
import { PluginViewSurface, PluginViewToolbar } from '@/components/plugins/plugin-view-surface'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useUiV3 } from '@/lib/fork-ui'
import { resolveKnowledgeTab, useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { useEditorOutlineStore } from '@/stores/editor-outline'
import { CanvasActions, CanvasSidebar } from '../canvas/canvas-sidebar'
import { Outline } from '../editor/markdown/outline'
import NoteTagsSidebar from '../note-tags/note-tags-sidebar'
import { TimelineSidebar } from '../timeline/timeline-sidebar'
import { PageHeader, PageSurface } from '../page-ui'
import { KnowledgeTabs } from './section-tabs'
import { useKnowledgeTabs } from './use-knowledge-tabs'

function OutlineTab() {
  const t = useTranslations()
  const outlineEditor = useEditorOutlineStore(state => state.active)
  if (outlineEditor && !outlineEditor.editor.isDestroyed) {
    return <Outline key={outlineEditor.documentKey} editor={outlineEditor.editor} documentKey={outlineEditor.documentKey} isOpen variant="sidebar" />
  }
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t('navigation.outline')}</EmptyTitle>
        <EmptyDescription>{t('editor.outline.sidebarEmpty')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function KnowledgePage() {
  const t = useTranslations('sidebarV3')
  const tabs = useKnowledgeTabs()
  const tab = resolveKnowledgeTab(useKnowledgeOverlay(state => state.tab), tabs)
  const hide = useKnowledgeOverlay(state => state.hide)
  const isPlugin = tabs.find(item => item.id === tab)?.kind === 'plugin'
  return (
    <PageSurface label={t('knowledge.title')} className="bg-bg text-ink">
      <PageHeader
        title={t('knowledge.title')}
        subtitle={t('knowledge.subtitle')}
        onBack={hide}
        actions={tab === 'canvases' ? <CanvasActions /> : isPlugin ? <PluginViewToolbar viewKey={tab} /> : undefined}
      >
        <KnowledgeTabs active={tab} />
      </PageHeader>
      {/* data-left-sidebar：在這裡開筆記時沿用「從左側欄開檔就收起覆蓋層」的規則 */}
      <div className="min-h-0 flex-1 overflow-hidden" data-left-sidebar>
        <div className="mx-auto h-full max-w-[760px] border-x border-line-soft">
          {tab === 'timeline' && <TimelineSidebar />}
          {tab === 'canvases' && <CanvasSidebar />}
          {tab === 'noteTags' && <NoteTagsSidebar />}
          {tab === 'outline' && <OutlineTab />}
          {isPlugin && <div className="h-full overflow-y-auto"><PluginViewSurface key={tab} viewKey={tab} toolbarInHeader /></div>}
        </div>
      </div>
    </PageSurface>
  )
}

export function KnowledgeScreen() {
  const isV3 = useUiV3()
  const visible = useKnowledgeOverlay(state => state.visible)
  return isV3 && visible ? <KnowledgePage /> : null
}
