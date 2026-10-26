'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Check, Download, ExternalLink, RefreshCw, Settings2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/hooks/use-toast'
import type { SkillScope } from '@/lib/skills/types'
import { isMobileDevice } from '@/lib/check'
import {
  inspectSkillEnvironment,
  installSkillNodeDependencies,
  installSkillPythonDependencies,
  type SkillEnvironmentStatus,
} from '@/lib/skills/runtime'

const DOCUMENT_DEPENDENCIES: Record<string, { python: string[]; node: string[] }> = {
  pdf: { python: ['pypdf', 'pdfplumber', 'reportlab', 'Pillow', 'pdf2image', 'pytesseract'], node: ['pdf-lib'] },
  docx: { python: ['lxml', 'defusedxml', 'Pillow'], node: ['docx'] },
}

export function SkillEnvironmentDialog({ skillId, scope, onChanged }: { skillId: string; scope: SkillScope; onChanged?: () => void }) {
  const t = useTranslations('settings.skills.environment')
  const tc = useTranslations('common')
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SkillEnvironmentStatus | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<'python' | 'node' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dependencies = DOCUMENT_DEPENDENCIES[skillId]
  const mobile = isMobileDevice()

  useEffect(() => {
    if (!open || mobile) return
    let active = true
    setLoading(true)
    setError(null)
    void inspectSkillEnvironment(skillId, scope)
      .then(result => { if (active) setStatus(result) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, refreshKey, skillId, scope, mobile])

  const installDependencies = async (language: 'python' | 'node') => {
    const packages = dependencies?.[language]
    if (!packages?.length || installing) return
    setInstalling(language)
    setError(null)
    try {
      await (language === 'python' ? installSkillPythonDependencies : installSkillNodeDependencies)(skillId, packages, undefined, scope)
      toast({ title: t('installed') })
      onChanged?.()
      setRefreshKey(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setInstalling(null)
    }
  }

  const openDownload = async (url: string) => {
    try {
      await openUrl(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const commands = status ? [
    { name: 'Python', available: status.python.available, version: status.python.version },
    status.node,
    status.npm,
    ...status.commands,
  ] : []

  return (
    <Dialog open={open} onOpenChange={value => { if (!installing) setOpen(value) }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('title')} title={t('title')}><Settings2 /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" showCloseButton={!installing}>
        <DialogHeader>
          <DialogTitle>{t('title')} · {skillId}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {mobile ? (
          <Alert><AlertDescription>{t('desktopOnly')}</AlertDescription></Alert>
        ) : loading && !status ? (
          <div className="flex items-center gap-2" role="status"><Spinner />{tc('loading')}</div>
        ) : status ? (
          <ItemGroup className="gap-2">
            {commands.map(command => (
              <Item key={command.name} variant="outline" size="sm">
                <ItemContent><ItemTitle>{command.name === 'soffice' ? 'LibreOffice' : command.name}</ItemTitle></ItemContent>
                <ItemActions>
                  <Badge variant={command.available ? 'secondary' : 'outline'}>
                    {command.available ? <Check /> : null}
                    {command.available ? command.version || t('available') : t('missing')}
                  </Badge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : null}
        {!mobile && <Alert>
          <AlertDescription>{t('systemToolsHelp')}</AlertDescription>
        </Alert>}
        {!mobile && dependencies && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t('dependencyHelp')}</p>
            {(['python', 'node'] as const).filter(language => dependencies[language].length > 0).map(language => (
              <div key={language} className="flex flex-col gap-2">
                <p className="break-words text-xs text-muted-foreground">{dependencies[language].join(', ')}</p>
                <Button
                  variant="outline"
                  disabled={loading || installing !== null || !(language === 'python' ? status?.python.available : status?.node.available && status.npm.available)}
                  onClick={() => void installDependencies(language)}
                >
                  {installing === language ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                  {t(language === 'python' ? 'installPython' : 'installNode')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {!mobile && <div className="flex flex-wrap gap-2">
          <Button variant="link" size="sm" onClick={() => void openDownload('https://www.python.org/downloads/')}>Python<ExternalLink data-icon="inline-end" /></Button>
          <Button variant="link" size="sm" onClick={() => void openDownload('https://nodejs.org/en/download')}>Node.js<ExternalLink data-icon="inline-end" /></Button>
          <Button variant="link" size="sm" onClick={() => void openDownload('https://www.libreoffice.org/download/')}>LibreOffice<ExternalLink data-icon="inline-end" /></Button>
        </div>}
        <DialogFooter>
          <Button variant="outline" disabled={mobile || loading || installing !== null} onClick={() => setRefreshKey(value => value + 1)}>
            {loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}{tc('refresh')}
          </Button>
          <Button disabled={installing !== null} onClick={() => setOpen(false)}>{tc('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
