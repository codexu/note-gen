import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import useSettingStore from '@/stores/setting';
import Image from 'next/image';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

export default function Updater() {
    const t = useTranslations('settings.about');
    const [loading, setLoading] = useState(false);
    const [updateStatus, setUpdateStatus] = useState(t('checkUpdate'));
    const [downloaded, setDownloaded] = useState(0);
    const [contentLength, setContentLength] = useState(0);
    const { version } = useSettingStore();
    
    async function checkVersion() {
      if (updateStatus === t('checkUpdate')) {
        setLoading(true);
        let update: Update | null = null;
        try {
          update = await check();
        } catch (error) {
          toast({
            title: t('checkError'),
            description: error as string,
            variant: 'destructive'
          });
        } finally {
          setLoading(false);
        }
        if (update) {
          try {
            setUpdateStatus(t('updateAvailable', { version: update.version }));
            await update.downloadAndInstall((event) => {
              switch (event.event) {
                case 'Started':
                  setContentLength(event.data.contentLength || 0);
                  break;
                case 'Progress':
                  setDownloaded(event.data.chunkLength || 0);
                  setUpdateStatus(t('updateDownloading', { downloaded, contentLength }));
                  break;
                case 'Finished':
                  setUpdateStatus(t('updateInstalled'));
                  break;
              }
            });
          } catch (error) {
            toast({
              title: t('checkError'),
              description: error as string,
              variant: 'destructive'
            });
          } finally {
            setLoading(false);
          }
        }
      } else if (updateStatus === t('updateInstalled')) {
        await relaunch();
      }
    }

    return (
      <div className="flex justify-between w-full items-center">
        <div className='flex items-center gap-4'>
          <div>
            <Image src="/app-icon.png" alt="logo" className='size-24' width={0} height={0} />
          </div>
          <div className='h-24 flex flex-col justify-between'>
            <span className='text-2xl font-bold flex items-center gap-2'>NoteGen</span>
            <span>
              {t('desc')}
            </span>
            <div>
              <Badge variant="outline">v{version}</Badge>
            </div>
          </div>
        </div>
        <Button disabled={loading} onClick={checkVersion}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {updateStatus}
        </Button>
      </div>
    )
}