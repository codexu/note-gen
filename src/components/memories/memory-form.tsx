'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@/components/ui/item'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import useMemoriesStore from '@/stores/memories'
import useSettingStore from '@/stores/setting'
import { containsPotentialSecret } from '@/lib/memory/safety'
import type { Memory, MemoryKind, MemoryScopeType } from '@/db/memories'

interface MemoryFormProps {
  memory?: Memory
  onSuccess?: () => void
}

export function MemoryForm({ memory, onSuccess }: MemoryFormProps) {
  const t = useTranslations('settings.memories')
  const [content, setContent] = useState(memory?.content || '')
  const [kind, setKind] = useState<MemoryKind>(memory?.kind || 'preference')
  const [scopeType, setScopeType] = useState<MemoryScopeType>(memory?.scopeType || 'global')
  const [alwaysApply, setAlwaysApply] = useState(memory?.applyMode === 'always')
  const [submitting, setSubmitting] = useState(false)
  const { addMemory, updateMemory } = useMemoriesStore()
  const workspacePath = useSettingStore(state => state.workspacePath)
  const sensitive = containsPotentialSecret(content)

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      toast.error(t('errorEmpty'))
      return
    }

    setSubmitting(true)
    try {
      const scopeId = scopeType === 'workspace'
        ? workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '') || 'default'
        : undefined
      if (memory) {
        await updateMemory(memory.id, {
          content: trimmed,
          kind,
          scopeType,
          scopeId,
          applyMode: alwaysApply ? 'always' : 'relevant',
          sensitivity: sensitive ? 'suspected_sensitive' : 'normal',
          status: sensitive ? 'pending' : memory.status,
        })
        toast.success(t('updated'))
      } else {
        const result = await addMemory({
          content: trimmed,
          kind,
          scopeType,
          scopeId,
          applyMode: alwaysApply ? 'always' : 'relevant',
          origin: 'manual',
          sensitivity: sensitive ? 'suspected_sensitive' : 'normal',
          status: sensitive ? 'pending' : 'active',
        })
        toast.success(
          sensitive
            ? t('savedPendingReview')
            : result.indexingStatus === 'pending'
              ? t('savedPendingIndex')
              : t('saved')
        )
      }
      onSuccess?.()
    } catch (error) {
      toast.error(t('errorSave'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <FieldGroup>
      {sensitive && (
        <Alert variant="destructive">
          <AlertTitle>{t('sensitive.title')}</AlertTitle>
          <AlertDescription>{t('sensitive.description')}</AlertDescription>
        </Alert>
      )}

      <Field data-invalid={!content.trim()}>
        <FieldLabel htmlFor="memory-content">{t('form.contentLabel')}</FieldLabel>
        <Textarea
          id="memory-content"
          value={content}
          onChange={event => setContent(event.target.value)}
          placeholder={t('form.contentPlaceholder')}
          rows={4}
          maxRows={10}
          aria-invalid={!content.trim()}
        />
      </Field>

      <Field orientation="responsive">
        <FieldLabel htmlFor="memory-kind">{t('form.kindLabel')}</FieldLabel>
        <ResponsiveSelect
          id="memory-kind"
          title={t('form.kindLabel')}
          className="h-11 md:h-10"
          value={kind}
          onValueChange={value => setKind(value as MemoryKind)}
          options={[
            { value: 'preference', label: t('kinds.preference') },
            { value: 'fact', label: t('kinds.fact') },
            { value: 'experience', label: t('kinds.experience') },
            { value: 'decision', label: t('kinds.decision') },
          ]}
        />
      </Field>

      <Field orientation="responsive">
        <FieldLabel htmlFor="memory-scope">{t('form.scopeLabel')}</FieldLabel>
        <ResponsiveSelect
          id="memory-scope"
          title={t('form.scopeLabel')}
          className="h-11 md:h-10"
          value={scopeType}
          onValueChange={value => setScopeType(value as MemoryScopeType)}
          options={[
            { value: 'global', label: t('scopes.global') },
            { value: 'workspace', label: t('scopes.workspace') },
          ]}
        />
      </Field>

      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{t('form.alwaysApply')}</ItemTitle>
          <ItemDescription>{t('form.alwaysApplyDescription')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            id="memory-always-apply"
            aria-label={t('form.alwaysApply')}
            checked={alwaysApply}
            onCheckedChange={setAlwaysApply}
          />
        </ItemActions>
      </Item>

      <Button className="h-11 md:h-auto" onClick={handleSubmit} disabled={submitting || !content.trim()}>
        {submitting && <Spinner data-icon="inline-start" />}
        {memory ? t('form.update') : t('form.save')}
      </Button>
    </FieldGroup>
  )
}
