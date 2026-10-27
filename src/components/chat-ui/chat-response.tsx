"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react'
import type { Chat } from '@/db/chats'
import type { AgentArtifactPaths } from '@/lib/agent/artifacts'
import { responseCatalog, getChatResponseText } from '@/lib/chat-ui/response-catalog'
import { getChatResponseCompletion, parseChatUiBlocks } from '@/lib/chat-ui/serialization'
import { getChatResponseSources } from '@/lib/chat-ui/response-host'
import { getWorkspacePath } from '@/lib/workspace'
import { getSkillWorkspaceIdentity } from '@/lib/skills/runtime'
import { cn } from '@/lib/utils'
import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import ChatPreview from '@/app/core/main/chat/chat-preview'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { EMPTY_ARTIFACT_LINKS } from '@/components/markdown/artifact-link'
import { ChatResponseContext } from './response-context'
import { ResponseIcon } from './response-icon'
import { ResponseAccordion, ResponseCodeBlock, ResponseMarkdown, ResponseMath, ResponseSteps, ResponseTabs, ResponseTimeline, ResponseTypography } from './response-content'
import { ResponseActionGroup, ResponseArtifactLink, ResponseImage, ResponseNoteLink, ResponseQuote, ResponseSources } from './response-controls'

class ResponseErrorBoundary extends React.Component<{
  children: React.ReactNode
  fallback: React.ReactNode
}, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

