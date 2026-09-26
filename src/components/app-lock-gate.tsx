'use client'

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react'
import Image from 'next/image'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslations } from 'next-intl'
import { isAppLockRemembered, readAppLock, setAppLockRemembered, verifyAppLock } from '@/lib/app-lock'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CloseBehaviorGuard } from '@/components/close-behavior-guard'

export function AppLockGate({ children }: { children: ReactNode }) {
  const t = useTranslations('appLock')
  const [state, setState] = useState<'loading' | 'locked' | 'open' | 'error'>('loading')
  const [password, setPassword] = useState('')
  const [rememberForDay, setRememberForDay] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)

  async function initialize() {
    setState('loading')
    try {
      // Print windows are created by an already-unlocked editor and run hidden.
      if (!isTauri() || getCurrentWindow().label.startsWith('pdf-print-')) {
        setState('open')
        return
      }
      const credential = await readAppLock()
      setState(!credential || await isAppLockRemembered() ? 'open' : 'locked')
    } catch {
      setState('error')
    }
  }

  useEffect(() => { void initialize() }, [])
  useEffect(() => {
    if (state === 'locked' && !busy) input.current?.focus()
  }, [state, busy])

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const credential = await readAppLock()
      if (credential && await verifyAppLock(password, credential)) {
        await setAppLockRemembered(rememberForDay)
        setPassword('')
        setState('open')
      } else if (credential) {
        setPassword('')
        setError(t('wrongPassword'))
      } else {
        setState('open')
      }
    } catch {
      setError(t('error'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (state === 'open') return children

  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto bg-background p-6 text-foreground">
      {isTauri() && getCurrentWindow().label === 'main' && <CloseBehaviorGuard />}
      <Card className="my-auto w-full max-w-md overflow-hidden border-foreground/10 shadow-xl shadow-foreground/5">
        <CardHeader className="items-center gap-4 px-8 pt-10 text-center sm:px-10 sm:pt-12">
          <Image src="/app-icon.png" alt="NoteGen" width={64} height={64}
            className="size-16 rounded-2xl shadow-sm dark:invert" priority />
          <div className="flex flex-col items-center gap-2">
            <CardTitle className="text-2xl tracking-tight">{t('title')}</CardTitle>
            <CardDescription className="max-w-xs leading-relaxed">
              {state === 'loading' ? t('loading') : t('unlockDescription')}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-8 pb-9 sm:px-10">
          {state === 'error' ? (
            <FieldGroup>
              <FieldError>{t('error')}</FieldError>
              <Button onClick={() => void initialize()}>{t('retry')}</Button>
            </FieldGroup>
          ) : state === 'locked' ? (
            <form onSubmit={unlock}>
              <FieldGroup className="gap-5">
                <Field data-invalid={!!error}>
                  <FieldLabel htmlFor="unlock-password">{t('password')}</FieldLabel>
                  <Input ref={input} id="unlock-password" type="password" autoComplete="current-password"
                    className="h-11"
                    value={password} onChange={event => setPassword(event.target.value)} required disabled={busy}
                    aria-invalid={!!error} aria-describedby={error ? 'unlock-error' : undefined} />
                  {error && <FieldError id="unlock-error">{error}</FieldError>}
                </Field>
                <Field orientation="horizontal" data-disabled={busy || undefined}>
                  <Checkbox id="remember-for-day" checked={rememberForDay} disabled={busy}
                    onCheckedChange={checked => setRememberForDay(checked === true)} />
                  <FieldContent>
                    <FieldLabel htmlFor="remember-for-day" className="cursor-pointer">{t('rememberForDay')}</FieldLabel>
                    <FieldDescription>{t('rememberForDayDescription')}</FieldDescription>
                  </FieldContent>
                </Field>
                <Button type="submit" className="h-11 w-full" disabled={busy || !password}>
                  {t(busy ? 'working' : 'unlock')}
                </Button>
              </FieldGroup>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
