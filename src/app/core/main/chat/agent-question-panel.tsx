"use client"

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import useChatStore from '@/stores/chat'
import type { AgentState, AgentUserAnswer } from '@/lib/agent/types'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, Check } from 'lucide-react'

type PendingQuestion = NonNullable<AgentState['pendingQuestion']>

export function AgentQuestionPanel() {
  const pending = useChatStore(state => state.agentState.pendingQuestion)
  const conversationId = useChatStore(state => state.currentConversationId)
  if (!pending || pending.conversationId !== (conversationId ?? undefined)) return null
  return <QuestionForm key={pending.id} pending={pending} />
}

function QuestionForm({ pending }: { pending: PendingQuestion }) {
  const t = useTranslations('record.chat.input.agent.question')
  const [answers, setAnswers] = useState<AgentUserAnswer[]>(() => pending.questions.map(question => ({ question: question.question, selected: [] })))
  const [questionIndex, setQuestionIndex] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const advancingRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    advancingRef.current = false
    panelRef.current?.querySelector('[data-slot="card-content"]')?.scrollTo(0, 0)
    if (document.hasFocus()) panelRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }, [questionIndex])
  const question = pending.questions[questionIndex]
  const selected = answers[questionIndex].selected
  const labelId = `question-${pending.id}-${questionIndex}`
  const respond = (response: AgentUserAnswer[] | null) => {
    const store = useChatStore.getState()
    if (submitted || store.agentState.pendingQuestion?.id !== pending.id || (store.currentConversationId ?? undefined) !== pending.conversationId) return
    setSubmitted(true)
    store.setAgentState({ pendingQuestion: { ...pending, response } })
  }
  const advance = (nextAnswers: AgentUserAnswer[]) => {
    if (submitted || advancingRef.current || nextAnswers[questionIndex].selected.length === 0) return
    advancingRef.current = true
    setAnswers(nextAnswers)
    if (questionIndex + 1 < pending.questions.length) setQuestionIndex(questionIndex + 1)
    else respond(nextAnswers)
  }
  const select = (values: string[]) => {
    if (submitted || advancingRef.current) return
    const nextAnswers = answers.map((answer, index) => index === questionIndex ? { ...answer, selected: values } : answer)
    if (question.multiSelect) setAnswers(nextAnswers)
    else if (values.length) advance(nextAnswers)
  }
  const options = question.options.map((option, index) => (
    <ToggleGroupItem key={option.label} value={option.label} className="h-auto min-h-11 w-full items-start justify-start gap-3 whitespace-normal px-3 py-3 text-left">
      <Badge variant="outline" aria-hidden="true">{index + 1}</Badge>
      <span className="flex min-w-0 flex-1 flex-col gap-1 break-words">
        <span>{option.label}</span>
        {option.description && <span className="text-muted-foreground">{option.description}</span>}
      </span>
      {question.multiSelect && selected.includes(option.label) && <Check aria-hidden="true" />}
    </ToggleGroupItem>
  ))
  return (
    <Card ref={panelRef} size="sm" className="mb-2 w-full min-w-0" onKeyDown={event => {
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
      <CardHeader>
        <div className="flex items-center gap-2">
          {pending.questions.length > 1 && <Badge variant="outline">{questionIndex + 1}/{pending.questions.length}</Badge>}
          <Badge variant="secondary">{t(question.multiSelect ? 'multiple' : 'single')}</Badge>
        </div>
        <CardTitle id={labelId} className="break-words" aria-live="polite">{question.question}</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[45dvh] overflow-y-auto">
        <FieldGroup>
          <Field data-disabled={submitted}>
            {question.multiSelect ? (
              <ToggleGroup key={questionIndex} type="multiple" variant="outline" orientation="vertical" className="w-full" aria-labelledby={labelId} value={selected} onValueChange={select} disabled={submitted}>
                {options}
              </ToggleGroup>
            ) : (
              <ToggleGroup key={questionIndex} type="single" variant="outline" orientation="vertical" className="w-full" aria-labelledby={labelId} value={selected[0] || ''} onValueChange={value => select(value ? [value] : [])} disabled={submitted}>
                {options}
              </ToggleGroup>
            )}
            {question.multiSelect && (
              <Button variant="ghost" className="w-full justify-start" disabled={submitted || selected.length === 0} onClick={() => advance(answers)}>
                <ArrowRight data-icon="inline-start" />
                {t('done')}
              </Button>
            )}
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
