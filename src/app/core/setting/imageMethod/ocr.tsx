import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import { ScanText } from "lucide-react";
import {
  getInstalledOcrProviders,
  OcrProviderPackage,
} from "@/lib/ocr-packages";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Badge } from "@/components/ui/badge";

export function OcrSetting() {
  const t = useTranslations('settings.imageMethod.ocr');
  const [providers, setProviders] = useState<OcrProviderPackage[]>([])
  const provider = providers[0]

  async function refreshPackages() {
    const installedProviders = await getInstalledOcrProviders()
    setProviders(installedProviders)
  }

  useEffect(() => {
    refreshPackages()
  }, [])

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><ScanText className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription className="line-clamp-none">
          {provider ? t('desc') : t('noProviders')}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="max-md:w-full max-md:justify-start">
        <Badge variant={provider ? 'secondary' : 'outline'}>
          {provider ? t('ready') : t('unavailable')}
        </Badge>
      </ItemActions>
      {provider && (
        <ItemFooter className="mt-1 border-t pt-3 text-xs text-muted-foreground max-md:flex-col max-md:items-start">
          <span>{t('provider')}: {provider.name || provider.id}</span>
          <span>{[provider.platform, provider.version || t('unknownVersion')].filter(Boolean).join(' · ')}</span>
        </ItemFooter>
      )}
    </Item>
  )
}
