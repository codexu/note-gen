import { SettingRow } from "../components/setting-base"
import { FormItem } from "../components/setting-base"
import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useImageStore from "@/stores/imageHosting";
import { checkPicgoState, type PicgoImageHostingSetting } from "@/lib/imageHosting/picgo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle, LoaderCircle, XCircle } from "lucide-react"

const DEFAULT_URL = 'http://127.0.0.1:36677'

export default function PicgoImageHosting() {
  const t = useTranslations('settings.imageHosting');
  const { mainImageHosting, setMainImageHosting } = useImageStore()

  const [loading, setLoading] = useState(false)
  const [picgoState, setPicgoState] = useState(false)
  const [url, setUrl] = useState(DEFAULT_URL)

  async function init() {
    const store = await Store.load('store.json');
    const picgoSetting = await store.get<PicgoImageHostingSetting>('picgo')
    if (picgoSetting) {
      setUrl(picgoSetting.url)
    } else {
      await store.set('picgo', { url: DEFAULT_URL })
      await store.save()
    }
  }

  async function handleCheckPicgoState() {
    setLoading(true)
    setPicgoState(false)
    const state = await checkPicgoState()
    setPicgoState(state)
    setLoading(false)
  }

  async function handleSaveUrl(url: string) {
    const store = await Store.load('store.json');
    await store.set('picgo', { url })
    await store.save()
    setUrl(url)
    handleCheckPicgoState()
  }

  useEffect(() => {
    init()
    handleCheckPicgoState()
    window.addEventListener('visibilitychange', handleCheckPicgoState)
    return () => {
      window.removeEventListener('visibilitychange', handleCheckPicgoState)
    }
  }, [])

  return <div>
    <SettingRow className="mb-4"> 
      <Alert variant={picgoState ? 'default' : 'destructive'}>
        {
          loading ? <LoaderCircle className="animate-spin size-4" /> :
          picgoState ? <CheckCircle className="size-4 !text-green-500" /> : <XCircle className="size-4" />
        }
        <AlertTitle className="mb-1 text-base font-bold">PicGo</AlertTitle>
        <AlertDescription>
          {picgoState ? t('picgo.ok') : t('picgo.error')}
        </AlertDescription>
      </Alert>
    </SettingRow>
    <SettingRow>
      <FormItem title="URL" desc={t('picgo.desc')}>
        <Input
          type="text"
          value={url}
          onChange={(e) => handleSaveUrl(e.target.value)}
        />
      </FormItem>
    </SettingRow>
    <SettingRow className="mb-4">
      {mainImageHosting === 'picgo' ? (
        <Button disabled variant="outline">
          {t('isPrimaryBackup', { type: 'PicGo' })}
        </Button>
      ) : (
        <Button 
          variant="outline" 
          onClick={() => setMainImageHosting('picgo')}
        >
          {t('setPrimaryBackup')}
        </Button>
      )}
    </SettingRow>
  </div>
}