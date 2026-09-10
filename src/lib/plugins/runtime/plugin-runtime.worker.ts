/// <reference lib="webworker" />

import variant from '@jitl/quickjs-singlefile-browser-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
} from 'quickjs-emscripten-core'
import {
  PLUGIN_API_VERSION,
  PLUGIN_ERROR_CODES as PUBLIC_PLUGIN_ERROR_CODES,
  type PluginErrorCode,
  type PluginManifestV1,
  type PluginJsonValue,
} from '@notegen/plugin-api'
import type {
  PluginHostToWorkerMessage,
  PluginRpcMethod,
  PluginRpcResult,
  PluginWorkerToHostMessage,
} from '@/lib/plugins/runtime/protocol'
import { PLUGIN_RPC_METHODS } from '@/lib/plugins/runtime/protocol'

const MEMORY_LIMIT_BYTES = 32 * 1_048_576
const STACK_LIMIT_BYTES = 512 * 1_024
const ENTRY_LIMIT_BYTES = 5 * 1_048_576
const EXECUTION_SLICE_MS = 75
const ACTIVATION_SLICE_MS = 1_000
const JOBS_PER_PUMP = 64
const MAX_CONSECUTIVE_JOB_PUMPS = 16
const MAX_PENDING_RPC = 64
const MAX_BRIDGE_PAYLOAD_BYTES = 2 * 1_048_576 + 128 * 1_024
const MAX_READY_PAYLOAD_BYTES = 16 * 1_024

const workerScope = self as DedicatedWorkerGlobalScope
let runtime: QuickJSRuntime | null = null
let context: QuickJSContext | null = null
const pendingUiEvents = new Map<string, Extract<PluginHostToWorkerMessage, { type: 'view-event' | 'dialog-closed' }>>()
let manifest: PluginManifestV1 | null = null
let deadline = 0
let executionInterrupted = false
let disposed = false
let consecutivePumps = 0
let pumpScheduled = false
let nextRequestId = 0
const pendingRpc = new Map<string, QuickJSDeferredPromise>()
const pendingCommandIds = new Set<string>()
const RPC_METHODS: ReadonlySet<string> = new Set(PLUGIN_RPC_METHODS)
const PLUGIN_ERROR_CODES = new Set<PluginErrorCode>(PUBLIC_PLUGIN_ERROR_CODES)

function post(message: PluginWorkerToHostMessage): void {
  workerScope.postMessage(message)
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500)
  if (typeof error === 'string') return error.slice(0, 500)
  try {
    return JSON.stringify(error).slice(0, 500)
  } catch {
    return 'Unknown plugin runtime error'
  }
}

function dumpString(vm: QuickJSContext, handle: QuickJSHandle | undefined): string {
  if (!handle) return ''
  const value: unknown = vm.dump(handle)
  return typeof value === 'string' ? value : String(value ?? '')
}

