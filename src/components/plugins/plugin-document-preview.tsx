'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { usePluginResources, resolvePluginPreview } from '@/lib/plugins/resources'
import { readPluginResource } from '@/lib/plugins/backend'
import { assertPluginExecutionCurrent, readPluginPreviewChunk } from '@/lib/plugins/broker'
import { getPluginManifestFingerprint } from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'
import { UnsupportedFile } from '@/app/core/main/editor/unsupported-file'
import { MainStatusBarPortal } from '@/app/core/main/main-status-bar'
import { getLoadedPluginMessages, usePluginLocalization } from '@/lib/plugins/localization'
import { resolveManifestText } from '@/lib/plugins/manifest'

export function PluginDocumentPreview({ path, isActive = true }: { path: string; isActive?: boolean }) {
  const locale = useLocale()
  const installed = usePluginStore(state => state.installed)
  usePluginLocalization(installed, locale)
  const entries = usePluginResources(state => state.entries)
  const selected = resolvePluginPreview(path)
  const frame = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [previewStatus, setPreviewStatus] = useState<{ owner: string; text: string } | null>(null)
  const identity = selected ? getPluginManifestFingerprint(selected.plugin) + ':' + selected.preview.id : ''
  const statusOwner = `${identity}\0${path}\0${locale}`
  const statusText = previewStatus?.owner === statusOwner ? previewStatus.text : ''
  useEffect(() => {
    setSource('')
    setError('')
    setPreviewStatus(null)
    if (!selected) return
    const { plugin, preview } = selected
    const store = usePluginStore.getState()
    const binding = { workspaceId: store.currentWorkspaceId ?? '', workspaceKey: store.currentWorkspaceKey ?? '' }
    const fingerprint = getPluginManifestFingerprint(plugin)
    let disposed = false
    let port: MessagePort | undefined
    let initialized = false
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    let readyListener: ((event: MessageEvent) => void) | undefined
    let inFlight = 0
    let total = 0
    let requests = 0
    let statusRevision = 0
    const guard = async () => {
      if (disposed) throw new Error('Preview closed')
      await assertPluginExecutionCurrent(plugin.manifest.id, binding)
      const current = usePluginStore.getState().installed.find(x => x.manifest.id === plugin.manifest.id)
      if (disposed || !current || getPluginManifestFingerprint(current) !== fingerprint) throw new Error('Preview package changed')
    }
    void (async () => {
      await guard()
      const bytes = await readPluginResource(plugin, preview.script)
      await guard()
      const reportErrors = `(() => { let port; const errors = []; const report = message => { if (port) port.postMessage({type:'preview-error',message}); else errors.push(message); }; window.addEventListener('error', e => report(e.message)); window.addEventListener('unhandledrejection', e => report(String(e.reason))); window.addEventListener('message', e => { if (e.data?.type === 'notegen:preview-init' && e.ports[0]) { port = e.ports[0]; errors.forEach(report); } }, {once:true}); })();\n`
      const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const nonce = crypto.randomUUID().replaceAll('-', '')
      const initialize = () => {
        if (disposed || initialized || !frame.current?.contentWindow) return
        initialized = true
        clearTimeout(readyTimer)
        const channel = new MessageChannel()
        port = channel.port1
        port.onmessage = event => {
          if (disposed) return
          const request = event.data
          if (request?.type === 'preview-error') {
            disposed = true
            port?.close()
            setError(String(request.message).slice(0, 500))
            return
          }
          if (request?.type === 'notegen:preview-status') {
            if (typeof request.text !== 'string' || request.text.length > 240 || ++requests > 4096) return
            const revision = ++statusRevision
            void guard().then(() => {
              if (!disposed && revision === statusRevision) setPreviewStatus({ owner: `${fingerprint}:${preview.id}\0${path}\0${locale}`, text: request.text })
            }).catch(() => { if (!disposed && revision === statusRevision) setPreviewStatus(null) })
            return
          }
          if (!request || !Number.isSafeInteger(request.id)) return
          if (inFlight >= 2 || ++requests > 4096) { port?.postMessage({ id: request.id, error: 'Preview request limit exceeded' }); return }
          inFlight++
          void (async () => {
            await guard()
            let result: Uint8Array
            if (request.method === 'readDocument') {
              if (!Number.isSafeInteger(request.length) || request.length < 1 || request.length > 1_048_576) throw new Error('Invalid read length')
              total += request.length
              if (total > 512 * 1024 * 1024) throw new Error('Preview read budget exceeded')
              result = await readPluginPreviewChunk(plugin.manifest.id, binding, fingerprint, path, request.offset, request.length)
            } else if (request.method === 'readAsset' && typeof request.path === 'string' && preview.assets?.includes(request.path)) {
              result = await readPluginResource(plugin, request.path)
              total += result.length
              if (total > 512 * 1024 * 1024) throw new Error('Preview read budget exceeded')
            } else throw new Error('Unsupported preview request')
            await guard()
            port?.postMessage({ id: request.id, result })
          })().catch(reason => { if (!disposed) port?.postMessage({ id: request.id, error: reason instanceof Error ? reason.message : String(reason || 'Preview request failed') }) }).finally(() => { inFlight-- })
        }
        frame.current.contentWindow.postMessage({ type: 'notegen:preview-init', protocol: 1, locale, name: path.split('/').pop(), sizeLimit: 256 * 1024 * 1024, capabilities: { statusBar: true } }, '*', [channel.port2])
      }
      const documentHtml = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; worker-src blob:; connect-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"></head><body><script nonce="${nonce}">${reportErrors}</script><script nonce="${nonce}">${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
      // Create the blob in the opaque outer frame: a blob created by the host
      // cannot be loaded from that frame. Blob documents inherit the creator's
      // CSP, so the outer policy must permit the same bundled resources. The
      // inner policy further restricts frame navigation to 'none'.
      const embeddedDocument = JSON.stringify(documentHtml).replace(/</g, '\\u003c')
      readyListener = event => {
        if (event.source === frame.current?.contentWindow && event.data?.type === 'notegen:preview-ready' && event.data.token === nonce) initialize()
      }
      window.addEventListener('message', readyListener)
      readyTimer = setTimeout(() => {
        if (!disposed && !initialized) setError('Preview container did not initialize. Close and reopen the file.')
      }, 15_000)
      setSource(`<!doctype html><html style="width:100%;height:100%;overflow:hidden"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; worker-src blob:; connect-src blob:; frame-src blob:; form-action 'none'; base-uri 'none'"></head><body style="margin:0;width:100%;height:100%;overflow:hidden"><iframe id="renderer" title="Document renderer" sandbox="allow-scripts" referrerpolicy="no-referrer" style="display:block;width:100%;height:100%;border:0"></iframe><script nonce="${nonce}">(() => { const renderer = document.getElementById('renderer'); const url = URL.createObjectURL(new Blob([${embeddedDocument}], {type:'text/html'})); let initialized = false; renderer.addEventListener('load', () => { if (renderer.getAttribute('src') === url) parent.postMessage({type:'notegen:preview-ready',token:'${nonce}'}, '*'); }); window.addEventListener('message', event => { if (initialized || event.source !== parent || event.data?.type !== 'notegen:preview-init' || event.ports.length !== 1) return; initialized = true; renderer.contentWindow.postMessage(event.data, '*', event.ports); }); window.addEventListener('pagehide', () => URL.revokeObjectURL(url), {once:true}); renderer.src = url; })();</script></body></html>`)
    })().catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason || 'Preview failed')) })
    return () => { disposed = true; port?.close(); clearTimeout(readyTimer); if (readyListener) window.removeEventListener('message', readyListener) }
    // Registration changes dispose pending IO and the isolated frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, identity, entries, locale])
  if (!selected) return <UnsupportedFile filePath={path} />
  if (error) return <div role="alert" className="flex min-h-0 flex-1 flex-col"><p>{error}</p><UnsupportedFile filePath={path} /></div>
  return <>
    <iframe key={`${path}:${identity}:${locale}`} ref={frame} title={resolveManifestText(selected.preview.name, getLoadedPluginMessages(selected.plugin.manifest.id, locale))} sandbox="allow-scripts" referrerPolicy="no-referrer" className="block size-full min-h-0 min-w-0 flex-1 border-0" srcDoc={source || undefined} />
    <MainStatusBarPortal active={isActive && Boolean(statusText)}>
      <span role="status" className="min-w-0 truncate px-2 text-xs tabular-nums" title={statusText}>{statusText}</span>
    </MainStatusBarPortal>
  </>
}
