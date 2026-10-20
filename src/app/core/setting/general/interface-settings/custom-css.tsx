'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Code2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { SourceMarkdownEditor } from '@/app/core/main/editor/markdown/source-markdown-editor'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from '@/components/responsive-dialog'
import useSettingStore from '@/stores/setting'

export function CustomCssSettings() {
  const t = useTranslations('settings.general.interface.customCss')
  const customCss = useSettingStore(state => state.customCss)
  const setCustomCss = useSettingStore(state => state.setCustomCss)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const onOpenChange = (next: boolean) => {
    if (saving) return
    if (next) setDraft(customCss)
    setOpen(next)
  }

  const save = async (css: string) => {
    if (saving) return
    setSaving(true)
    try {
      if (css !== customCss) await setCustomCss(css)
      setOpen(false)
    } catch {
      toast.error(t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void save(draft)
  }

  return (
    <>
      <Item variant="outline">
        <ItemMedia variant="icon"><Code2 /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('title')}</ItemTitle>
          <ItemDescription>{t('desc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>{t('button')}</Button>
        </ItemActions>
      </Item>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] min-h-0 flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDesc')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="h-[min(50vh,28rem)] min-h-48 overflow-hidden rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <SourceMarkdownEditor
                language="css"
                value={draft}
                onChange={setDraft}
                placeholder={t('placeholder')}
                editable={!saving}
                showLineNumbers
                lineWrapping
                fontSize={13}
                lineHeight={1.5}
                ariaLabel={t('title')}
              />
            </div>
            <DialogFooter className="shrink-0">
              <Button type="button" variant="outline" disabled={saving} onClick={() => void save('')}>{t('reset')}</Button>
              <Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || draft === customCss}>{t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
