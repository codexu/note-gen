import { create } from 'zustand'
import { usePluginResources } from './resources'
import { readPluginResource } from './backend'
import { assertPluginExecutionCurrent } from './broker'
import { getPluginManifestFingerprint, type InstalledPlugin } from './internal-types'
import { usePluginStore } from '@/stores/plugins'
import { CODE_BLOCK_LIMITS, getCodeBlockRenderers, type CodeBlockRendererResource, type CodeBlockRenderRequest } from './code-block-contract'
import { normalizeCodeBlockOutput, type CodeBlockImage } from './code-block-output'

export interface CodeBlockRendererProvider { key: string; plugin: InstalledPlugin; renderer: CodeBlockRendererResource }
export function codeBlockRendererProviders(language: string): CodeBlockRendererProvider[] {
  const normalized = language.trim().toLowerCase()
  return usePluginResources.getState().entries.flatMap(({ plugin, resources }) =>
    getCodeBlockRenderers(resources).filter(renderer => renderer.languages.includes(normalized))
      .map(renderer => ({ key: `${plugin.manifest.id}:${renderer.id}`, plugin, renderer })))
}

const PREFERENCE_KEY = 'notegen:code-block-renderers'
export const useCodeBlockRendererPreferences = create<{ values: Record<string, string> }>(() => ({ values: {} }))
function loadPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCE_KEY) ?? '{}'
    if (raw.length > 64 * 1024) return
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      useCodeBlockRendererPreferences.setState({ values: Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key.length < 300 && typeof value === 'string' && value.length < 340)) })
    }
  } catch { /* Device storage may be unavailable; in-memory preferences still work. */ }
}
let listening = false
export function listenCodeBlockRendererPreferences() {
  if (listening) return
  listening = true
  loadPreferences()
  window.addEventListener('storage', event => { if (event.key === PREFERENCE_KEY || event.key === null) loadPreferences() })
}
export function rendererPreferenceKey(workspace: string, language: string) { return JSON.stringify([workspace, language.trim().toLowerCase()]) }
export function selectCodeBlockRenderer(workspace: string, language: string, provider: string) {
  loadPreferences()
  const values = { ...useCodeBlockRendererPreferences.getState().values, [rendererPreferenceKey(workspace, language)]: provider }
  // Retain the most recent 128 workspace/language decisions.
  const bounded = Object.fromEntries(Object.entries(values).slice(-128))
  useCodeBlockRendererPreferences.setState({ values: bounded })
  try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(bounded)) } catch { /* In-memory fallback. */ }
}

interface RenderJob {
  request: CodeBlockRenderRequest
  signal: AbortSignal
  resolve(value: CodeBlockImage): void
  reject(reason: Error): void
}
const services = new Map<string, RendererService>()
const errorMessage = (error: unknown) => error instanceof Error ? error : new Error(String(error))
const cancelled = () => new DOMException('Rendering cancelled', 'AbortError')

