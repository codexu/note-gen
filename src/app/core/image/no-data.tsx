import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useTranslations } from 'next-intl';

export function NoData() {
  const router = useRouter();
  const t = useTranslations();

  function handelRouteToSetting() {
    router.push('/core/setting/imageHosting');
  }

  return (
    <div className="p-4 flex flex-col gap-4 text-secondary-foreground">
      <h1 className="text-2xl font-bold">{t('image.noData.title')}</h1>
      <p className="text-sm">{t('image.noData.desc')}</p>
      <div className="flex gap-2">
        <Button onClick={handelRouteToSetting}>
          {t('image.noData.goToSettings')}
        </Button>
      </div>
    </div>
  )
}
