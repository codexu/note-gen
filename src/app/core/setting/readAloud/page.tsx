'use client';
import { SettingType } from "../components/setting-base";
import { Setting } from "./setting";
import { Volume2 } from "lucide-react"
import { useTranslations } from "next-intl";

export default function ReadAloudPage() {
  const t = useTranslations('settings.readAloud');

  return <SettingType id="readAloud" icon={<Volume2 />} title={t('title')} desc={t('desc')}>
    <Setting />
  </SettingType>
}
