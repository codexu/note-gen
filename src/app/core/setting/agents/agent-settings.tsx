'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { createAgentSettings, listAgentSettings, updateAgentSettings } from '@/db/agents'
import { useUiV3 } from '@/lib/fork-ui'
import {
  AGENT_ROLES,
  AGENT_TOOL_NAMES,
  ROLE_TOOLS,
  isAgentRole,
  type AgentSettings as SavedAgent,
  type AgentSettingsInput,
} from '@/lib/agents/settings'
import { Button } from '@/components/ui/button'
import { SettingSection } from '../components/setting-base'

const field = 'w-full rounded-md border border-line bg-bg px-3 py-2 text-ink'

interface EditorState {
  id?: string
  values: AgentSettingsInput
}

export function AgentSettings() {
  const v3 = useUiV3()
  return v3 ? <AgentSettingsPanel /> : null
}

function AgentSettingsPanel() {
  const t = useTranslations('agents')
  const [agents, setAgents] = useState<SavedAgent[] | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState<'loadError' | 'saveError' | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void listAgentSettings().then(agents => {
      if (active) setAgents(agents)
    }).catch(err => {
      console.error('[agents] settings load failed', err)
      if (active) setError('loadError')
    })
    return () => { active = false }
  }, [])

  function edit(agent?: SavedAgent) {
    setError(null)
    setEditor(agent ? { id: agent.id, values: agent } : {
      values: { name: '', role: 'custom', allowedTools: [], enabled: true },
    })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || saving || !editor.values.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (editor.id) await updateAgentSettings(editor.id, editor.values)
      else await createAgentSettings(editor.values)
      setEditor(null)
      try {
        setAgents(await listAgentSettings())
      } catch (err) {
        console.error('[agents] settings refresh failed', err)
        setAgents(null)
        setError('loadError')
      }
    } catch (err) {
      console.error('[agents] settings save failed', err)
      setError('saveError')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingSection title={t('title')} desc={t('description')}>
      <div className="space-y-3 text-sm text-ink">
        {error && <p role="alert">{t(error)}</p>}
        {agents === null && !error && <p role="status">{t('loading')}</p>}
        {agents?.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
        {!!agents?.length && (
          <ul className="divide-y divide-line rounded-md border border-line bg-panel">
            {agents.map(agent => (
              <li key={agent.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="break-words font-medium">{agent.name}</div>
                  <p className="text-xs text-muted-foreground">
                    {t(`roles.${agent.role}`)} · {t(agent.enabled ? 'enabled' : 'disabled')}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => edit(agent)}>
                  {t('edit')}<span className="sr-only"> {agent.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!editor && agents !== null && (
          <Button type="button" variant="outline" disabled={saving} onClick={() => edit()}>{t('add')}</Button>
        )}
        {editor && (
          <form onSubmit={save} className="rounded-md border border-line bg-panel p-3">
            <fieldset disabled={saving} className="space-y-3">
              <label className="block space-y-1">
                <span>{t('name')}</span>
                <input
                  className={field}
                  required
                  maxLength={80}
                  value={editor.values.name}
                  onChange={event => setEditor({ ...editor, values: { ...editor.values, name: event.target.value } })}
                />
              </label>
              <label className="block space-y-1">
                <span>{t('role')}</span>
                <select
                  className={field}
                  value={editor.values.role}
                  onChange={event => {
                    const role = event.target.value
                    if (!isAgentRole(role)) return
                    setEditor({
                      ...editor,
                      values: { ...editor.values, role, allowedTools: editor.id ? editor.values.allowedTools : [...ROLE_TOOLS[role]] },
                    })
                  }}
                >
                  {AGENT_ROLES.map(role => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}
                </select>
              </label>
              <fieldset className="space-y-1">
                <legend className="mb-1 font-medium">{t('allowedTools')}</legend>
                {AGENT_TOOL_NAMES.map(tool => (
                  <label key={tool} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editor.values.allowedTools.includes(tool)}
                      onChange={event => {
                        const allowedTools = event.target.checked
                          ? [...editor.values.allowedTools, tool]
                          : editor.values.allowedTools.filter(name => name !== tool)
                        setEditor({ ...editor, values: { ...editor.values, allowedTools } })
                      }}
                    />
                    {t(`tools.${tool}`)}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editor.values.enabled}
                  onChange={event => setEditor({ ...editor, values: { ...editor.values, enabled: event.target.checked } })}
                />
                {t('enabled')}
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!editor.values.name.trim()}>{t(saving ? 'saving' : 'save')}</Button>
                <Button type="button" variant="outline" onClick={() => { setEditor(null); setError(null) }}>{t('cancel')}</Button>
              </div>
            </fieldset>
          </form>
        )}
      </div>
    </SettingSection>
  )
}
