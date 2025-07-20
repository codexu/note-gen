'use client';

import { LayoutTemplate } from "lucide-react"
import { SettingType, SettingPanel } from "../components/setting-base";
import { useTranslations } from "next-intl";
import useShortcutStore from "@/stores/shortcut";
import ShortcutsInput from "./shorcut-input";

export default function ShortcutsPage() {
  const t = useTranslations('settings.shortcuts');
  const { shortcuts } = useShortcutStore()

  return <SettingType id="shortcuts" title={t('title')} desc={t('desc')} icon={<LayoutTemplate />}>
    {
      shortcuts.map((shortcut) => (
        <SettingPanel key={shortcut.key} title={t(`shortcuts.${shortcut.key}.title`)} desc={t(`shortcuts.${shortcut.key}.desc`)}>
          <ShortcutsInput name={shortcut.key} />
        </SettingPanel>
      ))
    }
  </SettingType>
}
