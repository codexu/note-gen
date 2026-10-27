"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { JSONUIProvider, Renderer } from '@json-render/react'
import { Loader2 } from 'lucide-react'
import type { Chat } from '@/db/chats'
import type { ChatUiBlock, ChatUiValue, ChatUiValues } from '@/lib/chat-ui/types'
import { getChatUiFields, getChatUiInitialValues, validateChatUiValues } from '@/lib/chat-ui/catalog'
import { parseChatUiBlocks } from '@/lib/chat-ui/serialization'
import { loadChatUiDomainOptions } from '@/lib/chat-ui/domain'
import { cancelChatUiInteraction, getChatUiInteractionDraft, submitChatUiInteraction, updateChatUiInteractionDraft } from '@/lib/chat-ui/interaction'
import { getWorkspacePath } from '@/lib/workspace'
import { getSkillWorkspaceIdentity } from '@/lib/skills/runtime'
import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ChatUiFormContext, type ChatUiDomainOptions } from './form-context'
import { chatUiRegistry } from './chat-ui-registry'

class ChatUiErrorBoundary extends React.Component<{
  children: React.ReactNode
  fallback: React.ReactNode
  onError: () => void
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const emptyOptions: ChatUiDomainOptions = { notes: [], folders: [], tags: [] }

export function ChatUiMessages({ chat, blocks: suppliedBlocks, embedded = false }: {
  chat: Chat
  blocks?: ChatUiBlock[]
  embedded?: boolean
}) {
  const t = useTranslations('record.chat.input.agent.ui')
  const pending = useChatStore(state => state.agentState.pendingUiInteraction)
  const activeChatId = useChatStore(state => state.agentState.activeChatId)
  const runId = useChatStore(state => state.agentState.runId)
  const isRunning = useChatStore(state => state.agentState.isRunning)
  const conversationId = useChatStore(state => state.currentConversationId)
  const workspaceKey = useSettingStore(state => state.workspacePath)
  const blocks = useMemo(() => (suppliedBlocks ?? parseChatUiBlocks(chat.uiBlocks))
    .filter(block => block.placement === undefined || block.placement === 'step'), [suppliedBlocks, chat.uiBlocks])
  const candidate = isRunning && activeChatId === chat.id && pending?.chatId === chat.id && pending.runId === runId && pending.conversationId === (conversationId ?? undefined)
    ? pending
    : undefined
  const [identity, setIdentity] = useState<{ key: string; value: string } | null>(null)

  useEffect(() => {
    if (!candidate) return
    let cancelled = false
    void getWorkspacePath().then(workspace => {
      if (!cancelled) setIdentity({ key: workspaceKey, value: getSkillWorkspaceIdentity(workspace) })
    }).catch(() => {
      if (!cancelled) setIdentity(null)
    })
    return () => { cancelled = true }
  }, [candidate?.id, workspaceKey])

  if (!blocks.length) return !suppliedBlocks && chat.uiBlocks && chat.uiBlocks.trim() !== '[]' && parseChatUiBlocks(chat.uiBlocks).length === 0 ? <Alert><AlertDescription>{t('renderError')}</AlertDescription></Alert> : null

  return <div className="flex min-w-0 flex-col gap-3">{blocks.map(block => {
    const active = Boolean(candidate && candidate.id === block.id && candidate.runId === block.runId && identity?.key === workspaceKey && identity?.value === candidate.workspaceIdentity && !candidate.response && block.mode === 'collect' && block.status === 'pending')
    const checking = Boolean(candidate?.id === block.id && identity?.key !== workspaceKey)
    return <ChatUiCard key={block.id} block={block} active={active} checking={checking} embedded={embedded} />
  })}</div>
}

function ChatUiCard({ block, active, checking, embedded }: { block: ChatUiBlock; active: boolean; checking: boolean; embedded: boolean }) {
  const t = useTranslations('record.chat.input.agent.ui')
  const [values, setValues] = useState<ChatUiValues>(() => ({ ...getChatUiInitialValues(block.spec), ...block.state, ...block.submittedValues, ...getChatUiInteractionDraft(block.id) }))
  const draftValues = useRef(values)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [renderFailed, setRenderFailed] = useState(false)
  const submitting = useRef(false)
  const [domainOptions, setDomainOptions] = useState<ChatUiDomainOptions>(emptyOptions)
  const [domainLoading, setDomainLoading] = useState(false)
  const [domainReady, setDomainReady] = useState(false)
  const [domainFailed, setDomainFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const tags = useTagStore(state => state.tags)
  const fields = useMemo(() => getChatUiFields(block.spec), [block.spec])
  const needsDomain = fields.some(field => ['NotePicker', 'FolderPicker', 'TagPicker'].includes(field.type))

  useEffect(() => {
    if (block.status !== 'pending') {
      const next = { ...getChatUiInitialValues(block.spec), ...block.state, ...block.submittedValues }
      draftValues.current = next
      setValues(next)
    }
  }, [block.status, block.state, block.submittedValues, block.spec])

  useEffect(() => {
    if (!active || !needsDomain) return
    let cancelled = false
    setDomainLoading(true)
    setDomainReady(false)
    setDomainFailed(false)
    void loadChatUiDomainOptions(fields.map(field => field.type)).then(options => {
      if (!cancelled) {
        setDomainOptions(options)
        setDomainReady(true)
      }
    }).catch(() => {
      if (!cancelled) setDomainFailed(true)
    }).finally(() => {
      if (!cancelled) setDomainLoading(false)
    })
    return () => { cancelled = true }
  }, [active, needsDomain, reload, fields])

  const setValue = (name: string, value: ChatUiValue) => {
    if (!active || submitting.current) return
    const nextValues = { ...draftValues.current, [name]: value }
    draftValues.current = nextValues
    updateChatUiInteractionDraft(block.id, nextValues)
    setValues(nextValues)
    setErrors(current => {
      const next = { ...current }
      delete next[name]
      delete next._form
      return next
    })
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!active || submitting.current || renderFailed || (needsDomain && (!domainReady || domainLoading || domainFailed))) return
    const validation = validateChatUiValues(block.spec, values)
    if (!validation.success) {
      setErrors(validation.errors)
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      const result = await submitChatUiInteraction(block.id, validation.values)
      if (!result.success) setErrors(result.errors ?? { _form: 'saveFailed' })
    } catch {
      setErrors({ _form: 'saveFailed' })
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const cancel = async () => {
    if (!active || submitting.current) return
    submitting.current = true
    setBusy(true)
    try {
      await cancelChatUiInteraction(block.id)
    } catch {
      setErrors({ _form: 'saveFailed' })
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const status = block.status === 'pending' ? active || checking ? 'waiting' : 'expired' : block.status
  const fallback = <Alert><AlertDescription>{t('renderError')}</AlertDescription></Alert>

  return <form onSubmit={submit} noValidate className="w-full min-w-0">
    <Card size="sm" className="w-full min-w-0 ring-inset">
      {!embedded && <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="min-w-0 break-words">{block.title}</CardTitle>
          <Badge variant="secondary">{t(status)}</Badge>
        </div>
      </CardHeader>}
      <CardContent className="flex min-w-0 flex-col gap-3">
        <ChatUiErrorBoundary fallback={fallback} onError={() => setRenderFailed(true)}>
          <ChatUiFormContext.Provider value={{ id: block.id, values, setValue, readOnly: !active || busy, errors, domainOptions: { ...domainOptions, tags: domainOptions.tags.length ? domainOptions.tags : tags.map(tag => ({ label: tag.name, value: String(tag.id) })) }, domainLoading: needsDomain && (!domainReady || domainLoading) }}>
            <JSONUIProvider registry={chatUiRegistry} handlers={{}}>
              <Renderer spec={block.spec} registry={chatUiRegistry} fallback={() => fallback} />
            </JSONUIProvider>
          </ChatUiFormContext.Provider>
        </ChatUiErrorBoundary>
        {active && domainFailed && <Alert variant="destructive"><AlertDescription>{t('loadError')}</AlertDescription><Button type="button" variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>{t('retry')}</Button></Alert>}
        {errors._form && <Alert variant="destructive"><AlertDescription>{t(errors._form === 'expired' ? 'expiredDescription' : 'submitError')}</AlertDescription></Alert>}
      </CardContent>
      {active && <CardFooter className="justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void cancel()}>{t('cancel')}</Button>
        <Button type="submit" size="sm" disabled={busy || renderFailed || (needsDomain && (!domainReady || domainLoading || domainFailed))}>
          {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}{t('submit')}
        </Button>
      </CardFooter>}
    </Card>
  </form>
}
