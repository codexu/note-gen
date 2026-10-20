'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PluginPermissionName } from '@notegen/plugin-api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { readPluginResource } from '@/lib/plugins/backend'
import { connectPluginFrameCapabilities } from '@/lib/plugins/frame-capabilities'
import { getPluginManifestFingerprint, isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'

interface EmbeddedResource { id: string; script: string; style: string }

function hostTheme(element: HTMLElement | null) {
  const host = element ?? document.body
  const style = getComputedStyle(host)
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  host.appendChild(probe)
  const color = (token: string, fallback: string) => {
    probe.style.color = `hsl(var(--${token}))`
    return getComputedStyle(probe).color || fallback
  }
  const background = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? style.backgroundColor : color('background', '#fff')
  const foreground = style.color || color('foreground', '#171717')
  const theme = {
    background, foreground,
    primary: color('primary', foreground),
    muted: color('muted', background),
    mutedForeground: color('muted-foreground', foreground),
    border: color('border', foreground),
    destructive: color('destructive', foreground),
    fontFamily: getComputedStyle(document.body).fontFamily,
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    colorScheme: document.documentElement.classList.contains('dark') ? 'dark' as const : 'light' as const,
  }
  probe.remove()
  return theme
}

export function PluginSandboxedView({ scope, resourceId }: { scope: string; resourceId: string }) {
  const pluginId = scope.split(':')[0]
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const workspaceStates = usePluginStore(state => state.workspaceStates)
  const deviceSettings = usePluginStore(state => state.deviceSettings[pluginId])
  const plugin = usePluginStore(state => state.installed.find(item => item.manifest.id === pluginId))
  const workspaceState = workspaceId ? workspaceStates[workspaceId]?.[pluginId] : undefined
  const viewSettings = useMemo(() => Object.fromEntries((plugin?.manifest.contributes.settings ?? [])
    .filter(setting => setting.type === 'boolean' || setting.type === 'number' || setting.type === 'select'
      || (setting.type === 'string' && !setting.permissionPaths?.length))
    .map(setting => [setting.key, (setting.scope === 'device' ? deviceSettings : workspaceState?.settings)?.[setting.key] ?? setting.default])),
  [plugin, deviceSettings, workspaceState?.settings])
  const settingsRef = useRef(viewSettings)
  settingsRef.current = viewSettings
  const portRef = useRef<MessagePort | null>(null)
  const allowed = Boolean(plugin && isPluginEnabledInWorkspace(plugin, workspaceState))
  const resources = plugin?.manifest.resources as unknown as { embeddedViews?: EmbeddedResource[] } | undefined
  const resource = resources?.embeddedViews?.find(item => item.id === resourceId)
  const terminalPermission = 'terminal.open' as PluginPermissionName
  const terminalGrant = workspaceState?.permissions[terminalPermission]
  const terminalAllowed = Boolean(plugin?.manifest.permissions[terminalPermission] && terminalGrant?.granted
    && plugin && terminalGrant.manifestFingerprint === getPluginManifestFingerprint(plugin))
  const t = useTranslations('settings.plugins.embeddedView')
  const locale = useLocale()
  const frame = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState('')
  const [frameToken, setFrameToken] = useState('')
  const [loadedSource, setLoadedSource] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setSource('')
    setFrameToken('')
    setLoadedSource('')
    setError('')
    if (!allowed || !plugin || !resource) return
    let alive = true
    let readyListener: ((event: MessageEvent) => void) | undefined
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    void Promise.all([
      readPluginResource(plugin, resource.script),
      readPluginResource(plugin, resource.style),
    ]).then(([scriptBytes, styleBytes]) => {
      if (!alive) return
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const script = decoder.decode(scriptBytes).replace(/<\/script/gi, '<\\/script')
      const style = decoder.decode(styleBytes).replace(/<\/style/gi, '<\\/style')
      const token = crypto.randomUUID().replaceAll('-', '')
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>${style}</style></head><body style="margin:0;width:100vw;height:100vh;overflow:hidden"><script nonce="${token}">window.__notegenFrameToken='${token}';window.addEventListener('error',function(event){parent.postMessage({type:'notegen:embedded-view-error',token:'${token}',message:String(event.message)},'*')});window.addEventListener('unhandledrejection',function(event){parent.postMessage({type:'notegen:embedded-view-error',token:'${token}',message:String(event.reason)},'*')});</script><script nonce="${token}">${script}</script><script nonce="${token}">parent.postMessage({type:'notegen:embedded-view-ready',token:'${token}'},'*')</script></body></html>`
      readyListener = event => {
        if (!alive || (event.source && event.source !== frame.current?.contentWindow)) return
        if (event.data?.token !== token) return
        if (event.data?.type === 'notegen:embedded-view-error') {
          clearTimeout(readyTimer)
          setError(String(event.data.message || t('unavailable')))
        } else if (event.data?.type === 'notegen:embedded-view-ready') {
          clearTimeout(readyTimer)
          setLoadedSource(html)
        }
      }
      window.addEventListener('message', readyListener)
      setFrameToken(token)
      setSource(html)
      readyTimer = setTimeout(() => { if (alive) setError(t('loadTimeout')) }, 15_000)
    }).catch(reason => { if (alive) setError(String(reason)) })
    return () => { alive = false; clearTimeout(readyTimer); if (readyListener) window.removeEventListener('message', readyListener) }
  }, [allowed, plugin, resource?.script, resource?.style, workspaceId, terminalAllowed, locale])

  useEffect(() => {
    if (!allowed || !source || !frameToken || loadedSource !== source || !workspaceId || !frame.current?.contentWindow) return
    let alive = true
    let disposeCapabilities: (() => void) | undefined
    let themeObserver: MutationObserver | undefined
    let themeFrame = 0
    let initTimer: ReturnType<typeof setTimeout> | undefined
    const channel = new MessageChannel()
    const port = channel.port1
    portRef.current = port
    const theme = () => hostTheme(frame.current?.parentElement ?? null)
    void (async () => {
      try {
        const capabilities = await connectPluginFrameCapabilities({ pluginId, workspaceId, port, terminal: terminalAllowed })
        if (!alive) { capabilities.dispose(); return }
        disposeCapabilities = capabilities.dispose
        port.onmessage = event => {
          if (!alive || !event.data || typeof event.data !== 'object') return
          if (event.data.type === 'frame.ready') { clearTimeout(initTimer); return }
          capabilities.handle(event.data)
        }
        themeObserver = new MutationObserver(() => {
          if (themeFrame) return
          themeFrame = requestAnimationFrame(() => {
            themeFrame = 0
            if (alive) port.postMessage({ type: 'host.theme', theme: theme() })
          })
        })
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
        themeObserver.observe(document.head, { childList: true, characterData: true, subtree: true })
        const initialTheme = theme()
        frame.current?.contentWindow?.postMessage({
          type: 'notegen:embedded-view-init', protocol: 1, token: frameToken, locale,
          capabilities: terminalAllowed ? ['terminal'] : [],
          settings: settingsRef.current,
          background: initialTheme.background, foreground: initialTheme.foreground, theme: initialTheme,
        }, '*', [channel.port2])
        initTimer = setTimeout(() => { if (alive) setError(t('initTimeout')) }, 15_000)
      } catch (reason) { if (alive) setError(String(reason)) }
    })()
    return () => {
      alive = false
      disposeCapabilities?.()
      themeObserver?.disconnect()
      if (themeFrame) cancelAnimationFrame(themeFrame)
      clearTimeout(initTimer)
      if (portRef.current === port) portRef.current = null
      port.close()
      channel.port2.close()
    }
  }, [allowed, source, frameToken, loadedSource, pluginId, workspaceId, terminalAllowed, locale])

  useEffect(() => {
    portRef.current?.postMessage({ type: 'host.settings', settings: viewSettings })
  }, [viewSettings])

  if (!allowed) return <Alert><AlertDescription>{t('notEnabled')}</AlertDescription></Alert>
  if (!resource) return <Alert><AlertDescription>{t('missingResource')}</AlertDescription></Alert>
  if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  return source
    ? <div className="h-full min-h-0 w-full min-w-0 bg-background text-foreground"><iframe ref={frame} title={t('title')} sandbox="allow-scripts" referrerPolicy="no-referrer" className="block h-full w-full border-0" srcDoc={source} /></div>
    : <div role="status" className="p-3 text-sm text-muted-foreground">{t('loading')}</div>
}
