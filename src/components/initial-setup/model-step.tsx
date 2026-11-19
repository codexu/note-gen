'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Store } from '@tauri-apps/plugin-store'
import { Bot, KeyRound } from 'lucide-react'

import { collectGroupedChatModels, findGroupedChatModel } from '@/app/core/main/chat/model-selection'
import { AiSettings } from '@/app/core/setting/ai/ai-settings'
import { ModelSelect } from '@/app/core/setting/components/model-select'
import { isNoteGenProvider, noteGenDefaultModels } from '@/app/model-config'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Field, FieldGroup, FieldTitle } from '@/components/ui/field'
import { ToggleGroup } from '@/components/ui/toggle-group'
import useSettingStore, { flushChangedSyncableSettingsPersist } from '@/stores/setting'
import { SetupOption } from './setup-option'
import { SetupStepActions, type SetupStepProps } from './setup-step-actions'

type ModelChoice = 'free' | 'custom'

export function SetupModelStep({ onNext, onBack, mobile }: SetupStepProps) {
  const t = useTranslations('initialSetup')
  const modelText = useTranslations('settings.defaultModel')
  const primaryModel = useSettingStore(state => state.primaryModel)
  const configs = useSettingStore(state => state.aiModelList)
  const models = collectGroupedChatModels(configs)
  const activeModel = findGroupedChatModel(models, primaryModel)
  const builtInModel = activeModel && isNoteGenProvider(activeModel.configKey, activeModel.configTitle)
  const [choice, setChoice] = useState<ModelChoice>(primaryModel && !builtInModel ? 'custom' : 'free')
  const [chosenModel, setChosenModel] = useState<string>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)
  const savingRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const customConfigs = configs.filter(config => !isNoteGenProvider(config.key, config.title))
  const selectableModels = models.filter(item => customConfigs.some(config => config.key === item.configKey))
  const initialModel = builtInModel || !primaryModel ? selectableModels[0] : findGroupedChatModel(selectableModels, primaryModel)
  const selectedModel = chosenModel === undefined
    ? initialModel
    : selectableModels.find(({ configKey, model }) => chosenModel === `${configKey}-${model.id}`)
  const selectedKey = selectedModel ? `${selectedModel.configKey}-${selectedModel.model.id}` : ''
  const selectedConfig = customConfigs.find(config => config.key === selectedModel?.configKey)
  // Older providers use their own key for their single chat model.
  const customKey = selectedConfig?.models?.length ? selectedKey : selectedConfig?.key

  async function continueSetup() {
    if (savingRef.current || (choice === 'custom' && !selectedModel)) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      await flushChangedSyncableSettingsPersist()
      const store = await Store.load('store.json')
      if (!mounted.current) return
      const settings = useSettingStore.getState()
      const primary = choice === 'free'
        ? (activeModel?.configKey === 'note-gen-free' ? primaryModel : 'note-gen-chat')
        : (selectedModel === activeModel ? primaryModel : customKey)
      if (!primary) return
      const needsFreeProvider = choice === 'free' && !settings.aiModelList.some(config => config.key === 'note-gen-free')
      const updated = needsFreeProvider ? [...settings.aiModelList, noteGenDefaultModels[0]] : settings.aiModelList
      if (needsFreeProvider) {
        await store.set('aiModelList', updated)
      }
      await store.set('primaryModel', primary)
      await store.save()
      if (needsFreeProvider) settings.setAiModelList(updated)
      settings.setPrimaryModel(primary)
      if (mounted.current) onNext()
    } catch {
      if (mounted.current) setError(t('model.saveFailed'))
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="app-panel-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pt-2 pb-6">
        <ToggleGroup type="single" value={choice} disabled={saving}
          onValueChange={value => {
            if (value === 'free' || value === 'custom') {
              setError('')
              setChoice(value)
            }
          }}
          aria-label={t('model.choose')} className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-2">
          <SetupOption value="free" icon={Bot} label={t('model.free')} hint={t('model.freeDescription')} selected={choice === 'free'} />
          <SetupOption value="custom" icon={KeyRound} label={t('model.custom')} hint={t('model.customDescription')} selected={choice === 'custom'} />
        </ToggleGroup>

        {choice === 'custom' && <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
          <p className="px-1 text-sm text-muted-foreground">{t('model.settingsSavedFocusedHint')}</p>
          {selectableModels.length > 0 && <FieldGroup>
            <Field>
              <FieldTitle>{modelText('mainModel')}</FieldTitle>
              <ModelSelect modelKey="primaryModel" configs={customConfigs} value={selectedKey} persistSelection={false}
                onValueChange={setChosenModel} />
            </Field>
          </FieldGroup>}
          <AiSettings mobile={mobile} embedded />
        </fieldset>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      </div>
      <SetupStepActions onBack={onBack} nextLabel={t('model.save')}
        onNext={() => void continueSetup()} busy={saving} disableNext={choice === 'custom' && !selectedModel} />
    </div>
  )
}
