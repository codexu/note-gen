import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, LoaderCircle, CheckCircle, XCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { type SMMSUserInfo, type SMMSImageHostingSetting } from "@/lib/imageHosting/smms";
import useImageStore from "@/stores/imageHosting";
import { getUserInfo } from "@/lib/imageHosting/smms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenBroswer } from "@/components/open-broswer";

const CREATE_TOKEN_URL = 'https://sm.ms/home/apitoken'

export default function SMMSImageHosting() {
  const t = useTranslations('settings.imageHosting');
  useImageStore()

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

  const getStatusIcon = () => {
    if (loading) {
      return <LoaderCircle className="size-4 animate-spin text-blue-500" />;
    }
    if (token && userInfo) {
      return <CheckCircle className="size-4 text-green-500" />;
    }
    if (token && !userInfo) {
      return <XCircle className="size-4 text-red-500" />;
    }
    return <XCircle className="size-4 text-gray-500" />;
  };

  const getStatusText = () => {
    if (loading) {
      return '检测中';
    }
    if (token && userInfo) {
      return '已连接';
    }
    if (token && !userInfo) {
      return '连接失败';
    }
    return '未配置';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>SM.MS 图床</CardTitle>
            <CardDescription>
              使用 SM.MS 免费图片存储服务
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 状态显示 */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">连接状态</span>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="text-sm">{getStatusText()}</span>
          </div>
        </div>

        {/* Token 配置 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">API Token</label>
          <p className="text-xs text-muted-foreground">{t('smms.token.desc')}</p>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              type={tokenVisible ? 'text' : 'password'}
              value={token}
              onChange={(e) => handleSetToken(e.target.value)}
              placeholder="输入 SM.MS API Token"
            />
            <Button variant="outline" size="icon" onClick={() => setTokenVisible(!tokenVisible)}>
              {tokenVisible ? <Eye /> : <EyeOff />}
            </Button>
          </div>
          <OpenBroswer url={CREATE_TOKEN_URL} title={t('smms.token.createToken')} className="text-sm text-blue-500 hover:underline" />
        </div>

        {/* 磁盘使用情况 */}
        {token && (
          <div className="space-y-2">
            <label className="text-sm font-medium">磁盘使用情况</label>
            <div className="p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                {loading && <LoaderCircle className="animate-spin size-4" />}
                {!loading && userInfo && (
                  <span className="text-sm">{userInfo?.disk_usage} / {userInfo?.disk_limit}</span>
                )}
                {!loading && !userInfo && (
                  <span className="text-sm text-red-500">{t('smms.error')}</span>
                )}
              </div>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  )
}