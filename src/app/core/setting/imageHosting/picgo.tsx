import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useImageStore from "@/stores/imageHosting";
import { checkPicgoState, type PicgoImageHostingSetting } from "@/lib/imageHosting/picgo";
import { CheckCircle, LoaderCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { SyncStateEnum } from "@/lib/sync/github.types";

const DEFAULT_URL = 'http://127.0.0.1:36677'

export default function PicgoImageHosting() {
  const t = useTranslations('settings.imageHosting.picgo');
  const { picgoState, setPicgoState } = useImageStore()

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
    setPicgoState(SyncStateEnum.checking)
    const state = await checkPicgoState()
    setPicgoState(state ? SyncStateEnum.success : SyncStateEnum.fail)
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
    if (picgoState === SyncStateEnum.checking) {
      return <LoaderCircle className="size-4 animate-spin text-muted-foreground" />;
    }
    if (picgoState === SyncStateEnum.success) {
      return <CheckCircle className="size-4 text-primary" />;
    }
    return <XCircle className="size-4 text-muted-foreground" />;
  };

  const getStatusText = () => {
    if (picgoState === SyncStateEnum.checking) {
      return t('connecting');
    }
    if (picgoState === SyncStateEnum.success) {
      return t('connected');
    }
    return t('disconnected');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>{t('status')}</ItemTitle>
            </ItemContent>
            <ItemActions>
              {getStatusIcon()}
              <span className="text-sm">{getStatusText()}</span>
            </ItemActions>
          </Item>
          <Field>
            <FieldLabel htmlFor="picgo-server">PicGo Server</FieldLabel>
            <Input
              id="picgo-server"
              value={url}
              onChange={(e) => handleSaveUrl(e.target.value)}
              placeholder="http://127.0.0.1:36677"
            />
            <FieldDescription>{t('desc')}</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
