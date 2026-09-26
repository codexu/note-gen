'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { LockKeyhole } from 'lucide-react'
import { readAppLock, saveAppLock, verifyAppLock } from '@/lib/app-lock'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from '@/components/responsive-dialog'
import { SettingSection } from '../components/setting-base'

export function AppLockSettings() {
  const t = useTranslations('appLock')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const submitting = useRef(false)

  async function load() {
    setError('')
    try { setEnabled(!!await readAppLock()) } catch { setError(t('error')) }
  }

  useEffect(() => { if (isTauri()) void load() }, [])

  function resetDialog() {
    setPassword('')
    setConfirmation('')
    setError('')
  }

  function changeDialogState(nextOpen: boolean) {
    if (busy) return
    setOpen(nextOpen)
    if (!nextOpen) resetDialog()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || enabled === null) return
    setError('')
    setMessage('')
    if (!enabled && (password.length < 4 || password !== confirmation)) {
      setError(t(password.length < 4 ? 'minimumLength' : 'mismatch'))
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      // Re-read so another window cannot replace an enabled lock without verification.
      const credential = await readAppLock()
      if (!!credential !== enabled) {
        setEnabled(!!credential)
        resetDialog()
        setError(t('changed'))
        return
      }
      if (credential && !await verifyAppLock(password, credential)) {
        setError(t('wrongPassword'))
        setPassword('')
        return
      }
      await saveAppLock(enabled ? null : password)
      setEnabled(!enabled)
      setMessage(t(enabled ? 'disabled' : 'enabled'))
      setOpen(false)
      resetDialog()
    } catch {
      setError(t('error'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (!isTauri()) return null

  return (
    <SettingSection title={t('sectionTitle')} desc={t('description')}>
      <Item variant="outline">
        <ItemMedia variant="icon"><LockKeyhole /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('title')}</ItemTitle>
          <ItemDescription>{enabled === null ? t(error ? 'error' : 'loading') : t(enabled ? 'statusEnabled' : 'statusDisabled')}</ItemDescription>
          {message && <ItemDescription role="status">{message}</ItemDescription>}
        </ItemContent>
        <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
          {enabled === null ? (
            <Button variant="outline" disabled={!error} onClick={() => void load()}>{t(error ? 'retry' : 'loading')}</Button>
          ) : (
            <Button variant="outline" disabled={busy}
              onClick={() => { resetDialog(); setMessage(''); setOpen(true) }}>
              {enabled ? t('disable') : t('configure')}
            </Button>
          )}
        </ItemActions>
      </Item>

      <Dialog open={open} onOpenChange={changeDialogState}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(enabled ? 'disableTitle' : 'configureTitle')}</DialogTitle>
            <DialogDescription>{t(enabled ? 'disableDescription' : 'setupDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="app-lock-password">{t(enabled ? 'currentPassword' : 'newPassword')}</FieldLabel>
                <Input id="app-lock-password" type="password" autoComplete={enabled ? 'current-password' : 'new-password'}
                  minLength={enabled ? undefined : 4} value={password}
                  onChange={event => setPassword(event.target.value)} required disabled={busy}
                  aria-invalid={!!error} aria-describedby={error ? 'app-lock-error' : undefined} />
              </Field>
              {!enabled && (
                <Field data-invalid={!!error}>
                  <FieldLabel htmlFor="app-lock-confirmation">{t('confirmPassword')}</FieldLabel>
                  <Input id="app-lock-confirmation" type="password" autoComplete="new-password" minLength={4}
                    value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy}
                    aria-invalid={!!error} aria-describedby={error ? 'app-lock-error' : undefined} />
                </Field>
              )}
              {error && <FieldError id="app-lock-error">{error}</FieldError>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => changeDialogState(false)}>{t('cancel')}</Button>
                <Button type="submit" disabled={busy || !password || (!enabled && !confirmation)}>
                  {t(busy ? 'working' : enabled ? 'disable' : 'enable')}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </SettingSection>
  )
}
