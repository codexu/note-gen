"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import type { AgentState, AgentTraceEvent, AgentUserAnswer, AgentUserQuestion } from '@/lib/agent/types'
import { QuestionUi } from '@/components/chat-ui/question-ui'

type PendingQuestion = NonNullable<AgentState['pendingQuestion']>

export function AgentQuestionPanel({ chatId, traceEventId, embedded = false }: {
  chatId?: number
  traceEventId?: string
  embedded?: boolean
}) {
  const pending = useChatStore(state => state.agentState.pendingQuestion)
  const conversationId = useChatStore(state => state.currentConversationId)
  const activeChatId = useChatStore(state => state.agentState.activeChatId)
  const runId = useChatStore(state => state.agentState.runId)
  const running = useChatStore(state => state.agentState.isRunning)
  const workspacePath = useSettingStore(state => state.workspacePath)
  if (!pending || !running || pending.response !== undefined || pending.conversationId !== (conversationId ?? undefined)
    || (chatId !== undefined && pending.chatId !== chatId)
    || (traceEventId !== undefined && pending.traceEventId !== traceEventId && pending.toolCallId !== traceEventId)
    || (pending.chatId !== undefined && pending.chatId !== activeChatId)
    || (pending.runId !== undefined && pending.runId !== runId)
    || (pending.workspacePath !== undefined && pending.workspacePath !== workspacePath)) return null
  return <QuestionForm key={pending.id} pending={pending} embedded={embedded} />
}

function QuestionForm({ pending, embedded }: { pending: PendingQuestion; embedded: boolean }) {
  const [answers, setAnswers] = useState<AgentUserAnswer[]>(() => pending.questions.map(question => ({ question: question.question, selected: [] })))
  const [questionIndex, setQuestionIndex] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const advancing = useRef(false)
  const answered = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    advancing.current = false
    panel.current?.querySelector('[data-slot="card-content"]')?.scrollTo(0, 0)
    if (document.hasFocus()) panel.current?.querySelector<HTMLElement>('[data-slot="toggle-group-item"]')?.focus({ preventScroll: true })
  }, [questionIndex])
  const question = pending.questions[questionIndex]
  const selected = answers[questionIndex]?.selected ?? []
  const respond = (response: AgentUserAnswer[] | null) => {
    const store = useChatStore.getState()
    const latest = store.agentState.pendingQuestion
    if (answered.current || !latest || latest.id !== pending.id || latest.response !== undefined || !store.agentState.isRunning
      || (store.currentConversationId ?? undefined) !== pending.conversationId
      || (pending.chatId !== undefined && store.agentState.activeChatId !== pending.chatId)
      || (pending.runId !== undefined && store.agentState.runId !== pending.runId)
      || (pending.workspacePath !== undefined && useSettingStore.getState().workspacePath !== pending.workspacePath)) return
    answered.current = true
    setSubmitted(true)
    store.setAgentState({ pendingQuestion: { ...latest, response } })
  }
  const advance = (nextAnswers: AgentUserAnswer[]) => {
    if (answered.current || advancing.current || !nextAnswers[questionIndex]?.selected.length) return
    advancing.current = true
    setAnswers(nextAnswers)
    if (questionIndex + 1 < pending.questions.length) setQuestionIndex(questionIndex + 1)
    else respond(nextAnswers)
  }
  const select = (values: string[]) => {
    if (!question || answered.current || advancing.current) return
    const valid = values.length === new Set(values).size && values.every(value => question.options.some(option => option.label === value))
    if (!valid || (!question.multiSelect && values.length > 1)) return
    const nextAnswers = answers.map((answer, index) => index === questionIndex ? { ...answer, selected: values } : answer)
    if (question.multiSelect) setAnswers(nextAnswers)
    else if (values.length) advance(nextAnswers)
  }

  if (!question) return null
  return <div ref={panel} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      respond(null)
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && question.multiSelect && selected.length) {
      event.preventDefault()
      event.stopPropagation()
      advance(answers)
    }
  }}>
    <QuestionUi id={pending.id} questions={pending.questions} answers={answers} questionIndex={questionIndex} disabled={submitted} embedded={embedded}
      onSelect={select} onAdvance={() => advance(answers)} onCancel={() => respond(null)} />
  </div>
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

function readQuestions(input: unknown): AgentUserQuestion[] {
  const raw = asRecord(input)?.questions
  if (!Array.isArray(raw) || raw.length > 4) return []
  return raw.flatMap((value: unknown): AgentUserQuestion[] => {
    const item = asRecord(value)
    if (!item || typeof item.question !== 'string' || !item.question || item.question.length > 1_000 || !Array.isArray(item.options) || item.options.length > 6) return []
    const options = item.options.flatMap((value: unknown) => {
      const option = asRecord(value)
      if (!option || typeof option.label !== 'string' || !option.label || option.label.length > 200) return []
      return [{ label: option.label, description: typeof option.description === 'string' ? option.description.slice(0, 500) : undefined }]
    })
    return [{ question: item.question, options, multiSelect: item.multiSelect === true }]
  })
}

function readAnswers(output: unknown): { answers: AgentUserAnswer[]; cancelled: boolean } {
  const result = asRecord(output)
  const cancelled = result?.error === 'USER_CANCELLED_QUESTION'
  if (result?.ok !== true && result?.success !== true) return { answers: [], cancelled }
  const raw = asRecord(result.data)?.answers
  if (!Array.isArray(raw) || raw.length > 4) return { answers: [], cancelled }
  const answers = raw.flatMap((value: unknown): AgentUserAnswer[] => {
    const item = asRecord(value)
    if (!item || typeof item.question !== 'string' || !item.question || item.question.length > 1_000 || !Array.isArray(item.selected)
      || item.selected.length > 6 || item.selected.some(value => typeof value !== 'string' || !value || value.length > 200)) return []
    return [{ question: item.question, selected: item.selected as string[] }]
  })
  return { answers, cancelled }
}

/** Recorded output only: this view never writes pendingQuestion or synthesizes a response. */
export function AgentQuestionResult({ event }: { event: AgentTraceEvent }) {
  const history = useMemo(() => {
    const result = readAnswers(event.output)
    let questions = readQuestions(event.input)
    if (!questions.length) questions = result.answers.map(answer => ({ question: answer.question, options: answer.selected.map(label => ({ label })), multiSelect: answer.selected.length > 1 }))
    const answers = questions.map((question, index) => {
      const answer = result.answers[index]
      const valid = answer?.question === question.question && answer.selected.every(value => question.options.some(option => option.label === value))
      return { question: question.question, selected: valid ? answer.selected : [] }
    })
    return { ...result, questions, answers }
  }, [event.input, event.output])
  return <QuestionUi id={event.id} questions={history.questions} answers={history.answers} cancelled={history.cancelled} readOnly embedded />
}