function newGuestError(vm: QuickJSContext, code: PluginErrorCode, message: string, details?: Readonly<Record<string, PluginJsonValue>>): QuickJSHandle {
  const error = vm.newError(message)
  const nameHandle = vm.newString('PluginError')
  const codeHandle = vm.newString(code)
  vm.setProp(error, 'name', nameHandle)
  vm.setProp(error, 'code', codeHandle)
  nameHandle.dispose()
  codeHandle.dispose()
  if (details !== undefined) {
    const detailsHandle = vm.newString(JSON.stringify(details))
    vm.setProp(error, 'detailsJson', detailsHandle)
    detailsHandle.dispose()
  }
  return error
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function rejectedGuestPromise(
  vm: QuickJSContext,
  code: PluginErrorCode,
  message: string,
): QuickJSHandle {
  const deferred = vm.newPromise()
  const promise = deferred.handle.dup()
  const error = newGuestError(vm, code, message)
  deferred.reject(error)
  error.dispose()
  deferred.dispose()
  return promise
}

function runtimeFailure(message: string, code: PluginErrorCode = 'RuntimeFailure'): void {
  if (disposed) return
  post({ type: 'runtime-error', code, message: message.slice(0, 500) })
}

function setDeadline(duration: number): void {
  executionInterrupted = false
  deadline = performance.now() + duration
}

function disposeRuntime(): void {
  pendingUiEvents.clear()
  if (disposed) return
  disposed = true
  for (const deferred of pendingRpc.values()) deferred.dispose()
  pendingRpc.clear()
  pendingCommandIds.clear()
  context?.dispose()
  context = null
  runtime?.dispose()
  runtime = null
}

function pumpJobs(): void {
  if (disposed || !runtime || pumpScheduled) return
  pumpScheduled = true
  queueMicrotask(() => {
    pumpScheduled = false
    const activeRuntime = runtime
    const vm = context
    if (disposed || !activeRuntime || !vm) return

    setDeadline(EXECUTION_SLICE_MS)
    const result = activeRuntime.executePendingJobs(JOBS_PER_PUMP)
    if (executionInterrupted) {
      result.dispose()
      runtimeFailure('Plugin exceeded its execution time limit', 'Timeout')
      disposeRuntime()
      return
    }
    if (result.error) {
      const message = safeMessage(vm.dump(result.error))
      result.dispose()
      runtimeFailure(message)
      disposeRuntime()
      return
    }
    const executed = result.value
    result.dispose()
    if (activeRuntime.hasPendingJob()) {
      consecutivePumps += 1
      if (consecutivePumps > MAX_CONSECUTIVE_JOB_PUMPS) {
        runtimeFailure('Plugin exceeded the pending job quota', 'QuotaExceeded')
        disposeRuntime()
        return
      }
      setTimeout(pumpJobs, executed >= JOBS_PER_PUMP ? 0 : 1)
    } else {
      consecutivePumps = 0
    }
  })
}

function setHostFunction(
  vm: QuickJSContext,
  name: string,
  callback: (...handles: QuickJSHandle[]) => QuickJSHandle | void,
): void {
  const handle = vm.newFunction(name, callback)
  vm.setProp(vm.global, name, handle)
  handle.dispose()
}

function installHostBridge(vm: QuickJSContext, readyToken: string): void {
  let logWindow = 0
  let logCount = 0
  setHostFunction(vm, '__notegenLog', (levelHandle, messageHandle) => {
    if (disposed) return
    const now = performance.now()
    if (now - logWindow >= 10_000) { logWindow = now; logCount = 0 }
    if (++logCount > 50) return
    const level = dumpString(vm, levelHandle)
    if (level !== 'info' && level !== 'warning' && level !== 'error') return
    post({ type: 'log', level, message: dumpString(vm, messageHandle).slice(0, 1_000) })
  })
  setHostFunction(vm, '__notegenRpc', (methodHandle, paramsHandle) => {
    if (pendingRpc.size >= MAX_PENDING_RPC) {
      return rejectedGuestPromise(vm, 'QuotaExceeded', 'Plugin exceeded the pending RPC quota')
    }

    const method = dumpString(vm, methodHandle)
    const paramsJson = dumpString(vm, paramsHandle)

    if (!RPC_METHODS.has(method)) {
      return rejectedGuestPromise(
        vm,
        'PermissionDenied',
        `Unknown plugin API method: ${method}`,
      )
    }

    if (byteLength(paramsJson) > MAX_BRIDGE_PAYLOAD_BYTES) {
      return rejectedGuestPromise(
        vm,
        'QuotaExceeded',
        'Plugin API request exceeded the bridge payload limit',
      )
    }

    try {
      if (paramsJson) JSON.parse(paramsJson)
    } catch {
      return rejectedGuestPromise(
        vm,
        'RuntimeFailure',
        'RPC parameters are not valid JSON',
      )
    }

    const requestId = `${Date.now().toString(36)}-${nextRequestId += 1}`
    const deferred = vm.newPromise()
    pendingRpc.set(requestId, deferred)
    post({
      type: 'rpc-request',
      requestId,
      method: method as PluginRpcMethod,
      paramsJson: paramsJson || undefined,
    })
    return deferred.handle
  })

  setHostFunction(vm, '__notegenReady', (tokenHandle, commandsHandle) => {
    if (dumpString(vm, tokenHandle) !== readyToken) return
    const raw = dumpString(vm, commandsHandle)
    if (byteLength(raw) > MAX_READY_PAYLOAD_BYTES) {
      runtimeFailure('Plugin command registration exceeded the bridge payload limit', 'QuotaExceeded')
      return
    }
    let commands: string[] = []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (
        Array.isArray(parsed)
        && parsed.length <= 100
        && parsed.every((item) => typeof item === 'string' && item.length <= 200)
      ) commands = parsed
    } catch {
      commands = []
    }
    post({ type: 'ready', commands })
  })

  setHostFunction(vm, '__notegenCommandResult', (
    requestIdHandle,
    okHandle,
    valueHandle,
    codeHandle,
    messageHandle,
    detailsHandle,
  ) => {
    const requestId = dumpString(vm, requestIdHandle)
    if (requestId.length > 128 || !pendingCommandIds.delete(requestId)) return
    const ok = Boolean(vm.dump(okHandle))
    if (!ok) {
      let details: Readonly<Record<string, PluginJsonValue>> | undefined
      const detailsJson = dumpString(vm, detailsHandle)
      if (detailsJson && byteLength(detailsJson) <= MAX_READY_PAYLOAD_BYTES) {
        try {
          const parsed: unknown = JSON.parse(detailsJson)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            details = parsed as Readonly<Record<string, PluginJsonValue>>
          }
        } catch { /* Error details are optional and must not hide the original error. */ }
      }
      post({
        type: 'command-result',
        requestId,
        ok: false,
        error: {
          code: PLUGIN_ERROR_CODES.has(dumpString(vm, codeHandle) as PluginErrorCode)
            ? dumpString(vm, codeHandle) as PluginErrorCode
            : 'RuntimeFailure',
          message: (dumpString(vm, messageHandle) || 'Plugin command failed').slice(0, 500),
          details,
        },
      })
      return
    }
    const valueJson = dumpString(vm, valueHandle)
    if (byteLength(valueJson) > MAX_BRIDGE_PAYLOAD_BYTES) {
      post({
        type: 'command-result',
        requestId,
        ok: false,
        error: {
          code: 'QuotaExceeded',
          message: 'Plugin command result exceeded the bridge payload limit',
        },
      })
      return
    }
    try {
      if (valueJson) JSON.parse(valueJson)
    } catch {
      post({
        type: 'command-result',
        requestId,
        ok: false,
        error: {
          code: 'RuntimeFailure',
          message: 'Plugin command returned invalid JSON',
        },
      })
      return
    }
    post({ type: 'command-result', requestId, ok: true, valueJson: valueJson || undefined })
  })

  setHostFunction(vm, '__notegenRuntimeError', (messageHandle, codeHandle) => {
    const rawCode = dumpString(vm, codeHandle)
    const code = PLUGIN_ERROR_CODES.has(rawCode as PluginErrorCode)
      ? rawCode as PluginErrorCode
      : 'RuntimeFailure'
    runtimeFailure(dumpString(vm, messageHandle), code)
  })

  const activationPromiseResult = vm.evalCode(
    `(() => {
      const promiseResolve = Promise.resolve.bind(Promise);
      const promiseThen = Function.call.bind(Promise.prototype.then);
      Object.defineProperty(globalThis, '__notegenAwaitActivation', {
        configurable: false,
        writable: false,
        value(value, onFulfilled, onRejected) {
          return promiseThen(promiseResolve(value), onFulfilled, onRejected);
        },
      });
    })();`,
    'plugin:activation-bridge.js',
  )
  if (activationPromiseResult.error) {
    const message = safeMessage(vm.dump(activationPromiseResult.error))
    activationPromiseResult.error.dispose()
    throw new Error(message)
  }
  activationPromiseResult.value.dispose()

  const lockedNames = [
    '__notegenLog',
    '__notegenRpc',
    '__notegenReady',
    '__notegenCommandResult',
    '__notegenRuntimeError',
    '__notegenAwaitActivation',
  ]
  const result = vm.evalCode(
    `for (const name of ${JSON.stringify(lockedNames)}) {
      Object.defineProperty(globalThis, name, { configurable: false, writable: false });
    }`,
    'plugin:host-bridge.js',
  )
  if (result.error) {
    const message = safeMessage(vm.dump(result.error))
    result.error.dispose()
    throw new Error(message)
  }
  result.value.dispose()
}

