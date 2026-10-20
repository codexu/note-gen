'use client'

import { invoke } from '@tauri-apps/api/core'
import { AlertTriangle, Cable, Copy, KeyRound, Network } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { supportsNativeDeveloperTools } from '@/lib/developer-tools'
import type { LocalMcpConnectionSecret, LocalMcpStatus } from '@/lib/local-mcp/types'
import { getWorkspacePath } from '@/lib/workspace'
import useSettingStore from '@/stores/setting'

import { SettingSection } from '../components/setting-base'

type PendingAction = 'toggle' | 'copy' | 'reset' | 'port' | null

export function LocalMcpServer() {
  const t = useTranslations('settings.localMcp')
  const { toast } = useToast()
  const [status, setStatus] = useState<LocalMcpStatus | null>(null)
  const [workspace, setWorkspace] = useState('')
  const [portDraft, setPortDraft] = useState('37422')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [secret, setSecret] = useState<LocalMcpConnectionSecret | null>(null)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const desktop = supportsNativeDeveloperTools()
  const endpoint = `http://127.0.0.1:${status?.port ?? 37422}/mcp`
  const parsedPort = Number(portDraft)
  const portIsInvalid = portDraft.length === 0 || !Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535
  const busy = pendingAction !== null
  const config = useMemo(() => {
    if (!secret) return null
    return JSON.stringify({
      name: 'notegen',
      transport: 'streamable-http',
      url: endpoint,
      headers: { Authorization: `Bearer ${secret.token}` },
    }, null, 2)
  }, [endpoint, secret])

  async function refresh() {
    setStatus(await invoke<LocalMcpStatus>('get_local_mcp_status'))
  }

  useEffect(() => {
    if (!desktop) return
    void refresh().catch(error => toast({ title: t('loadFailed'), description: String(error), variant: 'destructive' }))
    const timer = window.setInterval(() => {
      void invoke<LocalMcpStatus>('get_local_mcp_status').then(nextStatus => {
        setStatus(nextStatus)
      }).catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [desktop])

  useEffect(() => {
    if (!desktop) return
    void getWorkspacePath().then(currentWorkspace => {
      setWorkspace(currentWorkspace.isCustom ? currentWorkspace.path : t('defaultWorkspace'))
    })
  }, [desktop, workspacePath])

  useEffect(() => {
    if (status) setPortDraft(String(status.port))
  }, [status?.port])

  async function toggle(enabled: boolean) {
    setPendingAction('toggle')
    try {
      await invoke('set_local_mcp_enabled', { enabled })
      await refresh()
    } catch (error) {
      toast({ title: t('updateFailed'), description: String(error), variant: 'destructive' })
    } finally {
      setPendingAction(null)
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value)
    toast({ title: t('configCopied') })
  }

  async function copyConnectionConfig() {
    setPendingAction('copy')
    try {
      if (!status?.enabled) await invoke('set_local_mcp_enabled', { enabled: true })
      const nextSecret = await invoke<LocalMcpConnectionSecret>('get_or_create_local_mcp_connection', {
        name: t('defaultConnectionName'),
      })
      const nextConfig = JSON.stringify({
        name: 'notegen',
        transport: 'streamable-http',
        url: endpoint,
        headers: { Authorization: `Bearer ${nextSecret.token}` },
      }, null, 2)
      setSecret(nextSecret)
      await navigator.clipboard.writeText(nextConfig)
      toast({ title: t('configCopied') })
      await refresh()
    } catch (error) {
      toast({ title: t('actionFailed'), description: String(error), variant: 'destructive' })
    } finally {
      setPendingAction(null)
    }
  }

  async function resetAccessToken() {
    setPendingAction('reset')
    try {
      const nextSecret = await invoke<LocalMcpConnectionSecret>('reset_local_mcp_access_token', {
        name: t('defaultConnectionName'),
      })
      const nextConfig = JSON.stringify({
        name: 'notegen',
        transport: 'streamable-http',
        url: endpoint,
        headers: { Authorization: `Bearer ${nextSecret.token}` },
      }, null, 2)
      setSecret(nextSecret)
      await navigator.clipboard.writeText(nextConfig)
      toast({ title: t('configCopied') })
      await refresh()
    } catch (error) {
      toast({ title: t('actionFailed'), description: String(error), variant: 'destructive' })
    } finally {
      setPendingAction(null)
    }
  }

  async function savePort() {
    if (portIsInvalid) {
      toast({ title: t('portInvalid'), variant: 'destructive' })
      return
    }
    setPendingAction('port')
    try {
      const nextStatus = await invoke<LocalMcpStatus>('set_local_mcp_port', { port: parsedPort })
      setStatus(nextStatus)
      toast({ title: t('portSaved') })
    } catch (error) {
      toast({ title: t('portUpdateFailed'), description: String(error), variant: 'destructive' })
    } finally {
      setPendingAction(null)
    }
  }

  if (!desktop) return null

  return (
    <SettingSection
      title={t('title')}
      desc={t('desc')}
      actions={(
        <Button
          disabled={busy || status === null}
          onClick={() => config ? void copy(config) : void copyConnectionConfig()}
        >
          {pendingAction === 'copy' ? <Spinner data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {config || status?.enabled ? t('copyConfig') : t('connect')}
        </Button>
      )}
    >
      <ItemGroup className="gap-3">
        <Item variant="outline">
          <ItemMedia variant="icon"><Network /></ItemMedia>
          <ItemContent>
            <ItemTitle className="flex items-center gap-2">
              {t('serviceTitle')}
              <Badge variant={status?.enabled && status.ready && !status.serverError ? 'default' : 'secondary'}>
                {status?.serverError ? t('error') : status?.enabled && status.ready ? t('running') : t('stopped')}
              </Badge>
            </ItemTitle>
            <ItemDescription>{t('permissionDesc', { workspace })}</ItemDescription>
          </ItemContent>
          <ItemActions className="ml-auto">
            <Switch
              checked={status?.enabled ?? false}
              disabled={busy || status === null}
              aria-label={t('serviceTitle')}
              onCheckedChange={value => void toggle(value)}
            />
          </ItemActions>
        </Item>

        {status?.serverError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t('portErrorTitle')}</AlertTitle>
            <AlertDescription>{status.serverError}</AlertDescription>
          </Alert>
        ) : null}

        <Item variant="outline" size="sm">
          <ItemMedia variant="icon"><Cable /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('portTitle')}</ItemTitle>
            <ItemDescription>{t('portDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Field data-invalid={portIsInvalid}>
              <FieldLabel htmlFor="local-mcp-port" className="sr-only">{t('portTitle')}</FieldLabel>
              <InputGroup className="w-40">
                <InputGroupInput
                  id="local-mcp-port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={portDraft}
                  disabled={busy}
                  aria-invalid={portIsInvalid}
                  onChange={event => setPortDraft(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton disabled={busy || portDraft === String(status?.port ?? '')} onClick={() => void savePort()}>
                    {pendingAction === 'port' ? <Spinner /> : t('save')}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </ItemActions>
        </Item>

        <Item variant="outline" size="sm">
          <ItemMedia variant="icon"><KeyRound /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('resetAccessTitle')}</ItemTitle>
            <ItemDescription>{t('resetAccessDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy || status === null}>
                  {t('resetAccess')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogMedia><AlertTriangle /></AlertDialogMedia>
                  <AlertDialogTitle>{t('regenerateTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('regenerateDesc')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void resetAccessToken()}>{t('resetAccess')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </ItemActions>
        </Item>
      </ItemGroup>

      <Dialog open={secret !== null} onOpenChange={open => !open && setSecret(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('secretTitle')}</DialogTitle>
            <DialogDescription>{t('secretDesc')}</DialogDescription>
          </DialogHeader>
          {config ? <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">{config}</pre> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => config && void copy(config)}>
              <Copy data-icon="inline-start" />
              {t('copyConfig')}
            </Button>
            <Button onClick={() => setSecret(null)}>{t('done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingSection>
  )
}
