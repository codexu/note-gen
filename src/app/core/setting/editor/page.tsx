'use client';
import { UserRoundCog } from "lucide-react"
import { SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import TypewriterMode from './typewriter-mode';
import Outline from './outline';
import PageView from './page-view';
import LineNumber from './lineNumber';

export default function EditorSettingPage() {
  const t = useTranslations('settings.editor');
  return <SettingType id="editorSetting" icon={<UserRoundCog />} title={t('title')} desc={t('desc')}>
    <PageView />
    <TypewriterMode />
    <Outline />
    <LineNumber />
  </SettingType>
}
