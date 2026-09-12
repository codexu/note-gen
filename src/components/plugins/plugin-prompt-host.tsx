'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { finishPluginPrompt, usePluginUiStore } from '@/lib/plugins/ui-registry'

function PromptContent({ prompt }: { prompt: NonNullable<ReturnType<typeof usePluginUiStore.getState>['prompt']> }) {
  const t = useTranslations('settings.plugins.ui')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const options = prompt.options
  const choices = options.type === 'select' ? options.options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : []
  return <DialogContent>
    <DialogHeader>
      <DialogTitle>{options.title}</DialogTitle>
      <DialogDescription>{options.description ?? prompt.pluginId}</DialogDescription>
    </DialogHeader>
    {options.type === 'select' ? <FieldGroup>
      <Field><FieldLabel htmlFor={`${prompt.id}-search`}>{t('searchChoices')}</FieldLabel><Input id={`${prompt.id}-search`} value={query} onChange={event => setQuery(event.target.value)} /></Field>
      <div className="flex max-h-[40vh] flex-col gap-2 overflow-auto">
        {choices.map((option, index) => <Field key={option.value} orientation="horizontal">
          <Checkbox id={`${prompt.id}-choice-${index}`} checked={selected.includes(option.value)} onCheckedChange={checked => {
            setSelected(current => checked ? options.multiple ? [...current.filter(value => value !== option.value), option.value] : [option.value] : current.filter(value => value !== option.value))
          }} />
          <FieldLabel htmlFor={`${prompt.id}-choice-${index}`}>{option.label}</FieldLabel>
        </Field>)}
        {!choices.length ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : null}
      </div>
    </FieldGroup> : null}
    <DialogFooter>
      <Button variant="outline" onClick={() => finishPluginPrompt(prompt.id, null)}>{t('cancelPrompt')}</Button>
      <Button disabled={options.type === 'select' && !options.multiple && !selected.length} onClick={() => finishPluginPrompt(prompt.id, options.type === 'confirm' ? true : selected)}>{options.confirmLabel ?? t('confirmPrompt')}</Button>
    </DialogFooter>
  </DialogContent>
}

export function PluginPromptHost() {
  const prompt = usePluginUiStore(state => state.prompt)
  return <Dialog open={Boolean(prompt)} onOpenChange={open => { if (!open && prompt) finishPluginPrompt(prompt.id, null) }}>
    {prompt ? <PromptContent key={prompt.id} prompt={prompt} /> : null}
  </Dialog>
}
