'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { cn } from '@/lib/utils'

export const PluginSettingsLayoutContext = createContext(false)
export const usePluginSettingsLayout = () => useContext(PluginSettingsLayoutContext)

/** Shared setting row for manifest settings and runtime plugin forms. */
export function PluginSettingsRow({ id, title, description, descriptionId, error, errorId, metadata, disabled, invalid, wide, toggle, children }: {
  id: string; title: ReactNode; description?: ReactNode; descriptionId?: string
  error?: ReactNode; errorId?: string; metadata?: ReactNode
  disabled?: boolean; invalid?: boolean; wide?: boolean; toggle?: boolean; children: ReactNode
}) {
  return <Field data-invalid={invalid || Boolean(error)} data-disabled={disabled}>
    <Item variant="outline">
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none break-words"><FieldLabel htmlFor={id}>{title}</FieldLabel></ItemTitle>
        {description ? <ItemDescription id={descriptionId} className="line-clamp-none whitespace-pre-wrap break-words">{description}</ItemDescription> : null}
        {metadata}
        <FieldError id={errorId}>{error}</FieldError>
      </ItemContent>
      <ItemActions className={cn('min-w-0', wide ? 'w-full basis-full [&>*]:w-full' : toggle ? 'ml-auto' : 'w-full basis-full sm:ml-auto sm:w-64 sm:basis-auto [&>[data-slot=select-trigger]]:w-full')}>
        {children}
      </ItemActions>
    </Item>
  </Field>
}
