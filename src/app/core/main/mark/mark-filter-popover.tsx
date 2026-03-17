"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Filter } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toggle } from "@/components/ui/toggle"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import useMarkStore, { RecordTimePreset } from "@/stores/mark"
import useTagStore from "@/stores/tag"
import type { Mark } from "@/db/marks"
import { cn } from "@/lib/utils"

const TYPE_OPTIONS: Mark["type"][] = ['text', 'recording', 'scan', 'image', 'link', 'file', 'todo']
const TIME_OPTIONS: RecordTimePreset[] = ['all', 'today', 'last7Days', 'last30Days']

export function MarkFilterPopover() {
  const [open, setOpen] = useState(false)
  const t = useTranslations('record.mark')
  const {
    recordFilters,
    setRecordSearch,
    toggleRecordType,
    setRecordTimePreset,
    setRecordTagId,
    resetRecordFilters,
    hasActiveRecordFilters,
  } = useMarkStore()
  const { tags } = useTagStore()

  const isActive = hasActiveRecordFilters()

  const handleClear = () => {
    resetRecordFilters()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isActive ? "default" : "ghost"}
          size="icon"
          className="relative"
          title={t('toolbar.filter.title')}
          aria-label={t('toolbar.filter.title')}
        >
          <Filter className="h-4 w-4" />
          {isActive ? (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-background" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor="record-filter-search">{t('toolbar.filter.search')}</Label>
          <Input
            id="record-filter-search"
            value={recordFilters.search}
            onChange={(event) => setRecordSearch(event.target.value)}
            placeholder={t('toolbar.filter.searchPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('toolbar.filter.type')}</Label>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((type) => (
              <Toggle
                key={type}
                pressed={recordFilters.selectedTypes.includes(type)}
                onPressedChange={() => toggleRecordType(type)}
                variant="outline"
                size="sm"
                aria-label={t(`toolbar.${type}`)}
              >
                {t(`toolbar.${type}`)}
              </Toggle>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('toolbar.filter.time')}</Label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/35 p-1">
            {TIME_OPTIONS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRecordTimePreset(preset)}
                className={cn(
                  "h-8 justify-center rounded-md px-2 text-xs",
                  recordFilters.timePreset === preset
                    ? "bg-background shadow-sm text-foreground hover:bg-background"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                )}
              >
                {t(`toolbar.filter.timeOptions.${preset}`)}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('toolbar.filter.tag')}</Label>
          <Select
            value={String(recordFilters.tagId)}
            onValueChange={(value) => setRecordTagId(value === 'all' ? 'all' : Number(value))}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('toolbar.filter.allTags')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('toolbar.filter.allTags')}</SelectItem>
              {tags.map((tag) => (
                <SelectItem key={tag.id} value={String(tag.id)}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!isActive}
          >
            {t('toolbar.filter.clear')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