const BOOTSTRAP_SOURCE = String.raw`
import * as pluginModule from 'plugin:entry';

const readyToken = __NOTEGEN_READY_TOKEN__;
const hostRpc = globalThis.__notegenRpc;
const hostReady = globalThis.__notegenReady;
const hostCommandResult = globalThis.__notegenCommandResult;
const hostRuntimeError = globalThis.__notegenRuntimeError;
const metadata = globalThis.__notegenMetadata;
const messages = globalThis.__notegenMessages;
const settings = globalThis.__notegenSettings;
const declaredCommands = new Set(metadata.commands);
const declaredStatusItems = new Set(metadata.statusItems);
const commandHandlers = new Map();
const activeEditorListeners = new Set();
const contentListeners = new Set();
const noteListeners = new Set();
const workspaceListeners = new Set();
const viewListeners = new Set();
const dialogCloseListeners = new Set();
const settingsListeners = new Set();
const abortListeners = new Map();
let aborted = false;
let onabort = null;

const assertJsonValue = (value, ancestors = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new TypeError('Value must be finite JSON data');
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Value must be finite JSON data');
  }
  ancestors.add(value);
  try {
    const entries = Array.isArray(value) ? value : Object.values(value);
    for (const entry of entries) assertJsonValue(entry, ancestors);
  } finally {
    ancestors.delete(value);
  }
  return value;
};

const rpc = async (method, params) => {
  if (aborted) throw pluginError('Cancelled', 'The plugin has been stopped');
  try {
    const raw = await hostRpc(method, JSON.stringify(params ?? null));
    return raw ? JSON.parse(raw) : undefined;
  } catch (error) {
    if (typeof error?.detailsJson === 'string') {
      error.details = JSON.parse(error.detailsJson);
      delete error.detailsJson;
    }
    throw error;
  }
};

const disposable = (remove) => Object.freeze({ dispose: remove });
const pluginError = (code, message) => Object.assign(new Error(message), {
  name: 'PluginError',
  code,
});
const reportRuntimeError = (error) => hostRuntimeError(
  String(error?.message ?? error),
  typeof error?.code === 'string' ? error.code : 'RuntimeFailure',
);
const translate = (key, values) => {
  const template = messages[key] ?? key;
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name) =>
    values[name] === undefined ? match : String(values[name]));
};

const signal = Object.freeze({
  get aborted() { return aborted; },
  get reason() { return aborted ? pluginError('Cancelled', 'The plugin has been stopped') : undefined; },
  get onabort() { return onabort; },
  set onabort(listener) { onabort = typeof listener === 'function' ? listener : null; },
  addEventListener(type, listener, options) {
    if (type !== 'abort' || (typeof listener !== 'function' && typeof listener?.handleEvent !== 'function')) return;
    abortListeners.set(listener, Boolean(typeof options === 'object' && options?.once));
  },
  removeEventListener(type, listener) {
    if (type === 'abort') abortListeners.delete(listener);
  },
  dispatchEvent() { return true; },
  throwIfAborted() { if (aborted) throw pluginError('Cancelled', 'The plugin has been stopped'); },
});

const context = Object.freeze({
  plugin: Object.freeze(metadata.plugin),
  log: Object.freeze({
    info: message => globalThis.__notegenLog('info', String(message).slice(0, 1000)),
    warning: message => globalThis.__notegenLog('warning', String(message).slice(0, 1000)),
    error: message => globalThis.__notegenLog('error', String(message).slice(0, 1000)),
  }),
  signal,
  commands: Object.freeze({
    executeHost: (command) => rpc('commands.executeHost', { command }),
    handle(commandId, handler) {
      if (!declaredCommands.has(commandId)) throw pluginError('PermissionDenied', 'Command is not declared');
      if (typeof handler !== 'function') throw new TypeError('Command handler must be a function');
      if (commandHandlers.has(commandId)) throw pluginError('AlreadyRegistered', 'Command handler is already registered');
      commandHandlers.set(commandId, handler);
      return disposable(() => commandHandlers.delete(commandId));
    },
  }),
  workspace: Object.freeze({
    getCurrent: () => rpc('workspace.getCurrent'),
    onDidChange(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      workspaceListeners.add(listener);
      return disposable(() => workspaceListeners.delete(listener));
    },
  }),
  calendar: Object.freeze({ resolveDay: (options) => rpc('calendar.resolveDay', options) }),
  attachments: Object.freeze({
    read: (options) => rpc('attachments.read', options),
    create: (options) => rpc('attachments.create', options),
  }),
  notes: Object.freeze({
    read: (options) => rpc('notes.read', options),
    openOrCreate: (options) => rpc('notes.openOrCreate', options),
    list: (options) => rpc('notes.list', options),
    search: (options) => rpc('notes.search', options),
    write: (options) => rpc('notes.write', options),
    move: (options) => rpc('notes.move', options),
    delete: (options) => rpc('notes.delete', options),
    onDidChange(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      noteListeners.add(listener);
      return disposable(() => noteListeners.delete(listener));
    },
  }),
  editor: Object.freeze({
    getActiveEditor: () => rpc('editor.getActiveEditor'),
    getSelection: () => rpc('editor.getSelection'),
    getTextSnapshot: (options) => rpc('editor.getTextSnapshot', options),
    applyEdit: (options) => rpc('editor.applyEdit', options),
    applyEdits: (options) => rpc('editor.applyEdits', options),
    setSelection: (options) => rpc('editor.setSelection', options),
    onDidChangeActiveEditor(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      activeEditorListeners.add(listener);
      return disposable(() => activeEditorListeners.delete(listener));
    },
    onDidChangeContent(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      contentListeners.add(listener);
      return disposable(() => contentListeners.delete(listener));
    },
  }),
  storage: Object.freeze({
    device: Object.freeze({
      get: (key) => rpc('storage.get', { scope: 'device', key }),
      set: (key, value) => rpc('storage.set', { scope: 'device', key, value: assertJsonValue(value) }),
      delete: (key) => rpc('storage.delete', { scope: 'device', key }),
    }),
    workspace: Object.freeze({
      get: (key) => rpc('storage.get', { scope: 'workspace', key }),
      set: (key, value) => rpc('storage.set', { scope: 'workspace', key, value: assertJsonValue(value) }),
      delete: (key) => rpc('storage.delete', { scope: 'workspace', key }),
    }),
  }),
  ui: Object.freeze({
    showNotice: (message) => rpc('ui.showNotice', { message }),
    statusBar: Object.freeze({
      update(id, state) {
        if (!declaredStatusItems.has(id)) throw pluginError('PermissionDenied', 'Status item is not declared');
        return rpc('ui.statusBar.update', { id, state });
      },
    }),
    views: Object.freeze({
      update: (id, content) => rpc('ui.views.update', { id, content }),
      open: (id) => rpc('ui.views.open', { id }),
      close: (id) => rpc('ui.views.close', { id }),
      focus: (id) => rpc('ui.views.focus', { id }),
      getState: (id) => rpc('ui.views.getState', { id }),
      onDidChange(listener) {
        if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
        viewListeners.add(listener);
        return disposable(() => viewListeners.delete(listener));
      },
    }),
    openDialog: (options) => rpc('ui.openDialog', options),
    updateDialog: (id, options) => rpc('ui.updateDialog', { id, options }),
    closeDialog: (id) => rpc('ui.closeDialog', { id }),
    onDidCloseDialog(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      dialogCloseListeners.add(listener);
      return disposable(() => dialogCloseListeners.delete(listener));
    },
  }),
  network: Object.freeze({ fetch: (request) => rpc('network.fetch', request) }),
  i18n: Object.freeze({ t: translate }),
  settings: Object.freeze({
    get: (key) => settings[key],
    onDidChange(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      settingsListeners.add(listener);
      return disposable(() => settingsListeners.delete(listener));
    },
  }),
});

globalThis.__notegenExecuteCommand = async (requestId, commandId, argumentJson) => {
  const handler = commandHandlers.get(commandId);
  if (!handler) {
    hostCommandResult(requestId, false, '', 'RuntimeFailure', 'Command handler is not registered');
    return;
  }
  try {
    const argument = argumentJson ? JSON.parse(argumentJson) : undefined;
    const result = await handler(argument);
    const resultJson = result === undefined ? '' : JSON.stringify(assertJsonValue(result));
    hostCommandResult(requestId, true, resultJson, '', '');
  } catch (error) {
    let detailsJson = '';
    try {
      if (error?.details !== undefined) detailsJson = JSON.stringify(assertJsonValue(error.details));
    } catch { /* Preserve the original error even when custom details are invalid. */ }
    hostCommandResult(
      requestId,
      false,
      '',
      typeof error?.code === 'string' ? error.code : 'RuntimeFailure',
      String(error?.message ?? error),
      detailsJson,
    );
  }
};

globalThis.__notegenDispatchEditorEvent = (eventName, eventJson) => {
  const event = JSON.parse(eventJson);
  const listeners = eventName === 'active-editor-changed' ? activeEditorListeners : contentListeners;
  for (const listener of listeners) {
    Promise.resolve(listener(event)).catch(reportRuntimeError);
  }
};

globalThis.__notegenDispatchNoteEvent = (eventJson) => {
  const event = JSON.parse(eventJson);
  for (const listener of noteListeners) Promise.resolve(listener(event)).catch(reportRuntimeError);
};

globalThis.__notegenDispatchWorkspaceEvent = (eventJson) => {
  const event = JSON.parse(eventJson);
  for (const listener of workspaceListeners) Promise.resolve(listener(event)).catch(reportRuntimeError);
};

globalThis.__notegenDispatchViewEvent = (eventJson) => {
  const event = JSON.parse(eventJson);
  for (const listener of viewListeners) Promise.resolve().then(() => listener(event)).catch(reportRuntimeError);
};
globalThis.__notegenDispatchDialogClose = (eventJson) => {
  const event = JSON.parse(eventJson);
  for (const listener of dialogCloseListeners) Promise.resolve().then(() => listener(event)).catch(reportRuntimeError);
};

globalThis.__notegenDispatchSetting = (key, valueJson) => {
  const value = JSON.parse(valueJson);
  settings[key] = value;
  for (const listener of settingsListeners) {
    Promise.resolve(listener(key, value)).catch(reportRuntimeError);
  }
};

globalThis.__notegenDeactivate = async () => {
  if (aborted) return;
  aborted = true;
  const event = Object.freeze({
    type: 'abort',
    target: signal,
    currentTarget: signal,
    defaultPrevented: false,
  });
  if (onabort) {
    try { onabort.call(signal, event); }
    catch (error) { reportRuntimeError(error); }
  }
  for (const [listener, once] of [...abortListeners]) {
    try {
      if (typeof listener === 'function') listener.call(signal, event);
      else listener.handleEvent(event);
    } catch (error) {
      reportRuntimeError(error);
    }
    if (once) abortListeners.delete(listener);
  }
  if (typeof pluginModule.deactivate === 'function') await pluginModule.deactivate();
};

if (typeof pluginModule.activate !== 'function') {
  throw new TypeError('The plugin entry must export an activate(context) function');
}

globalThis.__notegenAwaitActivation(pluginModule.activate(context),
  () => hostReady(readyToken, JSON.stringify([...commandHandlers.keys()])),
  reportRuntimeError,
);
`

function createReadyToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function evaluate(source: string, filename: string, duration = EXECUTION_SLICE_MS): void {
  const vm = context
  if (!vm) return
  setDeadline(duration)
  const result = vm.evalCode(source, filename, { type: filename.endsWith('.mjs') ? 'module' : 'global' })
  // QuickJS can turn an interrupt inside an async function into a rejected
  // promise without returning an eval error. Treat the interrupt itself as
  // terminal instead of leaving the command pending until the host watchdog.
  if (executionInterrupted) {
    if (result.error) result.error.dispose()
    else result.value.dispose()
    runtimeFailure('Plugin exceeded its execution time limit', 'Timeout')
    disposeRuntime()
    return
  }
  if (result.error) {
    const message = safeMessage(vm.dump(result.error))
    result.error.dispose()
    throw new Error(message)
  }
  result.value.dispose()
  pumpJobs()
}

async function initialize(message: Extract<PluginHostToWorkerMessage, { type: 'initialize' }>): Promise<void> {
  if (context || runtime) throw new Error('Plugin runtime is already initialized')
  if (new TextEncoder().encode(message.entrySource).byteLength > ENTRY_LIMIT_BYTES) {
    throw new Error('Plugin entry exceeds the 5 MiB runtime limit')
  }
  manifest = message.manifest

  const quickJsModule = await newQuickJSWASMModuleFromVariant(variant)
  if (disposed) return
  runtime = quickJsModule.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
  runtime.setMaxStackSize(STACK_LIMIT_BYTES)
  runtime.setInterruptHandler(() => {
    if (deadline > 0 && performance.now() > deadline) executionInterrupted = true
    return executionInterrupted
  })
  runtime.setModuleLoader((moduleName) => {
    if (moduleName === 'plugin:entry') return message.entrySource
    return { error: new Error(`Module imports are not available: ${moduleName}`) }
  })
  context = runtime.newContext()
  const readyToken = createReadyToken()
  installHostBridge(context, readyToken)

  const metadata = {
    plugin: {
      id: message.manifest.id,
      version: message.manifest.version,
      apiVersion: PLUGIN_API_VERSION,
    },
    commands: (message.manifest.contributes.commands ?? []).map((command) => command.id),
    statusItems: (message.manifest.contributes.statusBar ?? []).map((item) => item.id),
  }
  evaluate(
    `globalThis.__notegenMetadata = Object.freeze(${JSON.stringify(metadata)});\n`
      + `globalThis.__notegenMessages = Object.freeze(${JSON.stringify(message.messages)});\n`
      + `globalThis.__notegenSettings = ${JSON.stringify(message.settings)};`,
    'plugin:metadata.js',
  )
  evaluate(
    BOOTSTRAP_SOURCE.replace('__NOTEGEN_READY_TOKEN__', JSON.stringify(readyToken)),
    'plugin:bootstrap.mjs',
    ACTIVATION_SLICE_MS,
  )
  const pending = [...pendingUiEvents.values()]
  pendingUiEvents.clear()
  for (const event of pending) dispatchMessage(event)
}

