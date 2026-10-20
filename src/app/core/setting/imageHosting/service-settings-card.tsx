'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle, Eye, EyeOff, Loader2, RefreshCcw, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from '@/components/ui/item'
import { SyncStateEnum } from '@/lib/sync/github.types'

export function ServiceSettingsCard({
  title,
  description,
  state,
  onTest,
  canTest,
  statusMode = 'connection',
  children,
}: {
  title: string
  description: string
  state: SyncStateEnum
  onTest?: () => Promise<void>
  canTest: boolean
  statusMode?: 'connection' | 'configuration'
  children: React.ReactNode
}) {
  const t = useTranslations('settings.imageHosting.common')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>{t('status')}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ConnectionStatus state={state} mode={statusMode} />
            </ItemActions>
          </Item>
          {children}
        </FieldGroup>
      </CardContent>
      {onTest ? (
        <CardFooter>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canTest || state === SyncStateEnum.checking}
            onClick={() => void onTest()}
          >
            {state === SyncStateEnum.checking ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <RefreshCcw data-icon="inline-start" />
            )}
            {t('testConnection')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

export function ConnectionStatus({
  state,
  mode = 'connection',
}: {
  state: SyncStateEnum
  mode?: 'connection' | 'configuration'
}) {
  const t = useTranslations('settings.imageHosting.status')

  if (state === SyncStateEnum.success) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <CheckCircle className="size-4 text-primary" />
        {mode === 'configuration' ? t('configured') : t('connected')}
      </span>
    )
  }

  if (state === SyncStateEnum.checking || state === SyncStateEnum.creating) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        {t('checking')}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      <XCircle className="size-4 text-muted-foreground" />
      {t('disconnected')}
    </span>
  )
}

export function SecretInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <InputGroupButton
        type="button"
        size="icon-xs"
        aria-label={visible ? 'Hide value' : 'Show value'}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff /> : <Eye />}
      </InputGroupButton>
    </InputGroup>
  )
}

export function useInitialConnectionTest({
  loaded,
  canTest,
  test,
}: {
  loaded: boolean
  canTest: boolean
  test: () => Promise<void>
}) {
  const tested = useRef(false)

  useEffect(() => {
    if (!loaded || !canTest || tested.current) return
    tested.current = true
    void test()
  }, [canTest, loaded, test])
}
