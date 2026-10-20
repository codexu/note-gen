'use client'

import { useEffect, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { AlertTriangle, Loader2, LogIn, LogOut, Server } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { OpenBroswer } from '@/components/open-broswer'
import { getDb } from '@/db'
import { connectWithBrowser, connectWithPassword, disconnectProfile } from '@/lib/self-hosted-sync/profile'
import { refreshSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/lifecycle'
import { normalizeServerUrl } from '@/lib/self-hosted-sync/client'
import { ensureDefaultLibraryForCurrentWorkspace } from '@/lib/self-hosted-sync/workspaces'
import useSyncStore from '@/stores/sync'
import { SelfHostedWorkspaces } from './self-hosted-workspaces'

let serverUrlDraftWrite: Promise<void> = Promise.resolve()

export function SelfHostedSync() {
  const t = useTranslations('settings.sync.selfHosted')
  const locale = useLocale()
  const websiteLocale = locale.toLocaleLowerCase().startsWith('zh') ? 'cn' : 'en'
  const deploymentGuideUrl = `https://notegen.top/${websiteLocale}/self-hosted`
  const [serverUrl, setServerUrl] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [showPasswordLogin, setShowPasswordLogin] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [insecureHttp, setInsecureHttp] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [reauthenticationRequired, setReauthenticationRequired] = useState(false)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [experimentalAcknowledged, setExperimentalAcknowledged] = useState<boolean | null>(null)
  const { selfHostedConnected, setSelfHostedConnected } = useSyncStore()

  useEffect(() => {
    void Store.load('store.json')
      .then(store => store.get<boolean>('selfHostedExperimentalAcknowledged'))
      .then(acknowledged => setExperimentalAcknowledged(acknowledged === true))
      .catch(() => setExperimentalAcknowledged(false))
  }, [])

  useEffect(() => {
    if (experimentalAcknowledged !== true) return
    const handleProfileStateChange = () => {
      setProfileId(null)
      setReauthenticationRequired(true)
      setSelfHostedConnected(false)
      void refreshSelfHostedSyncRuntime().catch(error => {
        console.warn('[self-hosted-sync] Runtime refresh after session invalidation failed', error)
      })
    }
    window.addEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
    void (async () => {
      const store = await Store.load('store.json')
      const serverUrlDraft = await store.get<string>('selfHostedServerUrlDraft')
      if (serverUrlDraft) {
        setServerUrl(serverUrlDraft)
        try {
          setInsecureHttp(normalizeServerUrl(serverUrlDraft).insecureHttp)
        } catch {
          setInsecureHttp(false)
        }
      }
      const database = await getDb()
      const profiles = await database.select<Array<{
        id: string
        serverUrl: string
        state: 'connected' | 'disconnected' | 'reauthentication-required'
      }>>(
        "select id, server_url as serverUrl, state from self_hosted_sync_profiles order by updated_at desc limit 1"
      )
      if (profiles[0]?.state === 'connected') {
        setServerUrl(profiles[0].serverUrl)
        setInsecureHttp(normalizeServerUrl(profiles[0].serverUrl).insecureHttp)
        await ensureDefaultLibraryForCurrentWorkspace(profiles[0].id, t('newLibraryDefaultName'))
        setProfileId(profiles[0].id)
        setSelfHostedConnected(true)
        setReauthenticationRequired(false)
        setWorkspaceRevision(revision => revision + 1)
        await refreshSelfHostedSyncRuntime()
      } else {
        if (profiles[0]?.serverUrl) {
          setServerUrl(profiles[0].serverUrl)
          setInsecureHttp(normalizeServerUrl(profiles[0].serverUrl).insecureHttp)
        }
        setProfileId(null)
        setSelfHostedConnected(false)
        setReauthenticationRequired(profiles[0]?.state === 'reauthentication-required')
      }
    })().catch(error => {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    })
    return () => window.removeEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
  }, [experimentalAcknowledged, setSelfHostedConnected, t])

  function updateServerUrl(value: string) {
    setServerUrl(value)
    void persistServerUrlDraft(value).catch(() => undefined)
    try {
      setInsecureHttp(normalizeServerUrl(value).insecureHttp)
    } catch {
      setInsecureHttp(false)
    }
  }

  async function connect(mode: 'browser' | 'password') {
    setConnecting(true)
    try {
      await persistServerUrlDraft(serverUrl)
      let connectedProfileId: string
      let connectedServerUrl: string
      if (mode === 'browser') {
        const profile = await connectWithBrowser({ serverUrl, deviceName: 'NoteGen' })
        connectedProfileId = profile.id
        connectedServerUrl = profile.serverUrl
        await persistServerUrlDraft(profile.serverUrl)
      } else {
        const profile = await connectWithPassword({
          serverUrl, login, password,
          ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
          deviceName: 'NoteGen',
        })
        connectedProfileId = profile.id
        connectedServerUrl = profile.serverUrl
        await persistServerUrlDraft(profile.serverUrl)
      }
      await ensureDefaultLibraryForCurrentWorkspace(connectedProfileId, t('newLibraryDefaultName'))
      setProfileId(connectedProfileId)
      setServerUrl(connectedServerUrl)
      setSelfHostedConnected(true)
      setReauthenticationRequired(false)
      setWorkspaceRevision(revision => revision + 1)
      await refreshSelfHostedSyncRuntime()
      toast.success(t('connectedToast'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('connectionFailed'))
    } finally {
      setConnecting(false)
    }
  }

  async function disconnect() {
    if (!profileId) return
    await disconnectProfile(profileId)
    setProfileId(null)
    setSelfHostedConnected(false)
    await refreshSelfHostedSyncRuntime()
    toast.success(t('disconnectedToast'))
  }

  async function acknowledgeExperimentalRisk() {
    try {
      const store = await Store.load('store.json')
      await store.set('selfHostedExperimentalAcknowledged', true)
      await store.save()
      setExperimentalAcknowledged(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    }
  }

  if (experimentalAcknowledged === null) {
    return (
      <Card>
        <CardContent className="flex min-h-32 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (!experimentalAcknowledged) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('experimentalWarningTitle')}</CardTitle>
          <CardDescription>{t('experimentalWarningDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>{t('experimentalBackupTitle')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{t('experimentalBackupDescription')}</span>
              <OpenBroswer
                url={deploymentGuideUrl}
                title={t('deploymentGuide')}
                className="text-warning-foreground underline underline-offset-4"
              />
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button onClick={() => void acknowledgeExperimentalRisk()}>
            {t('experimentalAcknowledge')}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('connectionTitle')}</CardTitle>
          <CardDescription className="flex flex-col items-start gap-1">
            <span>{t('connectionDescription')}</span>
            <OpenBroswer
              url={deploymentGuideUrl}
              title={t('deploymentGuide')}
              className="text-primary underline underline-offset-4"
            />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="self-hosted-server-url">{t('serverUrl')}</FieldLabel>
              <Input
                id="self-hosted-server-url"
                type="url"
                value={serverUrl}
                onChange={event => updateServerUrl(event.target.value)}
                placeholder="https://sync.example.com"
                disabled={connecting || selfHostedConnected}
              />
              <FieldDescription>{t('httpsNoDowngrade')}</FieldDescription>
            </Field>
          </FieldGroup>

          {insecureHttp ? (
            <Alert className="mt-4">
              <AlertTriangle />
              <AlertTitle>{t('insecureTitle')}</AlertTitle>
              <AlertDescription>{t('insecureDescription')}</AlertDescription>
            </Alert>
          ) : null}

          {reauthenticationRequired ? (
            <Alert className="mt-4" variant="destructive">
              <AlertTriangle />
              <AlertTitle>{t('reauthenticationTitle')}</AlertTitle>
              <AlertDescription>{t('reauthenticationDescription')}</AlertDescription>
            </Alert>
          ) : null}

          {showPasswordLogin && !selfHostedConnected ? (
            <FieldGroup className="mt-4">
              <Field>
                <FieldLabel htmlFor="self-hosted-login">{t('login')}</FieldLabel>
                <Input id="self-hosted-login" value={login} onChange={event => setLogin(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="self-hosted-password">{t('password')}</FieldLabel>
                <Input id="self-hosted-password" type="password" value={password} onChange={event => setPassword(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="self-hosted-totp">{t('totp')}</FieldLabel>
                <Input id="self-hosted-totp" inputMode="numeric" maxLength={6} value={totpCode} onChange={event => setTotpCode(event.target.value)} />
              </Field>
            </FieldGroup>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          {selfHostedConnected ? (
            <>
              <Button variant="secondary" disabled>
                <Server data-icon="inline-start" />
                {t('connected')}
              </Button>
              <Button variant="outline" onClick={() => void disconnect()}>
                <LogOut data-icon="inline-start" />{t('disconnect')}
              </Button>
            </>
          ) : (
            <>
              <Button disabled={connecting || !serverUrl.trim()} onClick={() => void connect('browser')}>
                {connecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <LogIn data-icon="inline-start" />}
                {t('browserAuthorization')}
              </Button>
              {showPasswordLogin ? (
                <Button variant="outline" disabled={connecting || !login.trim() || !password} onClick={() => void connect('password')}>
                  {t('passwordLogin')}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setShowPasswordLogin(true)}>{t('usePassword')}</Button>
              )}
            </>
          )}
        </CardFooter>
      </Card>
      {selfHostedConnected && profileId ? (
        <SelfHostedWorkspaces key={`${profileId}:${workspaceRevision}`} profileId={profileId} />
      ) : null}
    </div>
  )
}

function persistServerUrlDraft(value: string) {
  serverUrlDraftWrite = serverUrlDraftWrite.catch(() => undefined).then(async () => {
    const store = await Store.load('store.json')
    await store.set('selfHostedServerUrlDraft', value)
    await store.save()
  })
  return serverUrlDraftWrite
}
