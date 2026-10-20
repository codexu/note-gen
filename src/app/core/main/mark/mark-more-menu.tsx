"use client"

import {
  EllipsisVertical,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  LayoutGrid,
  List,
  ListChecks,
  Rows3,
  Shapes,
  SquareCheckBig,
  Trash2,
  XCircle,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useMarkStore from "@/stores/mark"
import useSettingStore from "@/stores/setting"
import type { RecordSortMode, RecordViewMode } from "@/lib/record-display-preferences"

type MarkMoreMenuProps = {
  trashState: boolean
  onToggleTrash: () => void
}

export function MarkMoreMenu({ trashState, onToggleTrash }: MarkMoreMenuProps) {
  const t = useTranslations('record.mark.toolbar')
  const {
    marks,
    visibleMarkIds,
    isMultiSelectMode,
    selectedMarkIds,
    setSelectedMarkIds,
    selectAll,
    clearSelection,
    setMultiSelectMode,
  } = useMarkStore()
  const {
    recordViewMode,
    setRecordViewMode,
    recordSortMode,
    setRecordSortMode,
  } = useSettingStore()
  const visibleCount = visibleMarkIds.length > 0 ? visibleMarkIds.length : marks.length
  const isAllSelected = visibleCount > 0 && selectedMarkIds.size === visibleCount

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedMarkIds(new Set())
    } else {
      selectAll()
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="focus-visible:border-transparent focus-visible:ring-0"
          aria-label={t('more')}
          title={t('more')}
        >
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('sort.title')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={recordSortMode}
            onValueChange={(value) => void setRecordSortMode(value as RecordSortMode)}
          >
            <DropdownMenuRadioItem value="newest">
              <ArrowDownNarrowWide />
              {t('sort.newest')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="oldest">
              <ArrowUpNarrowWide />
              {t('sort.oldest')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="type">
              <Shapes />
              {t('sort.type')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('view.title')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={recordViewMode}
            onValueChange={(value) => void setRecordViewMode(value as RecordViewMode)}
          >
            <DropdownMenuRadioItem value="list">
              <List />
              {t('view.list')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="compact">
              <Rows3 />
              {t('view.compact')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="cards">
              <LayoutGrid />
              {t('view.cards')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {isMultiSelectMode ? (
            <>
              <DropdownMenuItem onSelect={handleSelectAll} disabled={marks.length === 0}>
                <ListChecks />
                {isAllSelected ? t('deselectAll') : t('selectAll')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={clearSelection}>
                <XCircle />
                {t('exitMultiSelect')}
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => setMultiSelectMode(true)} disabled={marks.length === 0}>
              <SquareCheckBig />
              {t('multiSelect')}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onToggleTrash}>
            {trashState ? <XCircle /> : <Trash2 />}
            {trashState ? t('closeTrash') : t('trash')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
