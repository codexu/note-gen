import type {
  EditorActiveChangeEvent,
  EditorContentChangeEvent,
  NoteChangeEvent,
  WorkspaceChangeEvent,
  PluginCommandArgument,
  PluginErrorCode,
  PluginJsonValue,
  PluginManifestV1,
  PluginSettingValue,
  PluginViewState,
  PluginDialogCloseEvent,
} from '@notegen/plugin-api'

/**
 * The complete worker-to-host RPC surface. Keep this as the single runtime
 * registry so the protocol type and the QuickJS bridge cannot drift apart.
 */
export const PLUGIN_RPC_METHODS = [
  'ui.prompt', 'ai.generate', 'ai.cancel',
  'records.list', 'records.read', 'records.tags', 'records.create', 'records.update', 'chat.setDraft',
  'commands.executeHost',
  'ui.updateDialog',
  'workspace.getCurrent',
  'calendar.resolveDay',
  'notes.read',
  'fileIcons.setRules',
  'fileIcons.clear',
  'attachments.read',
  'attachments.create',
  'notes.openOrCreate',
  'notes.list',
  'notes.search',
  'notes.prepareForWrite',
  'notes.write',
  'notes.move',
  'notes.delete',
  'editor.getActiveEditor',
  'editor.getSelection',
  'editor.getTextSnapshot',
  'editor.applyEdit',
  'editor.applyEdits',
  'editor.setSelection',
  'storage.get',
  'storage.set',
  'storage.delete',
  'ui.showNotice',
  'ui.statusBar.update',
  'ui.views.update',
  'ui.views.open',
  'ui.views.close',
  'ui.views.focus',
  'ui.views.getState',
  'ui.openDialog',
  'ui.closeDialog',
  'network.fetch',
] as const

export type PluginRpcMethod = typeof PLUGIN_RPC_METHODS[number]

export interface PluginRpcRequest {
  type: 'rpc-request'
  requestId: string
  method: PluginRpcMethod
  paramsJson?: string
}

export interface PluginRpcSuccess {
  type: 'rpc-result'
  requestId: string
  ok: true
  valueJson?: string
}

export interface PluginRpcFailure {
  type: 'rpc-result'
  requestId: string
  ok: false
  error: {
    code: PluginErrorCode
    message: string
    details?: Readonly<Record<string, PluginJsonValue>>
  }
}

export type PluginRpcResult = PluginRpcSuccess | PluginRpcFailure

export type PluginHostToWorkerMessage =
  | {
      type: 'initialize'
      surface?: 'main' | 'editor-window'
      manifest: PluginManifestV1
      entrySource: string
      locale: string
      messages: Record<string, string>
      settings: Record<string, PluginSettingValue>
    }
  | {
      type: 'execute-command'
      requestId: string
      commandId: string
      argument?: PluginCommandArgument
    }
  | {
      type: 'editor-event'
      event: 'active-editor-changed' | 'content-changed'
      value: EditorActiveChangeEvent | EditorContentChangeEvent
    }
  | { type: 'ai-event'; value: { requestId: string; text: string } }
  | { type: 'record-event' }
  | { type: 'note-event'; value: NoteChangeEvent }
  | { type: 'workspace-event'; value: WorkspaceChangeEvent }
  | { type: 'view-event'; value: PluginViewState }
  | { type: 'dialog-closed'; value: PluginDialogCloseEvent }
  | {
      type: 'settings-changed'
      key: string
      value: PluginSettingValue
    }
  | { type: 'deactivate' }
  | PluginRpcResult

export type PluginWorkerToHostMessage =
  | { type: 'log'; level: 'info' | 'warning' | 'error'; message: string }
  | { type: 'ready'; commands: string[] }
  | {
      type: 'runtime-error'
      code: PluginErrorCode
      message: string
    }
  | {
      type: 'command-result'
      requestId: string
      ok: true
      valueJson?: string
    }
  | {
      type: 'command-result'
      requestId: string
      ok: false
      error: { code: PluginErrorCode; message: string; details?: Readonly<Record<string, PluginJsonValue>> }
    }
  | PluginRpcRequest