class RendererService {
  private frame: HTMLIFrameElement | null = null
  private port: MessagePort | null = null
  private disposed = false
  private ready: Promise<void> | null = null
  private rejectReady: ((reason: Error) => void) | null = null
  private readyTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private readyListener: ((event: MessageEvent) => void) | null = null
  private busy = false
  private queue: RenderJob[] = []
  private current: { requestId: string; resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> } | null = null
  private cache = new Map<string, CodeBlockImage>()
  private cacheBytes = 0
  private reads = 0
  private readBytes = 0
  private readsInFlight = 0
  private leases = 0
  readonly fingerprint: string
  readonly binding: { workspaceId: string; workspaceKey: string }
  constructor(readonly key: string, readonly provider: CodeBlockRendererProvider) {
    this.fingerprint = getPluginManifestFingerprint(provider.plugin)
    const store = usePluginStore.getState()
    this.binding = { workspaceId: store.currentWorkspaceId ?? '', workspaceKey: store.currentWorkspaceKey ?? '' }
  }
  retain() { clearTimeout(this.idleTimer); this.leases++ }
  release() {
    if (--this.leases <= 0) this.idleTimer = setTimeout(() => this.dispose(cancelled()), 30_000)
  }
  private async guard() {
    if (this.disposed) throw cancelled()
    try {
      await assertPluginExecutionCurrent(this.provider.plugin.manifest.id, this.binding)
      const plugin = usePluginStore.getState().installed.find(plugin => plugin.manifest.id === this.provider.plugin.manifest.id)
      if (this.disposed || !plugin || getPluginManifestFingerprint(plugin) !== this.fingerprint) throw cancelled()
    } catch (reason) {
      this.dispose(errorMessage(reason))
      throw reason
    }
  }
  private initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(cancelled())
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      this.rejectReady = reject
      this.readyTimer = setTimeout(() => this.dispose(new Error('Renderer initialization timed out')), CODE_BLOCK_LIMITS.timeoutMs)
      void (async () => {
        await this.guard()
        const bytes = await readPluginResource(this.provider.plugin, this.provider.renderer.script)
        await this.guard()
        const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        const token = crypto.randomUUID().replaceAll('-', '')
        const policy = `default-src 'none'; script-src 'nonce-${token}' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src blob:; worker-src blob:; form-action 'none'; base-uri 'none'`
        // The blob document and its workers inherit the opaque frame's CSP.
        // Only the trusted outer shell can navigate a frame, and only to a blob.
        const report = `window.addEventListener('error',()=>parent.postMessage({type:'renderer.error',token:'${token}'},'*'));window.addEventListener('unhandledrejection',()=>parent.postMessage({type:'renderer.error',token:'${token}'},'*'));`
        const inner = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}; frame-src 'none'"><meta name="referrer" content="no-referrer"></head><body><script nonce="${token}">${report}</script><script nonce="${token}">${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
        const embedded = JSON.stringify(inner).replace(/</g, '\\u003c')
        const frame = document.createElement('iframe')
        this.frame = frame
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;visibility:hidden;pointer-events:none;border:0'
        frame.tabIndex = -1
        frame.setAttribute('aria-hidden', 'true')
        frame.title = 'Plugin code block rendering service'
        frame.setAttribute('sandbox', 'allow-scripts')
        frame.referrerPolicy = 'no-referrer'
        this.readyListener = event => {
          if (this.disposed || event.source !== frame.contentWindow || event.data?.token !== token) return
          if (event.data.type === 'renderer.error') { this.dispose(new Error('Renderer failed to initialize')); return }
          if (event.data.type !== 'renderer.loaded' || this.port) return
          const channel = new MessageChannel()
          this.port = channel.port1
          this.port.onmessage = message => {
            if (this.disposed) return
            const data = message.data
            if (data?.type === 'renderer.ready' && data.token === token) {
              clearTimeout(this.readyTimer)
              this.rejectReady = null
              resolve()
            } else if (data?.type === 'renderer.result' && this.current && data.requestId === this.current.requestId) {
              if (typeof data.error === 'string') this.current.reject(new Error(data.error.slice(0, 500)))
              else this.current.resolve(data.result)
            } else if (data?.type === 'renderer.readAsset') void this.readAsset(data)
          }
          frame.contentWindow?.postMessage({ type: 'notegen:code-block-renderer-init', protocol: 1, token }, '*', [channel.port2])
        }
        window.addEventListener('message', this.readyListener)
        frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}; frame-src blob:"></head><body><iframe id="renderer" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script nonce="${token}">(() => {const frame=document.getElementById('renderer');const url=URL.createObjectURL(new Blob([${embedded}],{type:'text/html'}));let initialized=false;frame.addEventListener('load',()=>{if(frame.getAttribute('src')===url)parent.postMessage({type:'renderer.loaded',token:'${token}'},'*')});window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.type==='renderer.error'&&event.data.token==='${token}')parent.postMessage(event.data,'*');if(initialized||event.source!==parent||event.data?.type!=='notegen:code-block-renderer-init'||event.data.token!=='${token}'||event.ports.length!==1)return;initialized=true;frame.contentWindow.postMessage(event.data,'*',event.ports)});window.addEventListener('pagehide',()=>URL.revokeObjectURL(url),{once:true});frame.src=url})()</script></body></html>`
        document.body.appendChild(frame)
      })().catch(reason => this.dispose(errorMessage(reason)))
    })
    return this.ready
  }
  private async readAsset(data: { id?: unknown; path?: unknown }) {
    if (!Number.isSafeInteger(data.id) || typeof data.id !== 'number') return
    if (this.readsInFlight >= 2 || ++this.reads > 256) { this.port?.postMessage({ type: 'host.asset', id: data.id, error: 'Asset request limit exceeded' }); return }
    this.readsInFlight++
    try {
      await this.guard()
      if (typeof data.path !== 'string' || !this.provider.renderer.assets?.includes(data.path)) throw new Error('Asset is not declared by this renderer')
      const result = await readPluginResource(this.provider.plugin, data.path)
      this.readBytes += result.length
      if (this.readBytes > 32 * 1024 * 1024) throw new Error('Asset read budget exceeded')
      await this.guard()
      this.port?.postMessage({ type: 'host.asset', id: data.id, result })
    } catch (reason) {
      if (!this.disposed) this.port?.postMessage({ type: 'host.asset', id: data.id, error: errorMessage(reason).message })
    } finally { this.readsInFlight-- }
  }
  render(request: CodeBlockRenderRequest, signal: AbortSignal): Promise<CodeBlockImage> {
    if (this.disposed || signal.aborted) return Promise.reject(cancelled())
    if (new TextEncoder().encode(request.source).length > CODE_BLOCK_LIMITS.sourceBytes) return Promise.reject(new Error('Code block exceeds 128 KiB'))
    if (this.queue.length >= 32) return Promise.reject(new Error('Renderer queue is full; retry when other diagrams finish'))
    return new Promise((resolve, reject) => {
      const job: RenderJob = { request, signal, resolve, reject }
      const onAbort = () => {
        this.queue = this.queue.filter(item => item !== job)
        job.reject(cancelled())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      job.resolve = value => { signal.removeEventListener('abort', onAbort); resolve(value) }
      job.reject = reason => { signal.removeEventListener('abort', onAbort); reject(reason) }
      this.queue.push(job)
      void this.drain()
    })
  }
  private async drain() {
    if (this.busy || this.disposed) return
    this.busy = true
    try {
      while (this.queue.length && !this.disposed) {
        const job = this.queue.shift()!
        if (job.signal.aborted) { job.reject(cancelled()); continue }
        try {
          await this.guard()
          const cacheKey = JSON.stringify([job.request.language, job.request.source, job.request.theme, job.request.locale])
          const cached = this.cache.get(cacheKey)
          if (cached) { job.resolve(cached); continue }
          await this.initialize()
          await this.guard()
          if (job.signal.aborted) { job.reject(cancelled()); continue }
          const raw = await new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => this.dispose(new Error('Rendering timed out')), CODE_BLOCK_LIMITS.timeoutMs)
            this.current = { requestId: job.request.requestId, resolve, reject, timer }
            this.port?.postMessage({ type: 'host.render', request: job.request })
          })
          await this.guard()
          if (job.signal.aborted) { job.reject(cancelled()); continue }
          const image = normalizeCodeBlockOutput(raw)
          this.cache.set(cacheKey, image)
          this.cacheBytes += image.bytes
          while (this.cache.size > 32 || this.cacheBytes > 8 * 1024 * 1024) {
            const first = this.cache.keys().next().value
            if (first === undefined) break
            this.cacheBytes -= this.cache.get(first)!.bytes
            this.cache.delete(first)
          }
          job.resolve(image)
        } catch (reason) { job.reject(errorMessage(reason)) }
        finally { clearTimeout(this.current?.timer); this.current = null }
      }
    } finally { this.busy = false }
  }
  dispose(reason: Error) {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.current?.timer)
    clearTimeout(this.readyTimer)
    clearTimeout(this.idleTimer)
    this.rejectReady?.(reason)
    this.current?.reject(reason)
    this.queue.splice(0).forEach(job => job.reject(reason))
    this.port?.close()
    this.frame?.remove()
    if (this.readyListener) window.removeEventListener('message', this.readyListener)
    this.cache.clear()
    if (services.get(this.key) === this) services.delete(this.key)
  }
}

function evictServices() {
  const state = usePluginStore.getState()
  for (const service of services.values()) {
    const present = usePluginResources.getState().entries.some(entry => getPluginManifestFingerprint(entry.plugin) === service.fingerprint)
    if (!present || service.binding.workspaceId !== (state.currentWorkspaceId ?? '') || service.binding.workspaceKey !== (state.currentWorkspaceKey ?? '') || !state.isEnabled(service.provider.plugin.manifest.id)) service.dispose(cancelled())
  }
}
usePluginResources.subscribe(evictServices)
usePluginStore.subscribe(evictServices)

/** Acquire one shared engine per provider/window/workspace, released by the caller. */
export function acquireCodeBlockRenderer(provider: CodeBlockRendererProvider) {
  const store = usePluginStore.getState()
  const key = JSON.stringify([getPluginManifestFingerprint(provider.plugin), provider.renderer.id, store.currentWorkspaceId, store.currentWorkspaceKey])
  let service = services.get(key)
  if (!service) { service = new RendererService(key, provider); services.set(key, service) }
  const instance = service
  instance.retain()
  return { render: (request: CodeBlockRenderRequest, signal: AbortSignal) => instance.render(request, signal), release: () => instance.release() }
}
