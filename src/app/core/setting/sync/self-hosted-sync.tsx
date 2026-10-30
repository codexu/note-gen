'use client'

import { useEffect, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { AlertTriangle, ListChecks, Loader2, LogIn, LogOut, RefreshCw, Server } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { OpenBroswer } from '@/components/open-broswer'
import { getDb } from '@/db'
import { connectWithBrowser, connectWithPassword, disconnectProfile, isSelfHostedSecureStorageError, retrySecureStorageAccess, SelfHostedInstanceChangedError } from '@/lib/self-hosted-sync/profile'
import { refreshSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/lifecycle'
import { normalizeServerUrl } from '@/lib/self-hosted-sync/client'
import useSyncStore from '@/stores/sync'
import useSettingStore from '@/stores/setting'
import { cn } from '@/lib/utils'
import { reviewSelfHostedConnection, usePlatformSwitchStore } from '@/stores/sync-platform-switch'
import { SelfHostedWorkspaces } from './self-hosted-workspaces'
import emitter from '@/lib/emitter'
import { formatSyncDataError } from '@/lib/sync/remote-file'

let serverUrlDraftWrite: Promise<void> = Promise.resolve()

export function SelfHostedSync() {
  const t = useTranslations('settings.sync.selfHosted')
  const p = useTranslations('settings.sync.switchPlan')
  const tStatus = useTranslations('syncOverview')
  const locale = useLocale()
  const websiteLocale = locale.toLocaleLowerCase().startsWith('zh') ? 'cn' : 'en'
  const deploymentGuideUrl = `https://notegen.top/${websiteLocale}/self-hosted`
  const [serverUrl, setServerUrl] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [showPasswordLogin, setShowPasswordLogin] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [instanceChange, setInstanceChange] = useState<{
    mode: 'browser' | 'password'
    serverUrl: string
    instanceId: string
  } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [insecureHttp, setInsecureHttp] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [connectionReviewRequired, setConnectionReviewRequired] = useState(false)
  const switchStep = usePlatformSwitchStore(state => state.step)
  const [reauthenticationRequired, setReauthenticationRequired] = useState(false)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [experimentalAcknowledged, setExperimentalAcknowledged] = useState<boolean | null>(null)
  const { selfHostedConnected, setSelfHostedConnected, selfHostedServiceAvailable, providerChecks } = useSyncStore()
  const checkingService = providerChecks.selfHosted === 'checking' || selfHostedServiceAvailable === null
  const [syncErrors, setSyncErrors] = useState<string[]>([])
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const primaryBackupMethod = useSettingStore(state => state.primaryBackupMethod)

  useEffect(() => {
    setSyncErrors([])
    if (!profileId) return
    let disposed = false
    let resultVersion = 0
    const completed = (event: { provider: 'selfHosted'; errors: string[] }) => {
      resultVersion++
      if (!disposed) setSyncErrors(event.errors)
    }
    emitter.on('sync-engine-completed', completed)
    void getDb().then(database => database.select<Array<{ workspaceType: string; code: string }>>(
      `select distinct b.workspace_type as workspaceType,o.last_error_code as code
       from self_hosted_outbox o join self_hosted_workspace_bindings b on b.workspace_id=o.workspace_id
       where b.profile_id=$1 and o.state='blocked' and o.last_error_code is not null`, [profileId],
    )).then(rows => {
      if (!disposed && resultVersion === 0) setSyncErrors([...new Set(rows.map(row => row.code === 'revision_conflict'
        ? row.workspaceType === 'account-data' ? 'SELF_HOSTED_PERSONAL_REVISION_CONFLICT' : 'SELF_HOSTED_REVISION_CONFLICT'
        : row.code))])
    }).catch(error => console.warn('[self-hosted-sync] Unable to read blocked sync state', error))
    return () => {
      disposed = true
      emitter.off('sync-engine-completed', completed)
    }
  }, [profileId])

  useEffect(() => {
    void Store.load('store.json')
      .then(store => store.get<boolean>('selfHostedExperimentalAcknowledged'))
      .then(acknowledged => setExperimentalAcknowledged(acknowledged === true))
      .catch(() => setExperimentalAcknowledged(false))
  }, [])

  useEffect(() => {
    let cancelled = false
    void Store.load('store.json').then(store => store.get<string>('selfHostedConnectionReviewProfileId'))
      .then(pending => { if (!cancelled) setConnectionReviewRequired(Boolean(profileId && pending === profileId)) })
      .catch(error => console.warn('[self-hosted-sync] Failed to read pending connection review', error))
    return () => { cancelled = true }
  }, [profileId, switchStep])

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
        // Restore local connection controls before preparing the runtime, which
        // may need an unavailable server (for example after a LAN IP change).
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
      toast.error(isSelfHostedSecureStorageError(error) ? p('selfHostedSecureStorageUnavailable') : error instanceof Error ? error.message : t('operationFailed'))
    })
    return () => window.removeEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
  }, [experimentalAcknowledged, setSelfHostedConnected, t, p])

  function updateServerUrl(value: string) {
    setServerUrl(value)
    void persistServerUrlDraft(value).catch(() => undefined)
    try {
      setInsecureHttp(normalizeServerUrl(value).insecureHttp)
    } catch {
      setInsecureHttp(false)
    }
  }

  async function connect(mode: 'browser' | 'password', confirmation?: { serverUrl: string; instanceId: string }) {
    setConnectionError(null)
    setConnecting(true)
    try {
      const connectionUrl = confirmation?.serverUrl ?? serverUrl
      await persistServerUrlDraft(connectionUrl)
      let connectedProfileId: string
      let connectedServerUrl: string
      if (mode === 'browser') {
        const profile = await connectWithBrowser({ serverUrl: connectionUrl, deviceName: 'NoteGen', confirmedInstanceId: confirmation?.instanceId })
        connectedProfileId = profile.id
        connectedServerUrl = profile.serverUrl
        await persistServerUrlDraft(profile.serverUrl)
      } else {
        const profile = await connectWithPassword({
          serverUrl: connectionUrl, login, password,
          confirmedInstanceId: confirmation?.instanceId,
          ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
          deviceName: 'NoteGen',
        })
        connectedProfileId = profile.id
        connectedServerUrl = profile.serverUrl
        await persistServerUrlDraft(profile.serverUrl)
      }
      setProfileId(connectedProfileId)
      setServerUrl(connectedServerUrl)
      setSelfHostedConnected(true)
      setReauthenticationRequired(false)
      setConnectionReviewRequired(true)
      setWorkspaceRevision(revision => revision + 1)
      toast.success(t('connectedToast'))
      await reviewSelfHostedConnection()
    } catch (error) {
      if (error instanceof SelfHostedInstanceChangedError) {
        setInstanceChange({ mode, serverUrl: error.serverUrl, instanceId: error.instanceId })
      } else {
        setConnectionError(isSelfHostedSecureStorageError(error) ? p('selfHostedSecureStorageUnavailable') : error instanceof Error ? formatSyncDataError(error.message, p) : t('connectionFailed'))
      }
    } finally {
      setConnecting(false)
    }
  }

  async function reviewConnection() {
    setConnecting(true)
    try {
      await reviewSelfHostedConnection()
    } catch (error) {
      toast.error(isSelfHostedSecureStorageError(error) ? p('selfHostedSecureStorageUnavailable') : error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setConnecting(false)
    }
  }

  async function disconnect() {
    if (!profileId || disconnecting) return
    setDisconnecting(true)
    try {
      await retrySecureStorageAccess()
      await disconnectProfile(profileId)
      setProfileId(null)
      setSelfHostedConnected(false)
      setReauthenticationRequired(false)
      await refreshSelfHostedSyncRuntime()
      toast.success(t('disconnectedToast'))
    } catch (error) {
      toast.error(isSelfHostedSecureStorageError(error) ? p('selfHostedSecureStorageUnavailable') : error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setDisconnecting(false)
    }
  }

  async function retrySynchronization() {
    if (retrying || primaryBackupMethod !== 'selfHosted') return
    setRetrying(true)
    setConnectionError(null)
    try {
      await retrySecureStorageAccess()
      await refreshSelfHostedSyncRuntime(undefined, undefined, 'manual-retry')
      const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
      await getSelfHostedSyncRuntime().waitForCurrentRun()
    } catch (error) {
      setConnectionError(isSelfHostedSecureStorageError(error) ? p('selfHostedSecureStorageUnavailable') : error instanceof Error ? formatSyncDataError(error.message, p) : t('operationFailed'))
    } finally {
      setRetrying(false)
    }
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
    <div className="flex min-w-0 flex-col gap-4">
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
                disabled={connecting || disconnecting || selfHostedConnected}
              />
              <FieldDescription>{t('serverUrlHint')}</FieldDescription>
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

          {connectionError && <Alert className="mt-4" variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t('connectionFailed')}</AlertTitle>
            <AlertDescription className="break-words [overflow-wrap:anywhere]">{connectionError}</AlertDescription>
          </Alert>}

          {selfHostedConnected && syncErrors.length > 0 && (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>{tStatus('failed')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <p>{t('syncNeedsAttention')}</p>
                {primaryBackupMethod === 'selfHosted' && <Button className="w-fit" variant="outline" disabled={retrying || disconnecting} onClick={() => void retrySynchronization()}>
                  <RefreshCw data-icon="inline-start" className={cn(retrying && 'animate-spin')} />{tStatus('retry')}
                </Button>}
                <Accordion type="single" collapsible className="w-full min-w-0">
                  <AccordionItem value="errors">
                    <AccordionTrigger>{t('technicalDetails')}</AccordionTrigger>
                    <AccordionContent className="flex flex-col gap-2 break-words [overflow-wrap:anywhere]">
                      {syncErrors.map(error => <p key={error}>{formatSyncDataError(error, p)}</p>)}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </AlertDescription>
            </Alert>
          )}

          {selfHostedConnected && connectionReviewRequired && <Alert className="mt-4" variant="warning">
            <ListChecks /><AlertTitle>{t('setupReview')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <p>{p('nativeReviewRequired')}</p>
              <Button disabled={!profileId || connecting || disconnecting} onClick={() => void reviewConnection()}>
                {connecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <ListChecks data-icon="inline-start" />}
                {t('continueSetup')}
              </Button>
            </AlertDescription>
          </Alert>}

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
        <CardFooter className="flex-wrap gap-2 [&>button]:max-w-full [&>button]:whitespace-normal">
          {selfHostedConnected ? (
            <>
              <Badge variant={selfHostedServiceAvailable === false && !checkingService ? 'destructive' : 'secondary'}>
                <Server aria-hidden="true" />
                {checkingService ? tStatus('checking') : selfHostedServiceAvailable ? t('authorized') : tStatus('unavailable')}
              </Badge>
              {selfHostedServiceAvailable === false && primaryBackupMethod === 'selfHosted' && syncErrors.length === 0 && <Button variant="outline" disabled={retrying || disconnecting} onClick={() => void retrySynchronization()}>
                <RefreshCw data-icon="inline-start" className={cn(retrying && 'animate-spin')} />{tStatus('retry')}
              </Button>}
              {!connectionReviewRequired && <Button variant="outline" disabled={!profileId || connecting || disconnecting} onClick={() => void reviewConnection()}>
                <ListChecks data-icon="inline-start" />{p('nativeReviewAction')}
              </Button>}
              <Button variant="outline" disabled={!profileId || disconnecting} onClick={() => void disconnect()}>
                {disconnecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <LogOut data-icon="inline-start" />}
                {t('disconnect')}
              </Button>
            </>
          ) : (
            <>
              <Button disabled={connecting || disconnecting || !serverUrl.trim()} onClick={() => void connect('browser')}>
                {connecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <LogIn data-icon="inline-start" />}
                {t('browserAuthorization')}
              </Button>
              {showPasswordLogin ? (
                <Button variant="outline" disabled={connecting || disconnecting || !login.trim() || !password} onClick={() => void connect('password')}>
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
      <AlertDialog open={instanceChange !== null} onOpenChange={open => { if (!open) setInstanceChange(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('instanceChangeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('instanceChangeDescription', { server: instanceChange?.serverUrl ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('instanceChangeCancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={connecting || disconnecting} onClick={() => {
              if (!instanceChange) return
              const confirmation = instanceChange
              setInstanceChange(null)
              void connect(confirmation.mode, confirmation)
            }}>{t('instanceChangeConfirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