function resolveRpc(message: PluginRpcResult): void {
  const vm = context
  const deferred = pendingRpc.get(message.requestId)
  if (!vm || !deferred) return
  pendingRpc.delete(message.requestId)

  if (message.ok) {
    const handle = vm.newString(message.valueJson ?? '')
    deferred.resolve(handle)
    handle.dispose()
  } else {
    const handle = newGuestError(vm, message.error.code, message.error.message, message.error.details)
    deferred.reject(handle)
    handle.dispose()
  }
  deferred.dispose()
  pumpJobs()
}

function dispatchMessage(message: PluginHostToWorkerMessage): void {
  if (!context || !manifest) return
  switch (message.type) {
    case 'execute-command':
      if (message.requestId.length > 128 || pendingCommandIds.size >= 16) {
        throw new Error('Plugin exceeded the pending command quota')
      }
      pendingCommandIds.add(message.requestId)
      evaluate(
        `globalThis.__notegenExecuteCommand(${JSON.stringify(message.requestId)}, ${JSON.stringify(message.commandId)}, ${JSON.stringify(message.argument === undefined ? '' : JSON.stringify(message.argument))});`,
        'plugin:command.js',
      )
      break
    case 'editor-event':
      evaluate(
        `globalThis.__notegenDispatchEditorEvent(${JSON.stringify(message.event)}, ${JSON.stringify(JSON.stringify(message.value))});`,
        'plugin:event.js',
      )
      break
    case 'note-event':
      evaluate(
        `globalThis.__notegenDispatchNoteEvent(${JSON.stringify(JSON.stringify(message.value))});`,
        'plugin:note-event.js',
      )
      break
    case 'workspace-event':
      evaluate(
        `globalThis.__notegenDispatchWorkspaceEvent(${JSON.stringify(JSON.stringify(message.value))});`,
        'plugin:workspace-event.js',
      )
      break
    case 'dialog-closed':
      evaluate(`globalThis.__notegenDispatchDialogClose(${JSON.stringify(JSON.stringify(message.value))});`, 'plugin:dialog-closed.js');
      break
    case 'view-event':
      evaluate(
        `globalThis.__notegenDispatchViewEvent(${JSON.stringify(JSON.stringify(message.value))});`,
        'plugin:view-event.js',
      )
      break
    case 'settings-changed':
      evaluate(
        `globalThis.__notegenDispatchSetting(${JSON.stringify(message.key)}, ${JSON.stringify(JSON.stringify(message.value))});`,
        'plugin:settings.js',
      )
      break
    case 'deactivate':
      evaluate('globalThis.__notegenDeactivate();', 'plugin:deactivate.js')
      setTimeout(disposeRuntime, 100)
      break
    case 'rpc-result':
      resolveRpc(message)
      break
    case 'initialize':
      break
  }
}

workerScope.onmessage = (event: MessageEvent<PluginHostToWorkerMessage>) => {
  if (disposed) return
  const message = event.data
  if (!context && (message.type === 'view-event' || message.type === 'dialog-closed')) {
    const key = `${message.type}:${message.value.id}`
    if (!pendingUiEvents.has(key) && pendingUiEvents.size >= 128) {
      const first = pendingUiEvents.keys().next().value
      if (first !== undefined) pendingUiEvents.delete(first)
    }
    pendingUiEvents.set(key, message)
    return
  }
  if (message.type === 'initialize') {
    void initialize(message).catch((error) => {
      runtimeFailure(safeMessage(error))
      disposeRuntime()
    })
    return
  }
  try {
    dispatchMessage(message)
  } catch (error) {
    runtimeFailure(safeMessage(error))
    disposeRuntime()
  }
}
