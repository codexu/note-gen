import { SettingRow } from "../components/setting-base"
import { FormItem } from "../components/setting-base"
import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { Store } from "@tauri-apps/plugin-store";
import { SMMSImageHostingSetting } from "@/lib/imageHosting/imageHosting.d";
import useImageStore from "@/stores/imageHosting";

const CREATE_TOKEN_URL = 'https://sm.ms/api/v2/token'

export default function SMMSImageHosting() {
  const t = useTranslations('settings.imageHosting');
  const { mainImageHosting, setMainImageHosting } = useImageStore()

  const [token, setToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)

  async function init() {
    const store = await Store.load('store.json');
    const imageHostings = await store.get<SMMSImageHostingSetting>('smms')
    if (imageHostings) {
      setToken(imageHostings.token)
    }
  }

  // 外部打开链接
  function openUrl(url?: string) {
    if (url) open(url)
  }

  // 设置 token
  async function handleSetToken(token: string) {
    setToken(token)
    const store = await Store.load('store.json');
    await store.set('smms', { token })
    await store.save()
  }

  useEffect(() => {
    init()
  }, [])

  return <div>
    <SettingRow>
      <FormItem title="Token" desc={t('smms.token.desc')}>
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            type={tokenVisible ? 'text' : 'password'}
            value={token}
            onChange={(e) => handleSetToken(e.target.value)}
          />
          <Button variant="outline" size="icon" onClick={() => setTokenVisible(!tokenVisible)}>
            {tokenVisible ? <Eye /> : <EyeOff />}
          </Button>
          {
            <Button onClick={() => openUrl(CREATE_TOKEN_URL)}>
              {t('smms.token.createToken')}
            </Button>
          }
        </div>
      </FormItem>
    </SettingRow>
    <SettingRow className="mb-4">
      {mainImageHosting === 'smms' ? (
        <Button disabled variant="outline">
          {t('isPrimaryBackup', { type: 'SM.MS' })}
        </Button>
      ) : (
        <Button 
          variant="outline" 
          onClick={() => setMainImageHosting('smms')}
          disabled={token === ''}
        >
          {t('setPrimaryBackup')}
        </Button>
      )}
    </SettingRow>
  </div>
}