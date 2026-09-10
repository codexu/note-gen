'use client'

import { create } from 'zustand'
import { useState, type ComponentProps, type ReactNode } from 'react'
import type { PluginCommandArgument, PluginActionConfirmation } from '@notegen/plugin-api'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { executePluginCommand } from '@/lib/plugins/command-registry'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

const usePendingActions = create<{ commands: ReadonlySet<string> }>(() => ({ commands: new Set() }))

export function PluginAction({ command, argument, children, disabled, variant = 'default', size = 'sm', onExecuted, confirmation, label }: {
  command: string
  confirmation?: PluginActionConfirmation
  label?: string
  argument?: PluginCommandArgument
  children: ReactNode
  disabled?: boolean
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  onExecuted?: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const t = useTranslations('settings.plugins')
  const busy = usePendingActions(state => state.commands.has(command))
  async function run(confirmed = false) {
    if (disabled || usePendingActions.getState().commands.has(command)) return
    if (confirmation && !confirmed) { setConfirmOpen(true); return }
    usePendingActions.setState(state => ({ commands: new Set([...state.commands, command]) }))
    try { await executePluginCommand(command, argument); onExecuted?.() }
    catch (error) {
      const permissionDenied = typeof error === 'object' && error !== null && 'code' in error && error.code === 'PermissionDenied'
      toast.error(permissionDenied ? t('ux.permissionNeeded') : t('installed.operationFailed'), {
        description: error instanceof Error ? error.message : String(error),
        action: { label: t('ux.managePlugin'), onClick: () => useSettingsDialogStore.getState().openSettings('plugins') },
      })
    }
    finally {
      usePendingActions.setState(state => {
        const commands = new Set(state.commands)
        commands.delete(command)
        return { commands }
      })
    }
  }
  return <><Button type="button" variant={variant} size={size} disabled={disabled || busy} aria-busy={busy} aria-label={label} title={label} onClick={() => void run()}>{busy ? <Spinner data-icon="inline-start" /> : null}{children}</Button>{confirmation ? <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation.title}</AlertDialogTitle><AlertDialogDescription>{confirmation.description ?? confirmation.title}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{confirmation.cancelLabel}</AlertDialogCancel><AlertDialogAction onClick={() => void run(true)}>{confirmation.confirmLabel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : null}</>
}
