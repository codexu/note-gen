import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { _t } from '@/locales/index';

export function NoData() {
  const router = useRouter();

  function handelRouteToSetting() {
    router.push('/core/setting?anchor=sync', { scroll: false });
  }

  return (
    <div className="p-4 flex flex-col gap-4 text-secondary-foreground">
      <h1 className="text-2xl font-bold">{_t('sync_not_enabled')}</h1>
      <p className="text-sm">{_t('please_config_github_sync')}</p>
      <div className="flex gap-2">
        <Button onClick={handelRouteToSetting}>
          {_t('go_to_settings')}
        </Button>
        <Button variant={'outline'}>
          {_t('how_to_use_sync')}
        </Button>
      </div>
    </div>
  )
}