const { registry } = defineRegistry(responseCatalog, {
  components: {
    Stack: ({ props, children }) => <div className={cn('flex min-w-0 flex-col', props.gap === 'sm' ? 'gap-2' : props.gap === 'lg' ? 'gap-6' : 'gap-3')}>{children}</div>,
    Card: ({ props, children }) => props.variant === 'outlined' ? <Card size="sm" className="min-w-0">
      {(props.title || props.description) && <CardHeader>
        {props.title && <CardTitle><ResponseTypography type="Heading" props={{ text: props.title, level: 3 }} icon={props.icon} /></CardTitle>}
        {props.description && <CardDescription><ResponseTypography type="Text" props={{ text: props.description }} /></CardDescription>}
      </CardHeader>}
      {React.Children.count(children) > 0 && <CardContent className="flex min-w-0 flex-col gap-3">{children}</CardContent>}
    </Card> : <section className="flex min-w-0 flex-col gap-3">
      {(props.title || props.description) && <header className="flex min-w-0 flex-col gap-1">
        {props.title && <ResponseTypography type="Heading" props={{ text: props.title, level: 3 }} icon={props.icon} />}
        {props.description && <ResponseTypography type="Text" props={{ text: props.description }} />}
      </header>}
      {React.Children.count(children) > 0 && <div className="flex min-w-0 flex-col gap-3">{children}</div>}
    </section>,
    Text: ({ props }) => <ResponseTypography type="Text" props={props} />,
    Markdown: ({ props }) => <ResponseMarkdown text={props.text} />,
    Heading: ({ props }) => <ResponseTypography type="Heading" props={props} icon={props.icon} />,
    List: ({ props }) => <ResponseTypography type="List" props={props} />,
    Table: ({ props }) => <ResponseTypography type="Table" props={props} />,
    Icon: ({ props }) => <ResponseIcon name={props.name} label={props.label} size={props.size === 'sm' ? 12 : props.size === 'lg' ? 24 : 16} />,
    Alert: ({ props, children }) => <Alert variant={props.variant}>
      <ResponseIcon name={props.icon ?? (props.variant === 'warning' || props.variant === 'destructive' ? 'triangle-alert' : 'info')} />
      <AlertTitle>{props.title}</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2">
        {props.description && <p className="whitespace-pre-wrap break-words">{props.description}</p>}{children}
      </AlertDescription>
    </Alert>,
    Badge: ({ props }) => <Badge variant={props.variant} className="max-w-full" title={props.text}><ResponseIcon name={props.icon} /><span className="truncate">{props.text}</span></Badge>,
    KeyValue: ({ props }) => <section className="flex min-w-0 flex-col gap-2">
      {props.title && <ResponseTypography type="Heading" props={{ text: props.title, level: 3 }} />}
      <dl className="flex min-w-0 flex-col gap-2">{props.items.map((item, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-3">
        <dt className="flex items-center gap-2 text-muted-foreground"><ResponseIcon name={item.icon} /><span className="min-w-0 break-words">{item.label}</span></dt>
        <dd className="whitespace-pre-wrap break-words">{item.value}</dd>
      </div>)}</dl>
    </section>,
    Stat: ({ props }) => <Card size="sm" className="min-w-0">
      <CardHeader><CardDescription className="flex items-center gap-2"><ResponseIcon name={props.icon} />{props.label}</CardDescription></CardHeader>
      <CardContent><p className="break-words text-2xl font-semibold">{props.value}</p>
        {props.description && <p className="mt-1 break-words text-sm text-muted-foreground">{props.description}</p>}
      </CardContent>
    </Card>,
    Steps: ({ props }) => <ResponseSteps {...props} />,
    Timeline: ({ props }) => <ResponseTimeline {...props} />,
    Accordion: ({ props }) => <ResponseAccordion {...props} />,
    Tabs: ({ props }) => <ResponseTabs {...props} />,
    Math: ({ props }) => <ResponseMath {...props} />,
    CodeBlock: ({ props }) => <ResponseCodeBlock {...props} />,
    Quote: ({ props }) => <ResponseQuote {...props} />,
    Sources: ({ props }) => <ResponseSources {...props} />,
    Image: ({ props }) => <ResponseImage {...props} />,
    NoteLink: ({ props }) => <ResponseNoteLink {...props} />,
    ArtifactLink: ({ props }) => <ResponseArtifactLink {...props} />,
    Progress: ({ props }) => <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3"><p className="break-words">{props.label}</p><span className="text-sm tabular-nums text-muted-foreground">{props.value}%</span></div>
      <Progress value={props.value} aria-label={props.label} />
      {props.description && <p className="break-words text-sm text-muted-foreground">{props.description}</p>}
    </section>,
    Separator: () => <Separator />,
    ActionGroup: ({ props }) => <ResponseActionGroup {...props} />,
  },
})

export interface ChatResponseProps {
  chat: Chat
  text: string
  streaming?: boolean
  artifacts?: AgentArtifactPaths
}

/** The final reply chooses one format; tool progress and forms stay in the timeline. */
export function ChatResponse({ chat, text, streaming = false, artifacts }: ChatResponseProps) {
  const t = useTranslations('record.chat.input.agent.ui')
  const responseT = useTranslations('record.chat.response')
  const contentTextScale = useSettingStore(state => state.contentTextScale)
  const workspaceKey = useSettingStore(state => state.workspacePath)
  const agentState = useChatStore(state => state.agentState)
  const live = agentState.activeChatId === chat.id ? agentState : undefined
  const candidate = live?.isRunning && live.responsePreview?.runId === live.runId ? live.responsePreview : undefined
  const [previewWorkspace, setPreviewWorkspace] = useState<{ key: string; identity: string }>()
  useEffect(() => {
    if (!candidate) return
    let cancelled = false
    void getWorkspacePath().then(workspace => {
      if (!cancelled) setPreviewWorkspace({ key: workspaceKey, identity: getSkillWorkspaceIdentity(workspace) })
    }).catch(() => { if (!cancelled) setPreviewWorkspace(undefined) })
    return () => { cancelled = true }
  }, [candidate?.runId, candidate?.workspaceIdentity, workspaceKey])
  const preview = candidate && previewWorkspace && previewWorkspace.key === workspaceKey
    && previewWorkspace.identity === candidate.workspaceIdentity ? candidate : undefined
  const completion = getChatResponseCompletion(live ?? chat.agentHistory)
  const response = useMemo(() => completion && parseChatUiBlocks(chat.uiBlocks).findLast(block => (
    block.placement === 'response' && block.mode === 'display' && block.status === 'displayed'
    && block.runId === completion.runId && block.toolCallId === completion.toolCallId
  )), [chat.uiBlocks, completion?.runId, completion?.toolCallId])
  const isPreview = !response && Boolean(preview)
  const spec = response?.spec ?? preview?.spec
  const context = useMemo(() => ({
    artifacts: artifacts ?? EMPTY_ARTIFACT_LINKS,
    sources: getChatResponseSources(chat.ragSourceDetails, live?.ragSourceDetails),
    workspaceFingerprint: response?.workspaceFingerprint,
    isPreview,
  }), [artifacts, chat.ragSourceDetails, live?.ragSourceDetails, response?.workspaceFingerprint, isPreview])

  if (!spec) return text || streaming ? <ChatPreview text={text} streaming={streaming} artifacts={artifacts} /> : null

  const fallbackText = isPreview ? '' : text || getChatResponseText(spec)
  const fallback = isPreview ? null : fallbackText
    ? <ChatPreview text={fallbackText} artifacts={artifacts} />
    : <Alert><AlertDescription>{t('renderError')}</AlertDescription></Alert>
  return <section aria-label={response?.title || preview?.title || responseT('generating')} aria-busy={isPreview}
    className="streamdown-document flex min-w-0 w-full select-text flex-col gap-3" style={{ fontSize: `${(16 * contentTextScale) / 100}px` }}>
    {isPreview && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />{responseT('generating')}</div>}
    <ResponseErrorBoundary key={response?.id ?? `${preview?.runId}:${preview?.toolCallId}`} fallback={fallback}>
      <ChatResponseContext.Provider value={context}>
        <JSONUIProvider registry={registry} handlers={{}}>
          <Renderer spec={spec} registry={registry} loading={isPreview} fallback={() => fallback} />
        </JSONUIProvider>
      </ChatResponseContext.Provider>
    </ResponseErrorBoundary>
  </section>
}
