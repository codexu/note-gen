import { SettingRow } from "../components/setting-base"
import { FormItem } from "../components/setting-base"
import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { Store } from "@tauri-apps/plugin-store";
import { type SMMSUserInfo, type SMMSImageHostingSetting } from "@/lib/imageHosting/smms";
import useImageStore from "@/stores/imageHosting";
import { getUserInfo } from "@/lib/imageHosting/smms";

const CREATE_TOKEN_URL = 'https://sm.ms/home/apitoken'

export default function SMMSImageHosting() {
  const t = useTranslations('settings.imageHosting');
  const { mainImageHosting, setMainImageHosting } = useImageStore()

  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [userInfo, setUserInfo] = useState<SMMSUserInfo | null>(null)

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

  // 获取用户信息
  async function handleSetUserInfo() {
    setLoading(true)
    setUserInfo(null)
    const user = await getUserInfo()
    if (user) {
      setUserInfo(user)
    }
    setLoading(false)
  }

  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    handleSetUserInfo()
  }, [token])

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
    {
      token &&
      <SettingRow>
        <FormItem title="磁盘使用">
          {loading && <LoaderCircle className="animate-spin mr-2" />}
          {!loading && userInfo && <span>{userInfo?.disk_usage} / {userInfo?.disk_limit}</span>}
          {!loading && !userInfo && <span>{t('smms.error')}</span>}
        </FormItem>
      </SettingRow>
    }
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