'use client'

import { useCallback, useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { Bell, Mic, Monitor } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { toast } from '@/hooks/use-toast'
import { SettingSection } from '../components/setting-base'

type PermissionStatus = 'loading' | 'granted' | 'notGranted' | 'unavailable' | 'systemManaged' | 'denied' | 'restricted'
type PermissionKind = 'notification' | 'screen' | 'microphone'

interface MediaPermissions {
  microphone: PermissionStatus | null
  screenCapture: boolean | null
}

const settingsUrls: Record<string, Partial<Record<PermissionKind, string>>> = {
  macos: {
    notification: 'x-apple.systempreferences:com.apple.preference.notifications',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  },
  windows: {
    notification: 'ms-settings:notifications',
    microphone: 'ms-settings:privacy-microphone',
  },
  ios: {
    notification: 'app-settings:',
    microphone: 'app-settings:',
  },
}

export function SystemPermissions() {
  const t = useTranslations('settings.general.permissions')
  const [status, setStatus] = useState<PermissionStatus>('loading')
  const [microphoneStatus, setMicrophoneStatus] = useState<PermissionStatus>('loading')
  const [screenStatus, setScreenStatus] = useState<PermissionStatus>('loading')
  const [currentPlatform, setCurrentPlatform] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setStatus('unavailable')
      setMicrophoneStatus('unavailable')
      return
    }
    try {
      const currentPlatform = platform()
      setCurrentPlatform(currentPlatform)
      // Each query fails independently so one unavailable API does not hide
      // another permission's state.
      const media = await invoke<MediaPermissions>('get_system_media_permissions').catch(() => null)
      setScreenStatus(media?.screenCapture === null || media?.screenCapture === undefined
        ? 'unavailable' : media.screenCapture ? 'granted' : 'notGranted')
      if (media?.microphone) {
        setMicrophoneStatus(media.microphone)
      } else {
        try {
          const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          setMicrophoneStatus(permission.state === 'prompt' ? 'notGranted' : permission.state)
        } catch {
          setMicrophoneStatus('systemManaged')
        }
      }
      if (currentPlatform !== 'android' && currentPlatform !== 'ios') {
        setStatus('systemManaged')
        return
      }
      setStatus(await isPermissionGranted() ? 'granted' : 'notGranted')
    } catch (error) {
      console.error('Failed to read notification permission:', error)
      setStatus('unavailable')
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void refresh()
    const onFocus = () => { void refresh() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (isTauri()) {
      void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) void refresh()
      }).then(dispose => {
        if (disposed) dispose()
        else unlisten = dispose
      }).catch(() => {})
    }
    const interval = window.setInterval(onVisibilityChange, 3000)
    return () => {
      disposed = true
      unlisten?.()
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refresh])

  async function authorize(kind: PermissionKind) {
    setBusy(true)
    try {
      if (kind === 'notification') {
        await requestPermission()
      } else if (kind === 'screen') {
        await invoke<boolean>('request_screen_capture_permission')
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())
      }
    } catch {
      toast({ title: t('error'), variant: 'destructive' })
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  async function openPermissionSettings(kind: PermissionKind) {
    const settingsUrl = currentPlatform ? settingsUrls[currentPlatform]?.[kind] : undefined
    if (!settingsUrl) return
    setBusy(true)
    try {
      await openUrl(settingsUrl)
    } catch {
      toast({ title: t('openSettingsError'), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const permissions = [
    { kind: 'notification' as const, icon: Bell, status },
    ...(currentPlatform === 'macos'
      ? [{ kind: 'screen' as const, icon: Monitor, status: screenStatus }]
      : []),
    { kind: 'microphone' as const, icon: Mic, status: microphoneStatus },
  ]

  return (
    <SettingSection title={t('title')} desc={t('desc')}>
      <ItemGroup className="gap-3">
        {permissions.map(({ kind, icon: Icon, status: permissionStatus }) => (
          <Item key={kind} variant="outline">
            <ItemMedia variant="icon"><Icon /></ItemMedia>
            <ItemContent>
              <ItemTitle>
                {t(kind)}
                <Badge
                  variant={permissionStatus === 'granted' ? 'secondary' : 'outline'}
                  role="status"
                >
                  {t(`status.${permissionStatus}`)}
                </Badge>
              </ItemTitle>
              <ItemDescription>{t(`${kind}Desc`)}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full flex-wrap sm:ml-auto sm:basis-auto">
              {currentPlatform && settingsUrls[currentPlatform]?.[kind] && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void openPermissionSettings(kind)}>{t('openSettings')}</Button>
              )}
              {(permissionStatus === 'notGranted' || (kind === 'microphone' && permissionStatus === 'systemManaged')) && (
                <Button size="sm" disabled={busy} onClick={() => void authorize(kind)}>{t('authorize')}</Button>
              )}
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </SettingSection>
  )
}
