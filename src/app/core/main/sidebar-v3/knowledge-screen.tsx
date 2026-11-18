'use client'

// Fork（almanac ALMNC-20）：v5「知識」頁。把原本左側欄下半部的 Timeline、Canvas、Tags 搬進來，
// 提示詞庫是它自己的頁（分頁切過去）；筆記檔案樹留在側欄 MyVault。
import { useTranslations } from 'next-intl'
import { useUiV3 } from '@/lib/fork-ui'
import { useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { CanvasActions, CanvasSidebar } from '../canvas/canvas-sidebar'
import NoteTagsSidebar from '../note-tags/note-tags-sidebar'
import { TimelineSidebar } from '../timeline/timeline-sidebar'
import { PageHeader, PageSurface } from '../page-ui'
import { KnowledgeTabs } from './section-tabs'

function KnowledgePage() {
  const t = useTranslations('sidebarV3')
  const tab = useKnowledgeOverlay(state => state.tab)
  const hide = useKnowledgeOverlay(state => state.hide)
  return (
    <PageSurface label={t('knowledge.title')} className="bg-bg text-ink">
      <PageHeader
        title={t('knowledge.title')}
        subtitle={t('knowledge.subtitle')}
        onBack={hide}
        actions={tab === 'canvases' ? <CanvasActions /> : undefined}
      >
        <KnowledgeTabs active={tab} />
      </PageHeader>
      {/* data-left-sidebar：在這裡開筆記時沿用「從左側欄開檔就收起覆蓋層」的規則 */}
      <div className="min-h-0 flex-1 overflow-hidden" data-left-sidebar>
        <div className="mx-auto h-full max-w-[760px] border-x border-line-soft">
          {tab === 'timeline' && <TimelineSidebar />}
          {tab === 'canvases' && <CanvasSidebar />}
          {tab === 'noteTags' && <NoteTagsSidebar />}
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
