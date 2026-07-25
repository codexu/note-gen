'use client'

import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { SyImportProgress, SyImportResult } from '@/lib/import/siyuan'
import { CheckCircle2, LoaderCircle } from 'lucide-react'

type SiYuanImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  isImporting: boolean
  progress: SyImportProgress | null
  report: SyImportResult | null
  onCancel?: () => void
}

function getProgressValue(progress: SyImportProgress | null): number {
  if (!progress || progress.total <= 0) {
    return 0
  }
  return Math.min(100, Math.round((progress.current / progress.total) * 100))
}

export function SiYuanImportDialog({
  open,
  onOpenChange,
  isImporting,
  progress,
  report,
  onCancel,
}: SiYuanImportDialogProps) {
  const t = useTranslations('article.file.siyuanImport')

  const phaseLabel = progress
    ? t(`phase.${progress.phase}`, { current: progress.current, total: progress.total })
    : t('phase.planning', { current: 0, total: 0 })

  const canClose = !isImporting

  return (
    <Dialog open={open} onOpenChange={canClose ? onOpenChange : undefined}>
      <DialogContent showCloseButton={canClose} className="max-w-xl">
        {isImporting ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" />
                {t('titleImporting')}
              </DialogTitle>
              <DialogDescription>{phaseLabel}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <Progress value={getProgressValue(progress)} />
              {progress?.currentTitle ? (
                <p className="truncate text-xs text-muted-foreground">{progress.currentTitle}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                {t('cancel')}
              </Button>
            </DialogFooter>
          </>
        ) : report ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-green-600" />
                {t('titleReport')}
              </DialogTitle>
              <DialogDescription>{t('reportDescription')}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-3">
              <ReportStat label={t('stats.total')} value={report.totalDocuments} />
              <ReportStat label={t('stats.success')} value={report.successCount} />
              <ReportStat label={t('stats.failed')} value={report.failedCount} />
              <ReportStat label={t('stats.degraded')} value={report.degradedCount} />
              <ReportStat label={t('stats.unsupported')} value={report.unsupportedCount} />
              <ReportStat label={t('stats.notebooks')} value={report.notebookCount} />
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>{t('reportSummary', {
                total: report.totalDocuments,
                success: report.successCount,
                failed: report.failedCount,
                degraded: report.degradedCount,
                unsupported: report.unsupportedCount,
                assets: report.assetCount,
              })}</p>
              {(report.degradedIssueCount > 0 || report.unsupportedIssueCount > 0) ? (
                <p className="mt-2">
                  {t('issueSummary', {
                    degradedIssues: report.degradedIssueCount,
                    unsupportedIssues: report.unsupportedIssueCount,
                  })}
                </p>
              ) : null}
            </div>

            {report.degradedIssuesSummary.length > 0 ? (
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-medium">{t('degradedBreakdownTitle')}</p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {report.degradedIssuesSummary.map(item => (
                    <li key={item.code}>
                      {t(`issues.${item.code}`, {
                        count: item.count,
                        omittedRows: item.omittedRows ?? 0,
                        omittedColumns: item.omittedColumns ?? 0,
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {report.documents.some(document => document.status !== 'success') ? (
              <ScrollArea className="max-h-48 rounded-lg border">
                <div className="space-y-2 p-3">
                  {report.documents
                    .filter(document => document.status !== 'success')
                    .slice(0, 30)
                    .map(document => (
                      <div key={`${document.syPath}-${document.status}`} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{document.title}</span>
                          <span className="shrink-0 text-muted-foreground">{t(`status.${document.status}`)}</span>
                        </div>
                        {document.errorMessage ? (
                          <p className="truncate text-muted-foreground">{document.errorMessage}</p>
                        ) : null}
                        {document.issues.length > 0 ? (
                          <ul className="mt-1 list-inside list-disc text-muted-foreground">
                            {document.issues.map(issue => (
                              <li key={issue.code}>
                            {t(`issues.${issue.code}`, {
                              count: issue.count,
                              omittedRows: issue.omittedRows ?? 0,
                              omittedColumns: issue.omittedColumns ?? 0,
                            })}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                </div>
              </ScrollArea>
            ) : null}

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('close')}</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ReportStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
