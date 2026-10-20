import { CircleAlert, CloudCheck, CloudDownload, CloudUpload, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import type { FileTreeSyncStatus } from './file-tree-action-policy'

export function FileTreeDecorations({
  iconSize,
  knowledge,
  syncStatus,
  syncTitle,
  alwaysShowSynced = false,
}: {
  iconSize: string
  knowledge?: ReactNode
  syncStatus: FileTreeSyncStatus
  syncTitle: string
  alwaysShowSynced?: boolean
}) {
  const syncDecoration = (() => {
    if (syncStatus === 'loading') {
      return <LoaderCircle className={`${iconSize} animate-spin text-muted-foreground`} />
    }
    if (syncStatus === 'error') {
      return <CircleAlert className={`${iconSize} text-destructive`} />
    }
    if (syncStatus === 'dirty') {
      return <CloudUpload className={`${iconSize} text-muted-foreground`} />
    }
    if (syncStatus === 'remote-only') {
      return <CloudDownload className={`${iconSize} text-muted-foreground`} />
    }
    if (syncStatus === 'synced') {
      return (
        <CloudCheck
          className={alwaysShowSynced
            ? `${iconSize} text-muted-foreground`
            : `${iconSize} text-muted-foreground opacity-0 transition-opacity group-hover:opacity-40`}
        />
      )
    }
    return null
  })()

  return (
    <span className="ml-auto flex min-w-5 shrink-0 items-center justify-end gap-1 pr-1">
      {knowledge}
      {syncDecoration ? (
        <span
          className="inline-flex shrink-0 items-center justify-center"
          aria-label={syncTitle}
          title={syncTitle}
        >
          {syncDecoration}
        </span>
      ) : null}
    </span>
  )
}
