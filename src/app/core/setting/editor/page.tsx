'use client';
import { UserRoundCog } from "lucide-react"
import { SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import TypewriterMode from './typewriter-mode';
import PageView from './page-view';
import LineNumber from './lineNumber';
import ShowUndoRedo from './show-undo-redo';
import { DefaultModelsSettings } from '../components/default-models-settings';

export default function EditorSettingPage() {
  const t = useTranslations('settings.editor');
  return <SettingType id="editorSetting" icon={<UserRoundCog />} title={t('title')} desc={t('desc')}>
    <div className="space-y-4">
      <DefaultModelsSettings type="editor" />
      <h3 className="text-lg font-semibold">{t('interfaceSettings')}</h3>
      <PageView />
      <TypewriterMode />
      <ShowUndoRedo />
      <LineNumber />
    </div>
  </SettingType>
}
