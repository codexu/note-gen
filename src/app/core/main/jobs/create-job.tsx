'use client'

import { useState } from 'react'
import { ListTodo, Plus, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { listAgentSettings } from '@/db/agents'
import type { AgentSettings } from '@/lib/agents/settings'
import { isUiV3, useUiV3 } from '@/lib/fork-ui'
import { jobCenter } from '@/lib/jobs'
import { proposeJob } from '@/lib/jobs/planner'
import { MAX_JOB_STEPS, type JobPlan, type StepPlan } from '@/lib/jobs/schedule'
import { threadKey } from '@/lib/threads/projects'
import useChatStore from '@/stores/chat'

const EMPTY_PLAN: JobPlan = { title: '', steps: [] }

export function CreateJobButton() {
  const t = useTranslations('jobs')
  const isV3 = useUiV3()
  const id = useChatStore(state => state.isTemporaryConversation ? null : state.currentConversationId)
  const current = useChatStore(state => state.conversations.find(thread => thread.id === id))
  const [open, setOpen] = useState(false)
  const [agents, setAgents] = useState<AgentSettings[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  function show() {
    setAgents(null)
    setLoadFailed(false)
    setOpen(true)
    void listAgentSettings().then(list => setAgents(list.filter(agent => agent.enabled)))
      .catch(() => setLoadFailed(true))
  }

  if (!isV3 || !current?.messageCount) return null
  return (
    <>
      <Button variant="outline" size="sm" onClick={show}><ListTodo aria-hidden />{t('new')}</Button>
      {open && (
        <CreateJobDialog key={threadKey(current)} target={threadKey(current)} agents={agents} loadFailed={loadFailed} close={() => setOpen(false)} />
      )}
    </>
  )
}

function CreateJobDialog({ target, agents, loadFailed, close }: {
  target: string
  agents: AgentSettings[] | null
  loadFailed: boolean
  close: () => void
}) {
  const t = useTranslations('jobs')
  const locale = useLocale()
  const [request, setRequest] = useState(() => {
    const message = useChatStore.getState().chats.slice().reverse().find(chat => chat.role === 'user')
    return (message?.content ?? '').slice(0, 6000)
  })
  const [plan, setPlan] = useState<JobPlan>(EMPTY_PLAN)
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null)
  const [error, setError] = useState('')
  const enabled = Boolean(agents?.length)

  function update(id: string, change: Partial<StepPlan>) {
    setPlan(current => ({
      ...current,
      steps: current.steps.map(step => step.id === id ? { ...step, ...change } : step),
    }))
  }

  function addStep() {
    setPlan(current => ({
      ...current,
      steps: [...current.steps, {
        id: crypto.randomUUID(), title: '', agentId: agents?.[0]?.id ?? '', prompt: '', criterion: '', dependsOn: [],
      }],
    }))
  }

  function removeStep(id: string) {
    setPlan(current => ({
      ...current,
      steps: current.steps.filter(step => step.id !== id)
        .map(step => ({ ...step, dependsOn: step.dependsOn.filter(dependency => dependency !== id) })),
    }))
  }

  async function generate() {
    if (!isUiV3() || !enabled || !agents || !request.trim()) return
    setBusy('generate')
    setError('')
    try {
      setPlan(await proposeJob(request.trim(), agents, locale))
    } catch (caught) {
      setError(caught instanceof Error && caught.message === 'JOB_MODEL_REQUIRED' ? t('modelRequired') : t('generateFailed'))
    } finally {
      setBusy(null)
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!enabled || !plan.steps.length) return
    setBusy('save')
    setError('')
    try {
      if (!plan.steps.every(step => agents?.some(agent => agent.id === step.agentId))) throw new Error('JOB_INVALID_PLAN')
      await jobCenter.create(target, {
        ...plan,
        steps: plan.steps.map(step => ({ ...step, agentName: agents?.find(agent => agent.id === step.agentId)?.name })),
      })
      close()
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code === 'JOB_INVALID_DEPENDENCIES' ? t('invalidDependencies') : code === 'JOB_INVALID_PLAN' ? t('invalidPlan') : t('saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next && !busy) close() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('new')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        {loadFailed ? <p role="alert" className="text-danger">{t('agentsFailed')}</p>
          : !agents ? <p role="status" className="text-muted-ink">{t('loadingAgents')}</p>
          : !enabled ? <p className="text-muted-ink">{t('noAgents')}</p>
          : (
            <form onSubmit={save} className="space-y-4 text-sm">
              <fieldset disabled={busy !== null} className="space-y-4">
                <label className="block space-y-1">
                  <span>{t('request')}</span>
                  <Textarea rows={3} maxLength={6000} value={request} onChange={event => setRequest(event.target.value)} />
                </label>
                <Button type="button" variant="outline" size="sm" disabled={!request.trim()} onClick={() => void generate()}>
                  {busy === 'generate' ? t('generating') : t('generate')}
                </Button>
                <label className="block space-y-1">
                  <span>{t('title')}</span>
                  <Input required maxLength={120} value={plan.title} onChange={event => setPlan(current => ({ ...current, title: event.target.value }))} />
                </label>
                {plan.steps.map((step, index) => (
                  <fieldset key={step.id} className="space-y-2 rounded-md border border-line p-3">
                    <legend className="px-1 text-muted-ink">{t('step', { number: index + 1 })}</legend>
                    <div className="flex items-end gap-2">
                      <label className="flex-1 space-y-1">
                        <span>{t('stepTitle')}</span>
                        <Input required maxLength={120} value={step.title} onChange={event => update(step.id, { title: event.target.value })} />
                      </label>
                      <Button type="button" variant="ghost" size="icon" aria-label={t('removeStep', { number: index + 1 })} onClick={() => removeStep(step.id)}><X aria-hidden /></Button>
                    </div>
                    <label className="block space-y-1">
                      <span>{t('agent')}</span>
                      <select value={step.agentId} onChange={event => update(step.id, { agentId: event.target.value })} className="block w-full rounded-md border border-line bg-bg px-2 py-1.5 text-ink">
                        {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span>{t('instructions')}</span>
                      <Textarea required rows={2} maxLength={4000} value={step.prompt} onChange={event => update(step.id, { prompt: event.target.value })} />
                    </label>
                    <label className="block space-y-1">
                      <span>{t('criterion')}</span>
                      <Input required maxLength={500} value={step.criterion} onChange={event => update(step.id, { criterion: event.target.value })} />
                    </label>
                    {plan.steps.length > 1 && (
                      <div role="group" aria-label={t('dependencies')} className="space-y-1">
                        <p className="text-muted-ink">{t('dependencies')}</p>
                        {plan.steps.map((other, nextIndex) => other.id !== step.id && (
                          <label key={other.id} className="flex items-start gap-2">
                            <input type="checkbox" className="mt-0.5" checked={step.dependsOn.includes(other.id)} onChange={event => update(step.id, {
                              dependsOn: event.target.checked ? [...step.dependsOn, other.id] : step.dependsOn.filter(id => id !== other.id),
                            })} />
                            <span className="min-w-0 wrap-break-word">{t('step', { number: nextIndex + 1 })}{other.title && ` · ${other.title}`}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                ))}
                <Button type="button" variant="outline" size="sm" disabled={plan.steps.length >= MAX_JOB_STEPS} onClick={addStep}><Plus aria-hidden />{t('addStep')}</Button>
              </fieldset>
              {error && <p role="alert" className="text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={busy !== null} onClick={close}>{t('close')}</Button>
                <Button type="submit" disabled={busy !== null || !plan.steps.length}>{t('saveProposal')}</Button>
              </div>
            </form>
          )}
      </DialogContent>
    </Dialog>
  )
}
