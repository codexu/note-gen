'use client'

import { useId } from 'react'
import { Brain } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Slider } from '@/components/ui/slider'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import useSettingStore from '@/stores/setting'
import useChatStore from '@/stores/chat'
import { getReasoningEfforts, normalizeReasoningEffort, REASONING_EFFORTS } from '@/lib/ai/tauri-client'
import { applyChatReasoningOverride, getReasoningModelKey } from '@/lib/ai/chat-reasoning'
import { collectGroupedChatModels } from './model-selection'

export function ReasoningSelect() {
  const t = useTranslations('settings.ai.reasoningEffort')
  const tTools = useTranslations('record.chat.input.toolsMenu')
  const id = useId()
  const modelId = useSettingStore(state => state.primaryModel)
  const platforms = useSettingStore(state => state.aiModelList)
  const override = useChatStore(state => state.reasoningOverride)
  const setOverride = useChatStore(state => state.setReasoningOverride)
  const selected = collectGroupedChatModels(platforms).find(item => (
    item.model.id === modelId || `${item.configKey}-${item.model.id}` === modelId
  ))
  const provider = platforms.find(item => item.key === selected?.configKey)
  if (!selected || !provider) return null

  const config = { ...provider, ...selected.model }
  const supported = getReasoningEfforts(config)
  if (supported?.length === 0) return null
  const effective = applyChatReasoningOverride(config, modelId, override)
  const value = effective?.reasoningEffort
  const options = [
    { value: 'default', label: t('default') },
    ...(supported || REASONING_EFFORTS).map(value => ({ value, label: t(value) })),
  ]
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === (value || 'default')))

  return (
    <FieldGroup className="min-w-0 px-2 py-2.5">
      <Field className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Brain aria-hidden="true" className="size-4 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <FieldLabel id={`${id}-label`}>{t('title')}</FieldLabel>
            <FieldDescription id={`${id}-description`} className="truncate text-xs">{tTools('reasoning.description')}</FieldDescription>
          </div>
          <output className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
            {options[selectedIndex].label}
          </output>
        </div>
        <div className="min-w-0 pl-7 pr-2">
          <Slider
            id={id}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-description`}
            className="w-full"
            min={0}
            max={options.length - 1}
            step={1}
            value={[selectedIndex]}
            aria-valuetext={options[selectedIndex].label}
            onValueChange={([index]) => {
              const effort = normalizeReasoningEffort(options[index]?.value)
              setOverride(effort ? {
                modelId,
                modelKey: getReasoningModelKey(config),
                effort,
              } : null)
            }}
          />
        </div>
      </Field>
    </FieldGroup>
  )
}
