'use client'

import { useTranslations } from 'next-intl'
import { DefaultModelsSettings } from '@/app/core/setting/components/default-models-settings'
import { SettingType } from '@/app/core/setting/components/setting-base'
import { SettingSection } from '@/app/core/setting/components/setting-base'
import { ItemGroup } from '@/components/ui/item'
import Outline from '@/app/core/setting/editor/outline'
import LayoutSettings from '@/app/core/setting/editor/layout-settings'
import EditorMode from '@/app/core/setting/editor/editor-mode'
import ShowSourceLineNumbers from '@/app/core/setting/editor/show-source-line-numbers'
import SourceWrap from '@/app/core/setting/editor/source-wrap'
import ShowUndoRedo from '@/app/core/setting/editor/show-undo-redo'
import ShowMobileToolbar from '@/app/core/setting/editor/show-mobile-toolbar'
import ShowEditorStats from '@/app/core/setting/editor/show-editor-stats'
import { ContentTextScaleSettings } from '@/app/core/setting/general/interface-settings/content-text-scale'
import useSettingStore from '@/stores/setting'

export default function EditorPage() {
  const t = useTranslations('settings.editor')
  const editorViewMode = useSettingStore((state) => state.editorViewMode)

  return (
    <SettingType id="editor" title={t('title')} desc={t('desc')}>
      <DefaultModelsSettings type="editor" />
      <SettingSection title={t('reading.title')} desc={t('reading.desc')}>
        <ItemGroup>
          <ContentTextScaleSettings />
          <LayoutSettings showContentWidth={false} />
        </ItemGroup>
      </SettingSection>
      <SettingSection title={t('editing.title')} desc={t('editing.desc')}>
        <ItemGroup>
          <EditorMode />
          {editorViewMode === 'source' ? (
            <>
              <ShowSourceLineNumbers />
              <SourceWrap />
            </>
          ) : null}
          <ShowUndoRedo />
          <ShowMobileToolbar />
        </ItemGroup>
      </SettingSection>
      <SettingSection title={t('display.title')} desc={t('display.desc')}>
        <ItemGroup>
          <Outline showPosition={false} />
          <ShowEditorStats />
        </ItemGroup>
      </SettingSection>
    </SettingType>
  )
}
