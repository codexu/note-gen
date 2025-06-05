import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import useSettingStore from '@/stores/setting';
import Image from 'next/image';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { ArrowBigRightDash, Link, Loader2 } from 'lucide-react';
import { getRelease } from '@/lib/github';
import { open } from '@tauri-apps/plugin-shell';

export default function Updater() {
    const t = useTranslations('settings.about');
    const [checking, setChecking] = useState(false);
    const [loading, setLoading] = useState(false);
    const { version } = useSettingStore();
    const [update, setUpdate] = useState<Update | null>(null);
    const [latestBody, setLatestBody] = useState(null);

    async function checkUpdate() {
      setChecking(true);
      try {
        setUpdate(await check());
        getRelease().then((release) => {
          if (release) {
            setLatestBody(release.body)
          }
        })
      } catch (error) {
        toast({
          title: t('checkError'),
          description: error as string,
          variant: 'destructive'
        });
      } finally {
        setChecking(false);
      }
    }
    
    async function checkVersion() {
      setLoading(true);
      if (update) {
        try {
          await update.downloadAndInstall();
        } catch (error) {
          toast({
            title: t('checkError'),
            description: error as string,
            variant: 'destructive'
          });
        }
        await relaunch();
      } else {
        toast({
          title: t('checkError'),
          description: t('noUpdate'),
          variant: 'default'
        });
        setLoading(false);
      }
    }

    function openRelease() {
      open('https://github.com/NoteGen/NoteGen/releases');
    }

    useEffect(() => {
      checkUpdate();
    }, []);

    return (
      <div className="flex flex-col gap-4 w-full">
        <div className="flex justify-between w-full items-center">
          <div className="flex items-center gap-4">
            <div>
              <Image src="/app-icon.png" alt="logo" className="size-24 dark:invert" width={0} height={0} />
            </div>
            <div className="h-24 flex flex-col justify-between">
              <span className="text-2xl font-bold flex items-center gap-2">NoteGen</span>
              <span>
                {t('desc')}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="outline">v{version}</Badge>
                {
                  update ? (
                    <>
                      <ArrowBigRightDash className="size-4" />
                      <Badge className="bg-green-500 text-white" variant="outline">v{update.version}</Badge>
                    </>
                  ) : null
                }
              </div>
            </div>
          </div>
          <Button disabled={!update || loading || checking} onClick={checkVersion}>
            {checking || loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {checking ? t('checkUpdate') : update ? t('updateAvailable') : t('noUpdate')}
          </Button>
        </div>
        {
          update && latestBody ? (
            <div className="mt-8 p-4 border rounded-md">
              <div className="flex items-center gap-2 justify-between mb-4">
                <h1 className="text-lg font-bold">NoteGen v{update.version}</h1>
                <Button size="sm" variant="outline" onClick={openRelease}>
                  <Link className='!size-3' />Release
                </Button>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{latestBody}</p>
            </div>
          ) : null
        }
      </div>
    ) 
}