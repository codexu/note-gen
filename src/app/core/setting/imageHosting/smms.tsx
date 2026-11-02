'use client'

import { Eye, EyeOff, LoaderCircle, CheckCircle, XCircle } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { type SMMSImageHostingSetting } from "@/lib/imageHosting/smms";
import useImageStore from "@/stores/imageHosting";
import { getUserInfo } from "@/lib/imageHosting/smms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenBroswer } from "@/components/open-broswer";
import { useTranslations } from "next-intl";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { SyncStateEnum } from "@/lib/sync/github.types";
import { useImageHostingSettingsActivity } from './use-image-hosting-settings-activity';

const CREATE_TOKEN_URL = 'https://s.ee/user/developers'

export default function SMMSImageHosting() {
  const t = useTranslations('settings.imageHosting.smms')
  const { smmsState, setSmmsState } = useImageStore()
  const { active, getCheckGuard } = useImageHostingSettingsActivity()

  const [token, setToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const requestRef = useRef(0)
  const saveRevisionRef = useRef(0)

  const handleSetUserInfo = useCallback(async (scopeActive = getCheckGuard()) => {
    if (!scopeActive()) return
    const request = ++requestRef.current
    const isCurrent = () => scopeActive() && requestRef.current === request
    try {
      const store = await Store.load('store.json')
      const saved = await store.get<SMMSImageHostingSetting>('smms')
      if (!isCurrent()) return
      if (!saved?.token?.trim()) {
        setSmmsState(SyncStateEnum.fail)
        return
      }
      setSmmsState(SyncStateEnum.checking)
      const user = await getUserInfo()
      if (isCurrent()) setSmmsState(user ? SyncStateEnum.success : SyncStateEnum.fail)
    } catch (error) {
      if (!isCurrent()) return
      setSmmsState(SyncStateEnum.fail)
      console.error('S.EE connection test failed:', error)
    }
  }, [getCheckGuard, setSmmsState])

  // 设置 token
  async function handleSetToken(token: string) {
    const scopeActive = getCheckGuard()
    const revision = ++saveRevisionRef.current
    requestRef.current++
    setToken(token)
    const store = await Store.load('store.json');
    await store.set('smms', { token })
    await store.save()
    if (scopeActive() && saveRevisionRef.current === revision) {
      await handleSetUserInfo(scopeActive)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const store = await Store.load('store.json')
      const saved = await store.get<SMMSImageHostingSetting>('smms')
      if (cancelled) return
      if (saved) setToken(saved.token)
      setLoaded(true)
    })().catch(error => console.error('Failed to load S.EE config:', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (active && loaded) void handleSetUserInfo()
  }, [active, loaded, handleSetUserInfo])

  const getStatusIcon = () => {
    if (smmsState === SyncStateEnum.checking) {
      return <LoaderCircle className="size-4 animate-spin text-muted-foreground" />;
    }
    if (smmsState === SyncStateEnum.success) {
      return <CheckCircle className="size-4 text-primary" />;
    }
    return <XCircle className="size-4 text-muted-foreground" />;
  };

  const getStatusText = () => {
    if (smmsState === SyncStateEnum.checking) {
      return t('connecting');
    }
    if (smmsState === SyncStateEnum.success) {
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
            <FieldLabel htmlFor="smms-api-token">API Token</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="smms-api-token"
                type={tokenVisible ? 'text' : 'password'}
                value={token}
                onChange={(e) => handleSetToken(e.target.value)}
                placeholder={t('token.placeholder')}
              />
              <InputGroupButton
                size="icon-xs"
                aria-label={tokenVisible ? 'Hide token' : 'Show token'}
                onClick={() => setTokenVisible(!tokenVisible)}
              >
                {tokenVisible ? <Eye /> : <EyeOff />}
              </InputGroupButton>
            </InputGroup>
            <FieldDescription>{t('token.helper')}</FieldDescription>
            <OpenBroswer url={CREATE_TOKEN_URL} title={t('token.createToken')} className="w-fit text-sm" />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
