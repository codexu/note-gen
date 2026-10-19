'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { ChevronDown, Code, Download, Eye, RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { ResponsiveSelect } from '@/components/responsive-select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
import { exportCodeBlockImage, type CodeBlockImageFormat } from '@/lib/plugins/code-block-export'
import { usePluginResources } from '@/lib/plugins/resources'
import { usePluginStore } from '@/stores/plugins'
import { resolveManifestText } from '@/lib/plugins/manifest'
import { getLoadedPluginMessages, usePluginLocalization } from '@/lib/plugins/localization'
import {
  acquireCodeBlockRenderer, codeBlockRendererProviders, listenCodeBlockRendererPreferences,
  rendererPreferenceKey, selectCodeBlockRenderer, useCodeBlockRendererPreferences,
  type CodeBlockRendererProvider,
} from '@/lib/plugins/code-block-renderers'
import { getEditorViewportRoot } from '@/app/core/main/editor/markdown/viewport-activation'
import { getPluginManifestFingerprint } from '@/lib/plugins/internal-types'
import { getCommonLowlight } from '@/app/core/main/editor/markdown/code-block-languages'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

export function CodeBlockPluginDiscovery({ language, active, compact = false }: { language: string; active: boolean; compact?: boolean }) {
  const t = useTranslations('editor.codeBlockPreview')
  const openPluginDiscovery = useSettingsDialogStore(state => state.openPluginDiscovery)
  const normalizedLanguage = language.trim().toLowerCase()
  const [unsupportedLanguage, setUnsupportedLanguage] = useState<string | null>(null)
  useEffect(() => {
    if (!active || !normalizedLanguage || ['plaintext', 'text', 'txt', 'none', 'mermaid'].includes(normalizedLanguage)) return
    let cancelled = false
    void getCommonLowlight().then(lowlight => {
      if (!cancelled) setUnsupportedLanguage(lowlight.registered(normalizedLanguage) ? null : normalizedLanguage)
    }).catch(() => { /* A highlighter loading failure does not imply an unsupported language. */ })
    return () => { cancelled = true }
  }, [active, normalizedLanguage])
  if (!active || !normalizedLanguage || unsupportedLanguage !== normalizedLanguage) return null
  return <div contentEditable={false} className={compact ? 'plugin-code-block-discovery contents' : 'plugin-code-block-discovery flex justify-end px-3 py-2'}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Button type="button" variant="outline" size="xs" title={t('findPluginFor', { language: normalizedLanguage })}
      onMouseDown={event => event.preventDefault()} onClick={() => openPluginDiscovery(normalizedLanguage)}>
      <Search data-icon="inline-start" />{t('findPlugin')}
    </Button>
  </div>
}

export function useCodeBlockRenderer(language: string) {
  const entries = usePluginResources(state => state.entries)
  const preferences = useCodeBlockRendererPreferences(state => state.values)
  const workspace = usePluginStore(state => state.currentWorkspaceId) ?? ''
  useEffect(() => listenCodeBlockRendererPreferences(), [])
  const providers = useMemo(() => codeBlockRendererProviders(language), [entries, language])
  const preferred = preferences[rendererPreferenceKey(workspace, language)]
  const provider = providers.find(item => item.key === preferred) ?? (providers.length === 1 ? providers[0] : null)
  const select = useCallback((key: string) => selectCodeBlockRenderer(workspace, language, key), [workspace, language])
  return { providers, provider, select }
}

