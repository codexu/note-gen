'use client';

import { LayoutTemplate } from "lucide-react"
import { SettingType } from "../components/setting-base";
import { Item, ItemGroup, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from "next-intl";
import useShortcutStore from "@/stores/shortcut";
import ShortcutsInput from "./shorcut-input";

export default function ShortcutsPage() {
  const t = useTranslations('settings.shortcuts');
  const { shortcuts } = useShortcutStore()

  return <SettingType id="shortcuts" title={t('title')} desc={t('desc')} icon={<LayoutTemplate />}>
    <ItemGroup className="gap-4">
      {
        shortcuts.map((shortcut) => (
          <Item key={shortcut.key} variant="outline">
            <ItemContent>
              <ItemTitle>{t(`shortcuts.${shortcut.key}.title`)}</ItemTitle>
              <ItemDescription>{t(`shortcuts.${shortcut.key}.desc`)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ShortcutsInput name={shortcut.key} />
            </ItemActions>
          </Item>
        ))
      }
    </ItemGroup>
  </SettingType>
}
