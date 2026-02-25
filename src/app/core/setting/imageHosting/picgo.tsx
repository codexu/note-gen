import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useImageStore from "@/stores/imageHosting";
import { checkPicgoState, type PicgoImageHostingSetting } from "@/lib/imageHosting/picgo";
import { CheckCircle, LoaderCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DEFAULT_URL = 'http://127.0.0.1:36677'

export default function PicgoImageHosting() {
  useTranslations('settings.imageHosting');
  useImageStore()

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

  const getStatusIcon = () => {
    if (loading) {
      return <LoaderCircle className="size-4 animate-spin text-blue-500" />;
    }
    if (picgoState) {
      return <CheckCircle className="size-4 text-green-500" />;
    }
    return <XCircle className="size-4 text-red-500" />;
  };

  const getStatusText = () => {
    if (loading) {
      return '检测中';
    }
    if (picgoState) {
      return '已连接';
    }
    return '未连接';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>PicGo 图床</CardTitle>
            <CardDescription>
              使用 PicGo 客户端作为图片上传工具
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


        {/* URL 配置 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">PicGo Server</label>
          <Input
            type="text"
            value={url}
            onChange={(e) => handleSaveUrl(e.target.value)}
            placeholder="http://127.0.0.1:36677"
          />
        </div>

      </CardContent>
    </Card>
  )
}