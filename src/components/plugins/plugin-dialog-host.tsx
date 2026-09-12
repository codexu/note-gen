'use client'

import { PluginPromptHost } from './plugin-prompt-host'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PluginDeclarativeUi } from '@/components/plugins/plugin-declarative-ui'
import { dismissPluginDialog, usePluginUiStore } from '@/lib/plugins/ui-registry'
import { useTranslations } from 'next-intl'

export function PluginDialogHost() {
  const t = useTranslations('settings.plugins.ui')
  const dialog = usePluginUiStore((state) => state.dialog)
  return <><PluginPromptHost /><Dialog key={dialog?.id ?? 'closed'} open={Boolean(dialog)} onOpenChange={(open) => { if (!open && dialog) dismissPluginDialog(dialog.id) }}>
    {dialog ? <DialogContent>
      <DialogHeader><DialogTitle>{dialog.title}</DialogTitle><DialogDescription className={dialog.description ? undefined : 'sr-only'}>{dialog.description ?? dialog.title}</DialogDescription></DialogHeader>
      <div className="min-w-0 max-h-[60vh] overflow-y-auto"><PluginDeclarativeUi scope={`${dialog.pluginId}:dialog:${dialog.id}`} document={dialog.content} /></div>
      <DialogFooter><Button variant="outline" onClick={() => dismissPluginDialog(dialog.id)}>{dialog.closeLabel ?? t('close')}</Button></DialogFooter>
    </DialogContent> : null}
  </Dialog></>
}
