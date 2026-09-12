'use client'

import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { arch, locale, platform, version } from '@tauri-apps/plugin-os'
import { Check, ClipboardCopy, Download, Eye, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/hooks/use-toast'
import { supportsNativeDeveloperTools } from '@/lib/developer-tools'
import { getSelfHostedDiagnosticSummary } from '@/lib/diagnostics/self-hosted'
import {
  clearRuntimeLogs,
  getRuntimeLogs,
  sanitizeDiagnosticValue,
  subscribeRuntimeLogs,
} from '@/lib/diagnostics/runtime-log-buffer'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'

export function DeveloperDiagnostics() {
  const t = useTranslations('settings.dev.diagnostics')
  const { toast } = useToast()
  const [preview, setPreview] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [logCount, setLogCount] = useState(() => getRuntimeLogs().length)
  const android = readSystemInformation().platform === 'android'
  const canExport = supportsNativeDeveloperTools() || android

  useEffect(() => subscribeRuntimeLogs(setLogCount), [])

  async function buildPreview() {
    setLoading(true)
    try {
      const settings = useSettingStore.getState()
      const sync = useSyncStore.getState()
      const [appVersion, systemLocale, selfHosted] = await Promise.all([
        getVersion().catch(() => null),
        locale().catch(() => null),
        getSelfHostedDiagnosticSummary(),
      ])
      const logs = getRuntimeLogs()
      const system = readSystemInformation()
      const payload = sanitizeDiagnosticValue({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        app: {
          version: appVersion,
          platform: system.platform,
          osVersion: system.osVersion,
          arch: system.arch,
          locale: systemLocale,
          language: settings.language,
        },
        sync: {
          primaryPlatform: settings.primaryBackupMethod,
          selfHostedConnected: sync.selfHostedConnected,
          selfHostedRuntimeReady: sync.selfHostedRuntimeReady,
          selfHosted,
        },
        runtimeLogs: logs,
      })
      setLogCount(logs.length)
      setPreview(JSON.stringify(payload, null, 2))
      setPreviewOpen(true)
    } catch (error) {
      toast({
        title: t('failed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  async function copyPreview() {
    try {
      await writeText(preview)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch (error) {
      toast({
        title: t('copyFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  async function exportPreview() {
    try {
      const destination = await save({
        defaultPath: `notegen-redacted-diagnostics-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: [android ? 'application/json' : 'json'] }],
      })
      if (!destination) return
      await writeTextFile(destination, preview)
      toast({ title: t('exported') })
    } catch (error) {
      toast({
        title: t('exportFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  function clearLogs() {
    clearRuntimeLogs()
    setLogCount(0)
    toast({ title: t('cleared') })
  }

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description', { count: logCount })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={clearLogs}>
            <Trash2 data-icon="inline-start" />{t('clear')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void buildPreview()} disabled={loading}>
            {loading ? <Spinner data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
            {t('preview')}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="h-[min(760px,calc(100dvh-2rem))] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('previewTitle')}</DialogTitle>
            <DialogDescription>{t('reviewWarning')}</DialogDescription>
          </DialogHeader>
          <Textarea
            className="h-full min-h-0 field-sizing-fixed resize-none overscroll-contain select-text font-mono text-xs"
            value={preview}
            readOnly
            aria-label={t('previewTitle')}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => void copyPreview()}>
              {copied ? <Check data-icon="inline-start" /> : <ClipboardCopy data-icon="inline-start" />}
              {copied ? t('copied') : t('copy')}
            </Button>
            {canExport ? (
              <Button onClick={() => void exportPreview()}>
                <Download data-icon="inline-start" />{t('export')}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function readSystemInformation() {
  try {
    return {
      platform: platform(),
      osVersion: version(),
      arch: arch(),
    }
  } catch {
    return {
      platform: 'unknown',
      osVersion: 'unknown',
      arch: 'unknown',
    }
  }
}
