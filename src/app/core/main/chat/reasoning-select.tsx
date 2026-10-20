'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import { Slider } from '@/components/ui/slider'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import useSettingStore from '@/stores/setting'
import useChatStore from '@/stores/chat'
import { getReasoningEfforts, normalizeReasoningEffort, REASONING_EFFORTS } from '@/lib/ai/tauri-client'
import { applyChatReasoningOverride, getReasoningModelKey } from '@/lib/ai/chat-reasoning'
import { collectGroupedChatModels } from './model-selection'

export function ReasoningSelect() {
  const t = useTranslations('settings.ai.reasoningEffort')
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
    <FieldGroup className="px-3 py-3">
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel id={`${id}-label`}>{t('title')}</FieldLabel>
          <output className="text-xs text-muted-foreground" aria-live="polite">
            {options[selectedIndex].label}
          </output>
        </div>
        <Slider
          id={id}
          aria-labelledby={`${id}-label`}
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
      </Field>
    </FieldGroup>
  )
}
