'use client';
import { SettingType } from "../components/setting-base";
import { Setting } from "./setting";
import { Volume2 } from "lucide-react"
import { useTranslations } from "next-intl";

export default function AudioPage() {
  const t = useTranslations('settings.audio');

  return <SettingType id="audio" icon={<Volume2 />} title={t('title')} desc={t('desc')}>
    <Setting />
  </SettingType>
}
