'use client'

import { FileText } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const FORMAT_GROUPS = [
  { label: 'Word', extensions: 'DOC · DOCX · DOCM' },
  { label: 'Excel', extensions: 'XLS · XLSX · XLSM · XLSB' },
  { label: 'PowerPoint', extensions: 'PPT · PPTX · PPTM · PPS · PPSX · PPSM · POT' },
  { label: 'OpenDocument', extensions: 'ODT · ODS · ODP' },
]

interface DocumentToMarkdownDialogProps {
  open: boolean
  importing: boolean
  onOpenChange: (open: boolean) => void
  onSelect: () => void
}

export function DocumentToMarkdownDialog({
  open,
  importing,
  onOpenChange,
  onSelect,
}: DocumentToMarkdownDialogProps) {
  const t = useTranslations('article.file.toolbar')

  const handleSelect = () => {
    onOpenChange(false)
    onSelect()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('convertDialogTitle')}</DialogTitle>
          <DialogDescription>{t('convertDialogDescription')}</DialogDescription>
        </DialogHeader>

        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 w-32">{t('convertTypeColumn')}</TableHead>
              <TableHead className="h-8">{t('convertExtensions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FORMAT_GROUPS.map(format => (
              <TableRow key={format.label}>
                <TableCell className="py-1.5 font-medium text-foreground">{format.label}</TableCell>
                <TableCell className="py-1.5 whitespace-normal text-muted-foreground">{format.extensions}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="py-1.5 font-medium text-foreground">{t('convertOtherDocuments')}</TableCell>
              <TableCell className="py-1.5 whitespace-normal text-muted-foreground">PDF · RTF · EPUB · CSV</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{t('convertCancel')}</Button>
          </DialogClose>
          <Button type="button" onClick={handleSelect} disabled={importing}>
            <FileText data-icon="inline-start" />
            {t('convertChooseDocuments')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
