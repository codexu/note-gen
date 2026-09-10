import { create } from 'zustand'
import type { PluginFormBlock, PluginFormField, PluginFormValue } from '@notegen/plugin-api'

interface FormSession {
  scope: string
  formId: string
  generation: string
  resetKey?: string
  types: Record<string, PluginFormField['type']>
  values: Record<string, PluginFormValue>
  errors: Record<string, string>
  message: string
  failure: string
  busy: boolean
  changeRevision: number
  notifiedRevision: number
  changedField?: string
}

export const pluginFormKey = (scope: string, id: string) => JSON.stringify([scope, id])
export const usePluginFormStore = create<{ sessions: Record<string, FormSession> }>(() => ({ sessions: {} }))

export function reconcilePluginForm(scope: string, block: PluginFormBlock): FormSession {
  const key = pluginFormKey(scope, block.id)
  const previous = usePluginFormStore.getState().sessions[key]
  const reset = !previous || previous.resetKey !== block.resetKey
  const types = Object.fromEntries(block.fields.map(field => [field.id, field.type]))
  const values = Object.fromEntries(block.fields.map(field => [field.id,
    !reset && previous.types[field.id] === field.type && Object.hasOwn(previous.values, field.id)
      ? previous.values[field.id] : field.value ?? (field.type === 'checkbox' ? false : ''),
  ]))
  const session: FormSession = {
    scope, formId: block.id, generation: reset ? crypto.randomUUID() : previous.generation,
    resetKey: block.resetKey, types, values,
    errors: reset ? {} : Object.fromEntries(Object.entries(previous.errors).filter(([id]) => types[id] === previous.types[id])),
    message: reset ? '' : previous.message, failure: reset ? '' : previous.failure, busy: reset ? false : previous.busy,
    changeRevision: reset ? 0 : previous.changeRevision,
    notifiedRevision: reset ? 0 : previous.notifiedRevision,
    changedField: reset ? undefined : previous.changedField,
  }
  if (previous && JSON.stringify(previous) === JSON.stringify(session)) return previous
  usePluginFormStore.setState(state => ({ sessions: { ...state.sessions, [key]: session } }))
  return session
}

export function patchPluginForm(key: string, generation: string, patch: Partial<Pick<FormSession, 'values' | 'errors' | 'message' | 'failure' | 'busy' | 'changeRevision' | 'notifiedRevision' | 'changedField'>>): void {
  usePluginFormStore.setState(state => {
    const current = state.sessions[key]
    if (!current || current.generation !== generation) return state
    return { sessions: { ...state.sessions, [key]: { ...current, ...patch } } }
  })
}

export function clearPluginForms(scope: string, keepIds?: ReadonlySet<string>): void {
  usePluginFormStore.setState(state => ({ sessions: Object.fromEntries(Object.entries(state.sessions).filter(([, session]) => (
    session.scope !== scope || (keepIds?.has(session.formId) ?? false)
  ))) }))
}

export function clearAllPluginForms(pluginId: string): void {
  usePluginFormStore.setState(state => ({ sessions: Object.fromEntries(Object.entries(state.sessions).filter(([, session]) => !session.scope.startsWith(`${pluginId}:`))) }))
}