interface PreviewState { owner: string; image?: string; error?: string }
export function PluginCodeBlockPreview({ source, language, providers, provider, select, active, showSource, onShowSource }: {
  source: string
  language: string
  providers: CodeBlockRendererProvider[]
  provider: CodeBlockRendererProvider | null | undefined
  select(key: string): void
  active: boolean
  showSource: boolean
  onShowSource(value: boolean, focus?: boolean): void
}) {
  const t = useTranslations('editor.codeBlockPreview')
  const locale = useLocale()
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light'
  const installed = usePluginStore(state => state.installed)
  const workspace = usePluginStore(state => state.currentWorkspaceId)
  usePluginLocalization(installed, locale)
  const container = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)
  useEffect(() => {
    const element = container.current
    if (!active || !element) return
    if (typeof IntersectionObserver === 'undefined') { setNearViewport(true); return }
    const observer = new IntersectionObserver(entries => setNearViewport(entries.some(entry => entry.isIntersecting)), {
      root: getEditorViewportRoot(element), rootMargin: '200px 0px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [active, providers.length])
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<PreviewState | null>(null)
  const [exporting, setExporting] = useState(false)
  const exportBusy = useRef(false)
  const exportLifetime = useRef({ active: true })
  useEffect(() => {
    const lifetime = { active: true }
    exportLifetime.current = lifetime
    return () => { lifetime.active = false }
  }, [])
  const fingerprint = provider ? getPluginManifestFingerprint(provider.plugin) : ''
  const owner = JSON.stringify([workspace, fingerprint, provider?.key, source, language, theme, locale, attempt])
  const current = state?.owner === owner ? state : null
  const handleExport = async (format: CodeBlockImageFormat) => {
    if (!current?.image || current.error || exportBusy.current) return
    const lifetime = exportLifetime.current
    const image = current.image
    exportBusy.current = true
    setExporting(true)
    try {
      const saved = await exportCodeBlockImage(image, language, t('exportImage'), format)
      if (saved && lifetime.active) toast({ title: t('exportSuccess') })
    } catch (error) {
      if (lifetime.active) toast({ title: t('exportFailed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally {
      exportBusy.current = false
      if (lifetime.active) setExporting(false)
    }
  }
  useEffect(() => {
    if (!active || !nearViewport || !provider || !source.trim()) return
    const controller = new AbortController()
    const service = acquireCodeBlockRenderer(provider)
    const timer = setTimeout(() => {
      void service.render({ requestId: crypto.randomUUID(), language: language.trim().toLowerCase(), source, theme, locale }, controller.signal).then(
        image => { if (!controller.signal.aborted) setState({ owner, image: image.dataUrl }) },
        reason => {
          if (controller.signal.aborted) return
          setState({ owner, error: reason instanceof Error ? reason.message : String(reason) })
          onShowSource(true)
        },
      )
    }, 300)
    return () => { clearTimeout(timer); controller.abort(); service.release() }
    // The owner includes the exact package, block text, workspace and display options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, active, nearViewport, onShowSource])
  const name = (item: CodeBlockRendererProvider) => resolveManifestText(item.renderer.name, getLoadedPluginMessages(item.plugin.manifest.id, locale))
  if (!providers.length) return <CodeBlockPluginDiscovery language={language} active={active} />
  if (!active) return null
  return <div ref={container} contentEditable={false} className="plugin-code-block-preview" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      {providers.length > 1 ? <ResponsiveSelect
        title={t('renderer')} value={provider?.key ?? ''} placeholder={t('chooseRenderer')}
        options={providers.map(item => ({ value: item.key, label: `${name(item)} · ${item.plugin.manifest.id}` }))}
        onValueChange={select} className="max-w-full flex-1"
      /> : provider ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={name(provider)}>{name(provider)}</span> : null}
      <Button type="button" size="xs" variant="outline"
        disabled={!provider} onMouseDown={event => event.preventDefault()}
        onClick={() => { onShowSource(!showSource, true); if (showSource && current?.error) setAttempt(value => value + 1) }}>
        {showSource ? <Eye data-icon="inline-start" /> : <Code data-icon="inline-start" />}
        {showSource ? t('preview') : t('editSource')}
      </Button>
      {!showSource ? <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="xs" variant="outline"
            disabled={!current?.image || Boolean(current?.error) || exporting} aria-busy={exporting}
            onMouseDown={event => event.preventDefault()}>
            <Download data-icon="inline-start" />{exporting ? t('exporting') : t('exportImage')}<ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={exporting} onSelect={() => void handleExport('png')}>PNG</DropdownMenuItem>
            <DropdownMenuItem disabled={exporting || !current?.image?.startsWith('data:image/svg+xml;')}
              title={!current?.image?.startsWith('data:image/svg+xml;') ? t('svgUnavailable') : undefined}
              onSelect={() => void handleExport('svg')}>SVG</DropdownMenuItem>
            <DropdownMenuItem disabled={exporting} onSelect={() => void handleExport('jpeg')}>JPEG</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu> : null}
      {current?.error ? <Button type="button" size="icon-xs" variant="ghost" aria-label={t('retry')} title={t('retry')}
        onMouseDown={event => event.preventDefault()} onClick={() => setAttempt(value => value + 1)}><RotateCcw /></Button> : null}
    </div>
    {!provider ? <p className="px-3 pb-3 text-xs text-muted-foreground">{t('chooseRenderer')}</p> : null}
    {current?.error ? <Alert variant="destructive" className="mb-2"><AlertDescription className="break-words">{t('failed')} {current.error}</AlertDescription></Alert> : null}
    {!showSource && provider ? <div className="max-h-[60vh] overflow-auto p-3">
      {!source.trim() ? <p className="text-sm text-muted-foreground">{t('empty')}</p>
        : current?.image ? <img src={current.image} alt={t('imageAlt', { language })} draggable={false} className="mx-auto block max-w-full" onError={() => {
          setState({ owner, error: t('invalidOutput') })
          onShowSource(true)
        }} />
        : !current?.error ? <div role="status" aria-label={t('loading')}><Skeleton className="h-24 w-full" /><span className="sr-only">{t('loading')}</span></div> : null}
    </div> : null}
  </div>
}
