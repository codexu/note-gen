'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { useTranslations } from 'next-intl'

/** Choices are supplied by the plugin through its existing notes.list grants. */
export function PluginNotePicker({ id, label, options, value, disabled, invalid, describedBy, onChange }: {
  id: string; label: string; options: readonly { label: string; value: string }[]; value: string
  disabled: boolean; invalid: boolean; describedBy?: string; onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('settings.plugins.ui')
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled} className="w-full justify-between">
    <span className="truncate">{options.find(option => option.value === value)?.label ?? label}</span><ChevronsUpDown />
  </Button></PopoverTrigger><PopoverContent className="p-0" align="start"><Command><CommandInput placeholder={label} /><CommandList><CommandEmpty>{t('empty')}</CommandEmpty><CommandGroup>{options.map(option => <CommandItem key={option.value} value={option.value} keywords={[option.label]} onSelect={() => { onChange(option.value); setOpen(false) }}><span className="min-w-0 flex-1 truncate">{option.label}</span>{option.value === value ? <Check /> : null}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>
}
