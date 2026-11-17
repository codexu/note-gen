'use client'

import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import { useState, useEffect, useCallback, useRef } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useImageStore from "@/stores/imageHosting";
import { checkPicgoState, type PicgoImageHostingSetting } from "@/lib/imageHosting/picgo";
import { CheckCircle, LoaderCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { SyncStateEnum } from "@/lib/sync/github.types";
import { useImageHostingSettingsActivity } from './use-image-hosting-settings-activity';

const DEFAULT_URL = 'http://127.0.0.1:36677'

export default function PicgoImageHosting() {
  const t = useTranslations('settings.imageHosting.picgo');
  const { picgoState, setPicgoState } = useImageStore()
  const { active, getCheckGuard } = useImageHostingSettingsActivity()

  const [url, setUrl] = useState(DEFAULT_URL)
  const [loaded, setLoaded] = useState(false)
  const requestRef = useRef(0)
  const saveRevisionRef = useRef(0)

  const handleCheckPicgoState = useCallback(async (scopeActive = getCheckGuard()) => {
    if (!scopeActive()) return
    const request = ++requestRef.current
    const isCurrent = () => scopeActive() && requestRef.current === request
    try {
      const store = await Store.load('store.json')
      const saved = await store.get<PicgoImageHostingSetting>('picgo')
      if (!isCurrent()) return
      if (!saved?.url?.trim()) {
        setPicgoState(SyncStateEnum.fail)
        return
      }
      setPicgoState(SyncStateEnum.checking)
      const state = await checkPicgoState()
      if (isCurrent()) setPicgoState(state ? SyncStateEnum.success : SyncStateEnum.fail)
    } catch (error) {
      if (!isCurrent()) return
      setPicgoState(SyncStateEnum.fail)
      console.error('PicGo connection test failed:', error)
    }
  }, [getCheckGuard, setPicgoState])

  async function handleSaveUrl(url: string) {
    const scopeActive = getCheckGuard()
    const revision = ++saveRevisionRef.current
    requestRef.current++
    setUrl(url)
    const store = await Store.load('store.json');
    await store.set('picgo', { url })
    await store.save()
    if (scopeActive() && saveRevisionRef.current === revision) {
      await handleCheckPicgoState(scopeActive)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const store = await Store.load('store.json')
      const saved = await store.get<PicgoImageHostingSetting>('picgo')
      if (cancelled) return
      if (saved) setUrl(saved.url)
      else {
        await store.set('picgo', { url: DEFAULT_URL })
        await store.save()
      }
      if (!cancelled) setLoaded(true)
    })().catch(error => console.error('Failed to load PicGo config:', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!active || !loaded) return
    void handleCheckPicgoState()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void handleCheckPicgoState()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [active, loaded, handleCheckPicgoState])

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
