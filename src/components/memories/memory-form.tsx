'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import useMemoriesStore from '@/stores/memories'
import { toast } from '@/hooks/use-toast'

interface MemoryFormProps {
  onSuccess?: () => void
}

export function MemoryForm({ onSuccess }: MemoryFormProps) {
  const t = useTranslations('settings.memories')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<'preference' | 'knowledge'>('preference')
  const [submitting, setSubmitting] = useState(false)
  const { addMemory } = useMemoriesStore()

  const handleSubmit = async () => {
    if (!content.trim()) {
      toast({
        title: t('error'),
        description: t('errorEmpty'),
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      await addMemory(content, category)
      setContent('')
      toast({
        title: t('success'),
        description: t('saved'),
      })
      onSuccess?.()
    } catch (error) {
      toast({
        title: t('error'),
        description: t('errorSave') + `: ${error}`,
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="memory-content">{t('form.contentLabel')}</Label>
        <Textarea
          id="memory-content"
          placeholder={t('form.contentPlaceholder')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
        />
      </div>

      <div>
        <Label>{t('form.categoryLabel')}</Label>
        <RadioGroup value={category} onValueChange={(v) => setCategory(v as 'preference' | 'knowledge')}>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="preference" id="preference" />
            <Label htmlFor="preference">{t('form.preferenceDesc')}</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="knowledge" id="knowledge" />
            <Label htmlFor="knowledge">{t('form.knowledgeDesc')}</Label>
          </div>
        </RadioGroup>
      </div>

      <Button onClick={handleSubmit} disabled={submitting || !content.trim()}>
        {submitting ? t('form.saving') : t('form.save')}
      </Button>
    </div>
  )
}
