'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { openUrl } from '@tauri-apps/plugin-opener'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { platform } from '@tauri-apps/plugin-os'
import { AlertTriangle, ChevronDown, CircleCheck, ListChecks, Loader2, LogIn, LogOut, RefreshCw, Server, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { OpenBroswer } from '@/components/open-broswer'
import { getDb } from '@/db'
import { authenticatedClient, clearConnectionReview, connectWithBrowser, connectWithPassword, disconnectProfile, getProfile, getSelfHostedAccountLogin, isSelfHostedSecureStorageError, resolveServerConnection, retrySecureStorageAccess, selfHostedSessionNeedsLogin, SelfHostedInstanceChangedError, usesLocalSelfHostedCredentials, type BrowserDeviceAuthorization, type SelfHostedProfile } from '@/lib/self-hosted-sync/profile'
import { refreshSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/lifecycle'
import { normalizeServerUrl, SelfHostedApiError } from '@/lib/self-hosted-sync/client'
import { listSelfHostedLogins, rememberSelfHostedLogin, type SelfHostedLoginEntry } from '@/lib/self-hosted-sync/login-history'
import { isOfficialSyncOrigin, OFFICIAL_SYNC_ORIGIN } from '@/lib/self-hosted-sync/service-source'
import { SELF_HOSTED_PROTOCOL_VERSION, type ServerCapabilities } from '@/lib/self-hosted-sync/protocol'
import useSyncStore from '@/stores/sync'
import useSettingStore from '@/stores/setting'
import { cn } from '@/lib/utils'
import { reviewSelfHostedConnection, usePlatformSwitchStore, useSelfHostedSetupReturnStore } from '@/stores/sync-platform-switch'
import { SelfHostedWorkspaces } from './self-hosted-workspaces'
import { SelfHostedPersonalDataOptions } from './self-hosted-personal-data-options'
import { SelfHostedLibraryChoice } from './self-hosted-library-choice'
import emitter from '@/lib/emitter'
import { formatSyncDataError } from '@/lib/sync/remote-file'

let serverUrlDraftWrite: Promise<void> = Promise.resolve()
const DEFERRED_SETUP_KEY = 'selfHostedDeferredSetupProfileId'

type Connection = { profile: SelfHostedProfile; needsLogin: boolean }
type ServiceSource = 'official' | 'custom'

export function SelfHostedSync({ active = true, isActive: isCallerActive = () => true, onSetupLater }: {
  active?: boolean
  isActive?: () => boolean
  onSetupLater?: () => void
}) {
  const mounted = useRef(true)
  const authorizationAttempt = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; authorizationAttempt.current?.abort() }
  }, [])
  const isActive = () => mounted.current && isCallerActive()
  const t = useTranslations('settings.sync.selfHosted')
  const p = useTranslations('settings.sync.switchPlan')
  const tStatus = useTranslations('syncOverview')
  const locale = useLocale()
  const websiteLocale = locale.toLocaleLowerCase().startsWith('zh') ? 'cn' : 'en'
  const deploymentGuideUrl = `https://notegen.top/${websiteLocale}/self-hosted`
  const [source, setSource] = useState<ServiceSource>('official')
  const [customServerUrl, setCustomServerUrl] = useState('')
  const [profile, setProfile] = useState<SelfHostedProfile | null>(null)
  const [previousConnection, setPreviousConnection] = useState<Connection | null>(null)
  const [editingConnection, setEditingConnection] = useState(false)
  const [reauthenticationRequired, setReauthenticationRequired] = useState(false)
  const profileId = profile?.id ?? null
  const showingConnection = Boolean(profileId) && !editingConnection && !reauthenticationRequired
  const connectionUrl = source === 'official' ? OFFICIAL_SYNC_ORIGIN : ((!editingConnection && profile?.serverUrl) || customServerUrl)
  const [discovery, setDiscovery] = useState<{ url: string; resolvedUrl: string; capabilities: ServerCapabilities; ready: boolean | null; readinessError?: string } | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [failedCheck, setFailedCheck] = useState<{ url: string; detail: string } | null>(null)
  const discovered = discovery?.url === connectionUrl ? discovery : null
  const registrationInfo = discovered?.capabilities.registration
  const legacyRegistration = discovered?.capabilities.registrationMode
  const registration = registrationInfo?.policy
    ?? (legacyRegistration === 'open' ? 'public' : legacyRegistration === 'closed' ? 'disabled' : undefined)
  const compatible = !discovered || (discovered.capabilities.protocol.minimum <= SELF_HOSTED_PROTOCOL_VERSION && discovered.capabilities.protocol.maximum >= SELF_HOSTED_PROTOCOL_VERSION)
  const browserAvailable = discovered?.capabilities.features.deviceAuthorization !== false
  const [accountLogin, setAccountLogin] = useState<{ profileId: string; login: string } | null>(null)
  const [authorization, setAuthorization] = useState<BrowserDeviceAuthorization | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [login, setLogin] = useState('')
  const [loginHistory, setLoginHistory] = useState<{
    serverUrl: string; instanceId?: string; accounts: SelfHostedLoginEntry[]
  } | null>(null)
  const [loginHistoryRevision, setLoginHistoryRevision] = useState(0)
  const [password, setPassword] = useState('')
  const passwordInput = useRef<HTMLInputElement>(null)
  const recentAccountSelected = useRef(false)
  const continueSetupButton = useRef<HTMLButtonElement>(null)
  const serverInput = useRef<HTMLInputElement>(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpRequired, setTotpRequired] = useState(false)
  const passwordFormId = useId()
  const [showPasswordLogin, setShowPasswordLogin] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const connectionView = useRef({ profileId, connecting, editingConnection })
  connectionView.current = { profileId, connecting, editingConnection }
  const [instanceChange, setInstanceChange] = useState<{
    mode: 'browser' | 'password'
    serverUrl: string
    instanceId: string
  } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connectionReady, setConnectionReady] = useState(false)
  const [disconnectConfirmation, setDisconnectConfirmation] = useState<'setup' | 'connection' | null>(null)
  const [connectionReviewRequired, setConnectionReviewRequired] = useState(false)
  const [deferredSetupProfileId, setDeferredSetupProfileId] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupRevision, setSetupRevision] = useState(0)
  const [libraryChoiceReady, setLibraryChoiceReady] = useState(false)
  const [personalOptionsReady, setPersonalOptionsReady] = useState(false)
  const [savingLibraryChoice, setSavingLibraryChoice] = useState(false)
  const [savingPersonalOptions, setSavingPersonalOptions] = useState(false)
  const savingSetupOptions = savingLibraryChoice || savingPersonalOptions
  const promptedSetupProfile = useRef<string | null>(null)
  const loginHistoryUrl = discovered?.resolvedUrl ?? connectionUrl
  const loginHistoryInstance = discovered?.capabilities.instanceId
  const recentAccounts = loginHistory?.serverUrl === loginHistoryUrl && loginHistory.instanceId === loginHistoryInstance
    ? loginHistory.accounts : []
  const switchStep = usePlatformSwitchStore(state => state.step)
  const switchInProgress = usePlatformSwitchStore(state => state.platform === 'selfHosted'
    && (state.mutated || !['completed', 'cancelled', 'error'].includes(state.step)))
  const pendingSetupProfileId = active && connectionReady && showingConnection && connectionReviewRequired ? profileId : null
  const setupReturnRequest = useSelfHostedSetupReturnStore(state => state.request)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [experimentalAcknowledged, setExperimentalAcknowledged] = useState<boolean | null>(null)
  const [experimentalNoticeDismissed, setExperimentalNoticeDismissed] = useState(false)
  const { selfHostedConnected, setSelfHostedConnected, selfHostedServiceAvailable, selfHostedServiceIssue, providerChecks } = useSyncStore()
  const checkingService = providerChecks.selfHosted === 'checking' || selfHostedServiceAvailable === null
  const [syncErrors, setSyncErrors] = useState<string[]>([])
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState('')
  const [retrying, setRetrying] = useState(false)
  const primaryBackupMethod = useSettingStore(state => state.primaryBackupMethod)

  const showProfile = useCallback((connection: Connection | null) => {
    setProfile(connection?.profile ?? null)
    setEditingConnection(false)
    setReauthenticationRequired(connection?.needsLogin ?? false)
    setShowPasswordLogin(false)
    setPassword('')
    setTotpCode('')
    setTotpRequired(false)
    setFailedCheck(null)
    if (!connection) {
      setLogin('')
      return
    }
    const { profile, needsLogin } = connection
    setSource(sourceForProfile(profile))
    const knownLogin = needsLogin ? getSelfHostedAccountLogin(profile) : null
    setLogin(knownLogin && knownLogin !== profile.accountId ? knownLogin : '')
  }, [])

  const openSetup = useCallback(() => {
    setLibraryChoiceReady(false)
    setPersonalOptionsReady(false)
    setSetupRevision(revision => revision + 1)
    setSetupOpen(true)
  }, [])

  function deferSetup() {
    setSetupOpen(false)
    if (!pendingSetupProfileId) return Promise.resolve()
    setDeferredSetupProfileId(pendingSetupProfileId)
    return Store.load('store.json').then(async store => {
      await store.set(DEFERRED_SETUP_KEY, pendingSetupProfileId)
      await store.save()
    }).catch(error => console.warn('[self-hosted-sync] Could not save deferred setup', error))
  }

  useEffect(() => {
    if (!pendingSetupProfileId) {
      setSetupOpen(false)
      return
    }
    if (switchInProgress || deferredSetupProfileId === pendingSetupProfileId || promptedSetupProfile.current === pendingSetupProfileId) return
    promptedSetupProfile.current = pendingSetupProfileId
    openSetup()
  }, [deferredSetupProfileId, openSetup, pendingSetupProfileId, switchInProgress])

  useEffect(() => {
    if (!active || !connectionReady || source !== 'official' || showingConnection) return
    const controller = new AbortController()
    void resolveServerConnection(OFFICIAL_SYNC_ORIGIN, controller.signal).then(({ normalized, capabilities }) => {
      if (controller.signal.aborted) return
      setDiscovery(previous => ({
        url: OFFICIAL_SYNC_ORIGIN,
        resolvedUrl: normalized.url,
        capabilities,
        ready: previous?.url === OFFICIAL_SYNC_ORIGIN ? previous.ready : null,
        readinessError: previous?.url === OFFICIAL_SYNC_ORIGIN ? previous.readinessError : undefined,
      }))
    }).catch(() => undefined)
    return () => controller.abort()
  }, [active, connectionReady, showingConnection, source])

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
      .then(store => Promise.all([
        store.get<boolean>('selfHostedExperimentalAcknowledged'),
        store.get<boolean>('selfHostedExperimentalNoticeDismissed'),
      ]))
      .then(([acknowledged, dismissed]) => {
        setExperimentalAcknowledged(acknowledged === true)
        setExperimentalNoticeDismissed(dismissed === true)
      })
      .catch(() => setExperimentalAcknowledged(false))
  }, [])

  useEffect(() => {
    let cancelled = false
    void Store.load('store.json').then(store => store.get<string>('selfHostedConnectionReviewProfileId'))
      .then(async pending => {
        if (cancelled) return
        setConnectionReviewRequired(Boolean(profileId && pending === profileId))
        if (switchStep !== 'completed' || !profileId) return
        const refreshed = await getProfile(profileId)
        if (!cancelled && refreshed) setProfile(current => current?.id === refreshed.id ? refreshed : current)
      })
      .catch(error => console.warn('[self-hosted-sync] Failed to read pending connection review', error))
    return () => { cancelled = true }
  }, [profileId, switchStep])

  useEffect(() => {
    if (!active) {
      authorizationAttempt.current?.abort()
      setConnectionReady(false)
      return
    }
    let cancelled = false
    let revision = 0
    async function restoreConnections(loadDraft: boolean) {
      const request = ++revision
      try {
        const store = await Store.load('store.json')
        if (loadDraft) {
          const [draft, preferred, deferred] = await Promise.all([
            store.get<string>('selfHostedServerUrlDraft'), store.get<ServiceSource>('selfHostedServiceSource'),
            store.get<string>(DEFERRED_SETUP_KEY),
          ])
          if (cancelled || request !== revision) return
          const customDraft = draft && !isOfficialSyncOrigin(draft) ? draft : ''
          setCustomServerUrl(customDraft)
          setDeferredSetupProfileId(deferred ?? null)
          setSource(preferred === 'official' || preferred === 'custom' ? preferred : customDraft ? 'custom' : 'official')
        }
        const { pending, current } = await readSettingsConnections(store)
        if (cancelled || request !== revision) return
        showProfile(pending ?? current)
        setPreviousConnection(pending && pending.profile.id !== current?.profile.id ? current : null)
        setConnectionReviewRequired(Boolean(pending))
        setSelfHostedConnected(current?.profile.state === 'connected' && !current.needsLogin)
        setConnectionReady(true)
        if (current) await refreshSelfHostedSyncRuntime()
      } catch (error) {
        if (cancelled || request !== revision) return
        setConnectionReady(true)
        setConnectionError(isSelfHostedSecureStorageError(error) ? p('selfHostedSecureStorageUnavailable') : error instanceof Error ? error.message : t('operationFailed'))
      }
    }
    const handleProfileStateChange = (event: Event) => {
      const affected = (event as CustomEvent<{ profileId: string }>).detail.profileId
      const view = connectionView.current
      if (affected === view.profileId && !view.connecting && !view.editingConnection) void restoreConnections(false)
      else setPreviousConnection(current => current?.profile.id === affected ? { ...current, needsLogin: true } : current)
    }
    window.addEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
    void restoreConnections(true)
    return () => {
      cancelled = true
      window.removeEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
    }
  }, [active, setSelfHostedConnected, showProfile, t, p])

  useEffect(() => {
    if (!active || !connectionReady || switchInProgress || !setupReturnRequest) return
    let cancelled = false
    void (async () => {
      const store = await Store.load('store.json')
      const { pending, current } = await readSettingsConnections(store)
      const requestedProfile = setupReturnRequest.profileId ? await getProfile(setupReturnRequest.profileId) : null
      const target = requestedProfile ? await readConnection(requestedProfile) : pending ?? current
      if (cancelled || useSelfHostedSetupReturnStore.getState().request !== setupReturnRequest) return
      if (target && setupReturnRequest.intent !== 'connection') {
        const needsLogin = target.needsLogin || setupReturnRequest.intent === 'login'
        showProfile({ ...target, needsLogin })
        setPreviousConnection(current?.profile.id !== target.profile.id ? current : null)
        setConnectionReviewRequired(Boolean(pending?.profile.id === target.profile.id || setupReturnRequest.intent === 'setup'))
        if (!needsLogin) {
          promptedSetupProfile.current = target.profile.id
          openSetup()
        }
      } else if (target) {
        showProfile(target)
        setConnectionReviewRequired(Boolean(pending?.profile.id === target.profile.id))
        if (!target.needsLogin && sourceForProfile(target.profile) === 'custom') {
          setCustomServerUrl(target.profile.serverUrl)
          setEditingConnection(true)
        }
      }
      setConnectionError(null)
      setRequestId('')
      useSelfHostedSetupReturnStore.setState({ request: null })
    })().catch(error => {
      if (cancelled) return
      setConnectionError(error instanceof Error ? error.message : t('operationFailed'))
      if (useSelfHostedSetupReturnStore.getState().request === setupReturnRequest) useSelfHostedSetupReturnStore.setState({ request: null })
    })
    return () => { cancelled = true }
  }, [active, connectionReady, openSetup, setupReturnRequest, showProfile, switchInProgress, t])

  useEffect(() => {
    if (!authorization) return
    const update = () => setRemaining(Math.max(0, Math.ceil((authorization.expiresAt - Date.now()) / 1_000)))
    update()
    const timer = setInterval(update, 1_000)
    return () => clearInterval(timer)
  }, [authorization])

  useEffect(() => {
    if (!active || showingConnection) return
    setLoginHistory({
      serverUrl: loginHistoryUrl,
      instanceId: loginHistoryInstance,
      accounts: listSelfHostedLogins(loginHistoryUrl, loginHistoryInstance),
    })
  }, [active, showingConnection, loginHistoryUrl, loginHistoryInstance, loginHistoryRevision])

  useEffect(() => {
    if (!profileId || reauthenticationRequired) return
    let current = true
    void authenticatedClient(profileId).then(async ({ client, profile }) => {
      const account = await client.account()
      if (!current) return
      setAccountLogin({ profileId, login: account.login })
      if (!profile.instanceId || account.id !== profile.accountId) return
      const accounts = listSelfHostedLogins(profile.serverUrl, profile.instanceId)
      if (accounts.some(entry => entry.accountId === account.id)) return
      rememberSelfHostedLogin(profile.serverUrl, { accountId: account.id, instanceId: profile.instanceId, login: account.login })
      setLoginHistoryRevision(revision => revision + 1)
    }).catch(() => undefined)
    return () => { current = false }
  }, [profileId, reauthenticationRequired])

  function updateServerUrl(value: string) {
    setCustomServerUrl(value)
    setFailedCheck(null)
    setConnectionError(null)
    setRequestId('')
    clearPasswordLogin()
    void persistServerUrlDraft(value).catch(() => undefined)
  }

  function clearPasswordLogin() {
    setLogin('')
    setPassword('')
    setTotpCode('')
    setTotpRequired(false)
  }

  function updateLogin(value: string) {
    setLogin(value)
    setTotpCode('')
    setTotpRequired(false)
  }

  function connectionErrorMessage(error: unknown) {
    if (isSelfHostedSecureStorageError(error)) return p('selfHostedSecureStorageUnavailable')
    if (error instanceof SelfHostedApiError) {
      const messages: Record<string, string> = {
        authorization_denied: t('authorizationDenied'),
        authorization_expired: t('authorizationExpired'),
        credentials_invalid: t('credentialsInvalid'),
        totp_required: t('totpRequired'),
        totp_invalid: t('totpRequired'),
      }
      return messages[error.body.code] ?? formatSyncDataError(error.message, p)
    }
    if (error instanceof Error && error.message === 'SELF_HOSTED_OFFICIAL_ORIGIN_MISMATCH') return t('officialOriginMismatch')
    if (error instanceof Error && error.message === 'SELF_HOSTED_BROWSER_UNAVAILABLE') return t('browserUnavailable')
    if (error instanceof Error && error.message === 'SELF_HOSTED_AUTHORIZATION_IN_PROGRESS') return t('authorizationInProgress')
    if (error instanceof Error && error.message === 'SELF_HOSTED_REAUTHENTICATION_ACCOUNT_MISMATCH') return t('reauthenticationAccountMismatch')
    return error instanceof Error ? formatSyncDataError(error.message, p) : t('connectionFailed')
  }

  async function discover() {
    const url = connectionUrl
    setDiscovering(true)
    setFailedCheck(null)
    setConnectionError(null)
    setRequestId('')
    try {
      const { normalized, capabilities, client } = await resolveServerConnection(url)
      const readiness = capabilities.registration?.policy === 'bootstrap'
        ? { ready: null }
        : await client.readiness().then(result => ({ ready: result.status === 'ok' }), (error: unknown) => ({
          ready: false, readinessError: connectionErrorMessage(error),
        }))
      if (isActive()) setDiscovery({ url, resolvedUrl: normalized.url, capabilities, ...readiness })
    } catch (error) {
      if (isActive()) {
        setFailedCheck({ url, detail: connectionErrorMessage(error) })
      }
    } finally {
      if (mounted.current) setDiscovering(false)
    }
  }

  async function connect(mode: 'browser' | 'password', confirmation?: { serverUrl: string; instanceId: string }) {
    if (!isActive() || authorizationAttempt.current) return
    setConnectionError(null)
    setRequestId('')
    setConnecting(true)
    const controller = new AbortController()
    authorizationAttempt.current = controller
    try {
      const targetUrl = confirmation?.serverUrl ?? connectionUrl
      if (!isActive()) return
      const deviceName = `NoteGen · ${platform()}`
      const expectedProfile = reauthenticationRequired && !confirmation ? profile ?? undefined : undefined
      let nextProfile: SelfHostedProfile
      if (mode === 'browser') {
        nextProfile = await connectWithBrowser({
          serverUrl: targetUrl, deviceName, confirmedInstanceId: confirmation?.instanceId, signal: controller.signal,
          expectedProfile,
          onAuthorization: value => { if (isActive()) setAuthorization(value) },
        })
      } else {
        nextProfile = await connectWithPassword({
          serverUrl: targetUrl, login: login.trim(), password,
          confirmedInstanceId: confirmation?.instanceId,
          ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
          deviceName, expectedProfile,
          signal: controller.signal,
        })
      }
      if (!isActive()) return
      const nextSource = sourceForProfile(nextProfile)
      void persistConnectionDraft('selfHostedServiceSource', nextSource).catch(() => undefined)
      if (nextSource === 'custom') {
        setCustomServerUrl(nextProfile.serverUrl)
        void persistServerUrlDraft(nextProfile.serverUrl).catch(() => undefined)
      }
      showProfile({ profile: nextProfile, needsLogin: false })
      setConnectionReviewRequired(nextProfile.state === 'pending-review')
      setWorkspaceRevision(revision => revision + 1)
      if (nextProfile.state === 'pending-review') {
        openSetup()
        const { current } = await readSettingsConnections(await Store.load('store.json'))
        if (isActive()) setPreviousConnection(current?.profile.id !== nextProfile.id ? current : null)
      } else {
        const { pending } = await readSettingsConnections(await Store.load('store.json'))
        if (!isActive()) return
        setPreviousConnection(null)
        if (pending) {
          showProfile(pending)
          setConnectionReviewRequired(true)
          if (pending.profile.id === nextProfile.id && !pending.needsLogin) openSetup()
          else setPreviousConnection({ profile: nextProfile, needsLogin: false })
        }
        await refreshSelfHostedSyncRuntime()
        if (usesLocalSelfHostedCredentials() && useSyncStore.getState().selfHostedRuntimeReady) {
          const { resumeWorkspacePathMoves } = await import('@/lib/sync/workspace-path-moves')
          resumeWorkspacePathMoves()
        }
      }
    } catch (error) {
      if (!isActive() || controller.signal.aborted) return
      if (error instanceof SelfHostedInstanceChangedError) {
        setInstanceChange({ mode, serverUrl: error.serverUrl, instanceId: error.instanceId })
      } else {
        if (mode === 'password' && error instanceof SelfHostedApiError
          && ['totp_required', 'totp_invalid'].includes(error.body.code)) {
          setTotpRequired(true)
          setTotpCode('')
        }
        setConnectionError(connectionErrorMessage(error))
        setRequestId(error instanceof SelfHostedApiError ? error.body.requestId : '')
      }
    } finally {
      authorizationAttempt.current = null
      if (mounted.current) { setConnecting(false); setAuthorization(null) }
    }
  }

  async function reviewConnection() {
    if (!isActive()) return
    setConnecting(true)
    try {
      await reviewSelfHostedConnection({ isActive })
    } catch (error) {
      if (!isActive()) return
      setConnectionError(connectionErrorMessage(error))
      setRequestId(error instanceof SelfHostedApiError ? error.body.requestId : '')
    } finally {
      if (isActive()) setConnecting(false)
    }
  }

  async function disconnect(cancelSetup: boolean) {
    if (!profile || disconnecting) return
    setDisconnecting(true)
    try {
      await retrySecureStorageAccess()
      const isNewConnection = profile.state === 'pending-review' || Boolean(previousConnection && previousConnection.profile.id !== profile.id)
      if (cancelSetup && !isNewConnection) await clearConnectionReview(profile.id)
      else await disconnectProfile(profile.id)
      const { pending, current } = await readSettingsConnections(await Store.load('store.json'))
      showProfile(pending ?? current)
      setPreviousConnection(pending && pending.profile.id !== current?.profile.id ? current : null)
      setConnectionReviewRequired(Boolean(pending))
      setSelfHostedConnected(current?.profile.state === 'connected' && !current.needsLogin)
      setConnectionError(null)
      setRequestId('')
      await refreshSelfHostedSyncRuntime()
      toast.success(t(cancelSetup ? 'setupCancelledToast' : 'disconnectedToast'))
    } catch (error) {
      toast.error(isSelfHostedSecureStorageError(error) ? p('selfHostedSecureStorageUnavailable') : error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setDisconnecting(false)
    }
  }

  function editConnection(reuseServer = false) {
    if (profile && sourceForProfile(profile) === 'custom' && (reuseServer || !customServerUrl)) {
      setCustomServerUrl(profile.serverUrl)
    }
    setEditingConnection(true)
    setReauthenticationRequired(false)
    setDiscovery(null)
    setConnectionError(null)
    setRequestId('')
    clearPasswordLogin()
  }

  async function retrySynchronization() {
    if (retrying || primaryBackupMethod !== 'selfHosted') return
    setRetrying(true)
    setConnectionError(null)
    try {
      await retrySecureStorageAccess()
      const { checkSyncProviderStatus } = await import('@/lib/sync/provider-status')
      await checkSyncProviderStatus('selfHosted', { isActive })
      if (!isActive() || useSyncStore.getState().selfHostedServiceAvailable === false) return
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

  async function dismissExperimentalNotice() {
    try {
      const store = await Store.load('store.json')
      await store.set('selfHostedExperimentalNoticeDismissed', true)
      await store.save()
      setExperimentalNoticeDismissed(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    }
  }

  const needsExperimentalAcknowledgment = !experimentalAcknowledged && !showingConnection
  const mayConnect = connectionReady && !needsExperimentalAcknowledgment && compatible && discovered?.ready !== false
    && registration !== 'bootstrap' && Boolean(connectionUrl.trim())
  const showingPasswordForm = !showingConnection && !needsExperimentalAcknowledgment && registration !== 'bootstrap'
    && (source === 'official' || showPasswordLogin)
  const canSubmitPassword = mayConnect && !connecting && !disconnecting && !discovering
    && Boolean(login.trim() && password) && (!totpRequired || totpCode.length === 6)
  const checkFailure = failedCheck?.url === connectionUrl ? failedCheck.detail : null
  const checkResult = checkFailure ? 'serverCheckFailed'
    : registration === 'bootstrap' ? 'serverSetupRequired'
    : !compatible ? 'serverProtocolMismatch'
    : discovered?.ready === false ? 'serverNotReady'
    : discovered?.ready === true ? 'serverCheckPassed' : null
  const checkHint = checkFailure ? t('serverCheckFailedHint')
    : !compatible ? t('serverProtocolMismatchHint')
    : discovered?.ready === false ? t('serverNotReadyHint') : null
  const checkDetail = checkFailure ?? discovered?.readinessError
  const accountUrl = registration === 'public' || registration === 'bootstrap' || source === 'official'
    ? getAccountPageUrl(source, discovered) : null
  const chosenAccount = accountLogin && accountLogin.profileId === profileId ? accountLogin.login : profile ? getSelfHostedAccountLogin(profile) : null
  const previousAccount = previousConnection ? getSelfHostedAccountLogin(previousConnection.profile) : null
  const pinnedLogin = Boolean(reauthenticationRequired && login && chosenAccount === login)
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  const serviceIssue = selfHostedServiceIssue === 'instance-changed' ? tStatus('selfHostedStatus.serverInstanceChanged')
    : selfHostedServiceIssue === 'protocol-mismatch' ? t('serverProtocolMismatch') : tStatus('unavailable')
  const serviceIssueHint = selfHostedServiceIssue === 'instance-changed' ? tStatus('selfHostedStatus.serverInstanceChangedHint')
    : selfHostedServiceIssue === 'protocol-mismatch' ? t('serverProtocolMismatchHint') : t('serviceUnavailableHint')
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription className="flex flex-col items-start gap-1">
            <span>{t(source === 'official' ? 'officialDescription' : 'connectionDescription')}</span>
            <OpenBroswer
              url={source === 'official' ? `${OFFICIAL_SYNC_ORIGIN}/service/` : deploymentGuideUrl}
              title={t(source === 'official' ? 'officialServiceDetails' : 'deploymentGuide')}
              className="text-primary underline underline-offset-4"
            />
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(!experimentalNoticeDismissed || needsExperimentalAcknowledgment) && <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>{t('experimentalWarningTitle')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{t('experimentalBackupDescription')}</span>
              {needsExperimentalAcknowledgment && <Button variant="outline" size="sm" disabled={experimentalAcknowledged === null} onClick={() => void acknowledgeExperimentalRisk()}>{t('experimentalAcknowledge')}</Button>}
            </AlertDescription>
            {!needsExperimentalAcknowledgment && <AlertAction>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('dismissExperimentalNotice')}
                onClick={() => void dismissExperimentalNotice()}>
                <X aria-hidden="true" />
              </Button>
            </AlertAction>}
          </Alert>}
          <ToggleGroup type="single" variant="outline" value={source} aria-label={t('serviceSource')}
            disabled={!connectionReady || connecting || disconnecting || discovering || showingConnection || reauthenticationRequired}
            onValueChange={value => {
              if (value !== 'official' && value !== 'custom') return
              setSource(value)
              void persistConnectionDraft('selfHostedServiceSource', value).catch(() => undefined)
              setFailedCheck(null)
              setShowPasswordLogin(false)
              clearPasswordLogin()
              setConnectionError(null)
              setRequestId('')
            }}
          >
            <ToggleGroupItem value="official">{t('officialSource')}</ToggleGroupItem>
            <ToggleGroupItem value="custom">{t('customSource')}</ToggleGroupItem>
          </ToggleGroup>
          {source === 'custom' ? <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${passwordFormId}-server`}>{t('serverUrl')}</FieldLabel>
              <Input
                ref={serverInput}
                id={`${passwordFormId}-server`}
                name="server-url"
                type="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                dir="ltr"
                value={connectionUrl}
                onChange={event => updateServerUrl(event.target.value)}
                placeholder="https://sync.example.com"
                disabled={!connectionReady || connecting || disconnecting || discovering}
                readOnly={showingConnection || reauthenticationRequired}
              />
              <FieldDescription>{t('serverUrlHint')}</FieldDescription>
            </Field>
          </FieldGroup> : null}

          {!connectionReady && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" aria-hidden="true" />{tStatus('checking')}
          </div>}

          {connectionReviewRequired && previousConnection && previousAccount && <Alert>
            <Server aria-hidden="true" />
            <AlertTitle>{t(primaryBackupMethod === 'selfHosted' ? 'currentSyncAccount' : 'currentLinkedAccount', { login: previousAccount })}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span className="break-all" dir="ltr">{previousConnection.profile.serverUrl}</span>
              {previousConnection.needsLogin && <>
                <span>{t('reauthenticationTitle')}</span>
                <Button variant="outline" size="sm" disabled={connecting || disconnecting || switchInProgress} onClick={() => {
                  showProfile(previousConnection)
                  setConnectionReviewRequired(false)
                  setConnectionError(null)
                }}>{t('signInAgain')}</Button>
              </>}
            </AlertDescription>
          </Alert>}
          {chosenAccount && (showingConnection || editingConnection) && <p className="break-words text-sm font-medium">
            {t(connectionReviewRequired && previousConnection ? 'pendingAccount' : 'associatedAccount', { login: chosenAccount })}
          </p>}

          {source === 'custom' && isInsecureAddress(connectionUrl) ? (
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
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{chosenAccount ? t('reauthenticationAccountHint', { login: chosenAccount }) : t('reauthenticationDescription')}</span>
                {!connectionReviewRequired && <Button variant="outline" size="sm" disabled={connecting} onClick={() => editConnection()}>
                  {t('changeConnection')}
                </Button>}
              </AlertDescription>
            </Alert>
          ) : null}

          {connectionError && <Alert className="mt-4" variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t('connectionFailed')}</AlertTitle>
            <AlertDescription className="break-words [overflow-wrap:anywhere]">
              <p>{connectionError}</p>
              {requestId && <Button variant="outline" size="sm" onClick={() => void writeText(requestId).then(() => toast.success(t('copied'))).catch(() => toast.error(t('operationFailed')))}>{t('copyRequestId', { id: requestId })}</Button>}
            </AlertDescription>
          </Alert>}

          {authorization && <Alert>
            <LogIn />
            <AlertTitle>{t('waitingForBrowser')}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <p>{t('deviceCode', { code: authorization.userCode, seconds: remaining })}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void openUrl(authorization.url).catch(() => toast.error(t('operationFailed')))}>{t('reopenBrowser')}</Button>
                <Button variant="outline" size="sm" onClick={() => void writeText(authorization.userCode).then(() => toast.success(t('copied'))).catch(() => toast.error(t('operationFailed')))}>{t('copyDeviceCode')}</Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  authorizationAttempt.current?.abort()
                  setAuthorization(null)
                }}>{t('instanceChangeCancel')}</Button>
              </div>
            </AlertDescription>
          </Alert>}

          {!showingConnection && checkHint && <Alert variant={checkFailure ? 'destructive' : 'warning'}>
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{t(checkResult ?? 'serverCheckFailed')}</AlertTitle>
            <AlertDescription className="flex flex-col gap-1 break-words [overflow-wrap:anywhere]" aria-live="polite">
              <span>{checkHint}</span>
              {checkDetail && <span>{checkDetail}</span>}
              {checkFailure && source === 'custom' && !reauthenticationRequired && <Button variant="outline" size="sm" className="w-fit" onClick={() => serverInput.current?.focus()}>{t('editServerAddress')}</Button>}
            </AlertDescription>
          </Alert>}

          {showingConnection && !connectionReviewRequired && !checkingService && selfHostedServiceAvailable === false && <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{isOffline ? tStatus('selfHostedStatus.offline') : serviceIssue}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{isOffline ? tStatus('selfHostedStatus.offlineHint') : serviceIssueHint}</span>
              {!isOffline && selfHostedServiceIssue === 'instance-changed' && <Button variant="outline" size="sm" onClick={() => editConnection(true)}>
                {t('changeConnection')}
              </Button>}
            </AlertDescription>
          </Alert>}

          {showingConnection && !connectionReviewRequired && selfHostedConnected && syncErrors.length > 0 && (
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

          {showingPasswordForm && <form id={passwordFormId} method="post" onSubmit={event => {
            event.preventDefault()
            if (canSubmitPassword) void connect('password')
          }}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${passwordFormId}-login`}>{t('login')}</FieldLabel>
                <InputGroup>
                  <InputGroupInput id={`${passwordFormId}-login`} name="username" autoComplete="username" required
                    autoCapitalize="off" spellCheck={false} readOnly={pinnedLogin} disabled={connecting} value={login} onChange={event => updateLogin(event.target.value)} />
                  {!pinnedLogin && recentAccounts.length > 0 && <InputGroupAddon align="inline-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <InputGroupButton size="icon-sm" disabled={connecting} aria-label={t('recentAccounts')} title={t('recentAccounts')}>
                          <ChevronDown aria-hidden="true" />
                        </InputGroupButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-max min-w-48 max-w-[calc(100vw-2rem)]" onCloseAutoFocus={event => {
                        if (!recentAccountSelected.current) return
                        recentAccountSelected.current = false
                        event.preventDefault()
                        passwordInput.current?.focus()
                      }}>
                        <DropdownMenuGroup>
                          {recentAccounts.map(account => <DropdownMenuItem key={account.accountId} onSelect={() => {
                            recentAccountSelected.current = true
                            if (login.trim() !== account.login) setPassword('')
                            updateLogin(account.login)
                          }}>
                            <span className="min-w-0 break-all">{account.login}</span>
                          </DropdownMenuItem>)}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </InputGroupAddon>}
                </InputGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${passwordFormId}-password`}>{t('password')}</FieldLabel>
                <Input ref={passwordInput} id={`${passwordFormId}-password`} name="password" type="password" autoComplete="current-password" required
                  disabled={connecting} value={password} onChange={event => setPassword(event.target.value)} />
              </Field>
              {totpRequired && <Field>
                <FieldLabel htmlFor={`${passwordFormId}-totp`}>{t('totp')}</FieldLabel>
                <Input id={`${passwordFormId}-totp`} name="totp" inputMode="numeric" autoComplete="one-time-code" required autoFocus
                  disabled={connecting} maxLength={6} value={totpCode} onChange={event => setTotpCode(event.target.value.replace(/\D/g, ''))} />
              </Field>}
            </FieldGroup>
          </form>}
          {!showingConnection && !reauthenticationRequired && registration === 'invitation' && (
            <p className="text-sm text-muted-foreground">{t('invitationRegistrationHint')}</p>
          )}
          {!showingConnection && !reauthenticationRequired && registration === 'disabled' && (
            <p className="text-sm text-muted-foreground">{t('closedRegistrationHint')}</p>
          )}
        </CardContent>
        <CardFooter className="flex-wrap gap-2 [&>button]:max-w-full [&>button]:whitespace-normal">
          {!connectionReady ? null : showingConnection ? (
            <>
              <Badge variant={selfHostedServiceAvailable === false && !checkingService ? 'destructive' : 'secondary'}>
                <Server aria-hidden="true" />
                {connectionReviewRequired ? t('setupReview') : checkingService ? tStatus('checking') : selfHostedServiceAvailable ? t('authorized') : tStatus('unavailable')}
              </Badge>
              {connectionReviewRequired && <Button ref={continueSetupButton} disabled={!pendingSetupProfileId || connecting || disconnecting || switchInProgress} onClick={openSetup}>
                {connecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <ListChecks data-icon="inline-start" />}
                {t('continueSetup')}
              </Button>}
              {selfHostedServiceAvailable === false && primaryBackupMethod === 'selfHosted' && syncErrors.length === 0 && <Button variant="outline" disabled={retrying || disconnecting} onClick={() => void retrySynchronization()}>
                <RefreshCw data-icon="inline-start" className={cn(retrying && 'animate-spin')} />{tStatus('retry')}
              </Button>}
              {!connectionReviewRequired && <Button variant="outline" disabled={!profileId || connecting || disconnecting} onClick={() => void reviewConnection()}>
                <ListChecks data-icon="inline-start" />{p('nativeReviewAction')}
              </Button>}
              {!connectionReviewRequired && <Button variant="outline" disabled={connecting || disconnecting || switchInProgress} onClick={() => editConnection()}>{t('changeConnection')}</Button>}
              <Button variant="outline" disabled={connecting || disconnecting || switchInProgress} onClick={() => setDisconnectConfirmation(connectionReviewRequired ? 'setup' : 'connection')}>
                {disconnecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <LogOut data-icon="inline-start" />}
                {t(connectionReviewRequired ? 'cancelSetup' : 'disconnect')}
              </Button>
              {source === 'official' && <Button variant="outline" onClick={() => void openUrl(`${OFFICIAL_SYNC_ORIGIN}/?section=devices`).catch(() => toast.error(t('operationFailed')))}>{t('manageDevices')}</Button>}
            </>
          ) : (
            <>
              {showingPasswordForm && <Button type="submit" form={passwordFormId} disabled={!canSubmitPassword}>
                {connecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <LogIn data-icon="inline-start" />}
                {t('passwordLogin')}
              </Button>}
              {!reauthenticationRequired && accountUrl && <Button variant={registration === 'bootstrap' ? 'default' : 'outline'} disabled={connecting || discovering}
                onClick={() => void openUrl(accountUrl)
                  .catch(() => toast.error(t('operationFailed')))}>
                {t(registration === 'bootstrap' ? 'initializeServer' : registration === 'public' ? 'registerInBrowser' : 'openAccountPage')}
              </Button>}
              {browserAvailable && registration !== 'bootstrap' && <Button variant={showingPasswordForm && !reauthenticationRequired ? 'outline' : 'default'} disabled={connecting || disconnecting || discovering || !mayConnect} onClick={() => void connect('browser')}>
                {connecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <LogIn data-icon="inline-start" />}
                {t('browserAuthorization')}
              </Button>}
              <Button variant="outline" disabled={connecting || discovering || !connectionUrl.trim()}
                onClick={() => void discover()}>
                {discovering ? <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin text-info-foreground" />
                  : checkResult === 'serverCheckPassed' ? <CircleCheck aria-hidden="true" data-icon="inline-start" className="text-success-foreground" />
                  : checkResult && <AlertTriangle aria-hidden="true" data-icon="inline-start"
                    className={checkResult === 'serverCheckFailed' ? 'text-destructive' : 'text-warning-foreground'} />}
                <span aria-live="polite">{discovering ? tStatus('checking') : t(checkResult ?? 'checkServer')}</span>
              </Button>
              {source === 'custom' && registration !== 'bootstrap' && !showPasswordLogin && (
                <Button variant="ghost" disabled={!mayConnect || connecting || discovering} onClick={() => setShowPasswordLogin(true)}>{t('usePassword')}</Button>
              )}
              {connectionReviewRequired && reauthenticationRequired && <Button variant="outline" disabled={connecting || disconnecting || switchInProgress} onClick={() => setDisconnectConfirmation('setup')}>
                {t('cancelSetup')}
              </Button>}
              {editingConnection && <Button variant="ghost" disabled={connecting} onClick={() => {
                void Store.load('store.json').then(readSettingsConnections).then(({ pending, current }) => {
                  if (!isActive()) return
                  showProfile(pending ?? current)
                  setConnectionReviewRequired(Boolean(pending))
                  setPreviousConnection(pending && pending.profile.id !== current?.profile.id ? current : null)
                  setConnectionError(null)
                  setRequestId('')
                }).catch(error => toast.error(connectionErrorMessage(error)))
              }}>{t('instanceChangeCancel')}</Button>}
            </>
          )}
        </CardFooter>
      </Card>
      {active && showingConnection && !connectionReviewRequired && profileId && <SelfHostedPersonalDataOptions targetProfileId={profileId} />}
      {active && showingConnection && !connectionReviewRequired && profileId ? (
        <SelfHostedWorkspaces key={`${profileId}:${workspaceRevision}`} profileId={profileId} />
      ) : null}
      {pendingSetupProfileId && <Dialog open={setupOpen && !switchInProgress}
        onOpenChange={open => { if (!open && !savingSetupOptions) void deferSetup() }}>
        <DialogContent className="flex max-h-[calc(var(--mobile-viewport-height,100dvh)-2rem)] min-w-0 flex-col" showCloseButton={!savingSetupOptions} onCloseAutoFocus={event => {
          if (!continueSetupButton.current || connecting || switchInProgress) return
          event.preventDefault()
          continueSetupButton.current.focus()
        }}>
          <DialogHeader className="pr-8">
            <DialogTitle>{t('setupDialogTitle')}</DialogTitle>
            <DialogDescription>{p('nativeReviewRequired')}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-1">
            <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
              <div className="min-w-0"><dt className="text-muted-foreground">{p('targetAccount')}</dt><dd className="break-all">{chosenAccount ?? t('accountUnavailable')}</dd></div>
              <div className="min-w-0"><dt className="text-muted-foreground">{p('targetService')}</dt><dd className="break-all" dir="ltr">{profile?.serverUrl}</dd></div>
            </dl>
            <SelfHostedLibraryChoice key={`library:${setupRevision}`} profileId={pendingSetupProfileId} onSavingChange={setSavingLibraryChoice} onReadyChange={setLibraryChoiceReady} />
            <SelfHostedPersonalDataOptions key={`personal:${setupRevision}`} targetProfileId={pendingSetupProfileId} embedded onSavingChange={setSavingPersonalOptions} onReadyChange={setPersonalOptionsReady} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={savingSetupOptions} onClick={() => {
              void deferSetup().then(() => { if (isActive()) onSetupLater?.() })
            }}>{t('setupLater')}</Button>
            <Button type="button" disabled={connecting || savingSetupOptions || !libraryChoiceReady || !personalOptionsReady} onClick={() => {
              setSetupOpen(false)
              void reviewConnection()
            }}>
              <ListChecks data-icon="inline-start" />{p('nativeReviewAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      <AlertDialog open={disconnectConfirmation !== null} onOpenChange={open => { if (!open) setDisconnectConfirmation(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(disconnectConfirmation === 'setup' ? 'cancelSetup' : 'disconnectTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-2">
              {chosenAccount && <span className="break-all">{t('associatedAccount', { login: chosenAccount })}</span>}
              <span>{t(disconnectConfirmation === 'setup' ? 'cancelSetupDescription' : 'disconnectDescription')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keepConnection')}</AlertDialogCancel>
            <AlertDialogAction disabled={connecting || disconnecting || switchInProgress} onClick={() => void disconnect(disconnectConfirmation === 'setup')}>
              {t(disconnectConfirmation === 'setup' ? 'cancelSetupConfirm' : 'disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function sourceForProfile(profile: SelfHostedProfile): ServiceSource {
  return isOfficialSyncOrigin(profile.serverUrl) ? 'official' : 'custom'
}

async function readConnection(profile: SelfHostedProfile): Promise<Connection> {
  return { profile, needsLogin: profile.state === 'reauthentication-required' || await selfHostedSessionNeedsLogin(profile.id) }
}

async function readSettingsConnections(store: Store) {
  const [database, pendingId, primary] = await Promise.all([
    getDb(), store.get<string>('selfHostedConnectionReviewProfileId'), store.get<string>('primaryBackupMethod'),
  ])
  const pendingProfile = pendingId ? await getProfile(pendingId) : null
  const [currentRow] = await database.select<Array<{ id: string }>>(
    `select id from self_hosted_sync_profiles
      where state = 'connected' or (state = 'reauthentication-required' and id <> $1 and $2 = 'selfHosted')
      order by state = 'connected' desc, updated_at desc limit 1`,
    [pendingId ?? '', primary ?? ''],
  )
  const currentProfile = currentRow?.id === pendingId ? pendingProfile : currentRow ? await getProfile(currentRow.id) : null
  const pendingRead = pendingProfile && ['pending-review', 'connected', 'reauthentication-required'].includes(pendingProfile.state)
    ? readConnection(pendingProfile) : null
  const currentRead = currentProfile === pendingProfile ? pendingRead : currentProfile ? readConnection(currentProfile) : null
  const [pending, current] = await Promise.all([pendingRead, currentRead])
  return { pending, current }
}

function isInsecureAddress(address: string) {
  try { return normalizeServerUrl(address).insecureHttp } catch { return false }
}

function getAccountPageUrl(source: ServiceSource, discovery: { resolvedUrl: string; capabilities: ServerCapabilities } | null) {
  const serverUrl = discovery?.resolvedUrl ?? (source === 'official' ? OFFICIAL_SYNC_ORIGIN : null)
  if (!serverUrl) return null
  const official = source === 'official'
  try {
    const url = new URL(!official && discovery?.capabilities.web?.accountUrl || '/', serverUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const capabilities = discovery?.capabilities
    if (capabilities?.registration?.policy === 'public' || (!capabilities?.registration && capabilities?.registrationMode === 'open')) {
      url.searchParams.set('mode', 'register')
    }
    return url.toString()
  } catch {
    return null
  }
}

function persistServerUrlDraft(value: string) {
  return persistConnectionDraft('selfHostedServerUrlDraft', value)
}

function persistConnectionDraft(key: 'selfHostedServerUrlDraft' | 'selfHostedServiceSource', value: string) {
  serverUrlDraftWrite = serverUrlDraftWrite.catch(() => undefined).then(async () => {
    const store = await Store.load('store.json')
    await store.set(key, value)
    await store.save()
  })
  return serverUrlDraftWrite
}
