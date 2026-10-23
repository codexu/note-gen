import { ChevronRight } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import useSettingStore from '@/stores/setting'
import useFileDeletionStore, { isFileDeletionPending } from '@/stores/file-deletion'

export function FileTreeRenameProgress({
  name,
  label,
  icon,
  className,
}: {
  name: string
  label: string
  icon: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="status"
      aria-label={`${label}: ${name}`}
      className="flex min-w-0 flex-1 items-center gap-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-1 motion-safe:duration-150"
    >
      {icon}
      <span className={cn('min-w-0 flex-1 truncate text-muted-foreground', className)} title={name}>
        {name}
      </span>
      <Spinner aria-hidden="true" className="mr-1 shrink-0 text-muted-foreground motion-reduce:animate-none" />
    </div>
  )
}

export type FileTreeItemProps =
  React.HTMLAttributes<HTMLDivElement> &
  React.RefAttributes<HTMLDivElement>

type FileTreeRowProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick' | 'onContextMenu'> & {
  active?: boolean
  children: React.ReactNode
  dropTarget?: boolean
  dropLabel?: string
  expanded?: boolean
  expandable?: boolean
  expansionLocked?: boolean
  expandLabel?: string
  collapseLabel?: string
  kind: 'file' | 'folder'
  level: number
  path: string
  selected?: boolean
  treeItemProps?: FileTreeItemProps
  onActivate?: React.MouseEventHandler<HTMLDivElement>
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  onToggle?: React.MouseEventHandler<HTMLButtonElement>
}

export const FileTreeRow = React.forwardRef<HTMLDivElement, FileTreeRowProps>(function FileTreeRow({
  active = false,
  children,
  className,
  collapseLabel,
  dropTarget = false,
  dropLabel,
  expanded = false,
  expandable = false,
  expansionLocked = false,
  expandLabel,
  kind,
  level,
  onActivate,
  onContextMenu,
  onToggle,
  path,
  selected = false,
  style,
  treeItemProps,
  ...props
}, forwardedRef) {
  const workspacePath = useSettingStore(state => state.workspacePath)
  const pendingPaths = useFileDeletionStore(state => state.pendingPaths)
  const deletionPending = pendingPaths.length > 0 && isFileDeletionPending(path, workspacePath)
  const {
    className: treeClassName,
    onClick: onTreeClick,
    ref: treeRef,
    style: treeStyle,
    ...treeProps
  } = treeItemProps ?? {}
  const composedRef = React.useCallback((node: HTMLDivElement | null) => {
    if (typeof forwardedRef === 'function') {
      forwardedRef(node)
    } else if (forwardedRef) {
      forwardedRef.current = node
    }

    if (typeof treeRef === 'function') {
      treeRef(node)
    } else if (treeRef) {
      treeRef.current = node
    }
  }, [forwardedRef, treeRef])

  return (
    <div
      {...treeProps}
      {...props}
      ref={composedRef}
      data-file-manager-item-kind={kind}
      data-file-manager-item-path={path}
      className={cn(
        'group file-manager-item min-w-0 select-none overflow-hidden',
        active && 'active',
        selected && 'file-selected',
        dropTarget && !deletionPending && 'file-on-drop',
        deletionPending && 'cursor-wait',
        treeClassName,
        className
      )}
      style={{
        ...treeStyle,
        ...style,
        paddingInlineStart: `${4 + level * 16}px`,
      }}
      aria-busy={deletionPending || props['aria-busy']}
      aria-disabled={deletionPending || props['aria-disabled']}
      onPointerDownCapture={event => {
        if (deletionPending) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        treeProps.onPointerDownCapture?.(event)
        if (!event.defaultPrevented) props.onPointerDownCapture?.(event)
      }}
      onKeyDownCapture={event => {
        if (deletionPending) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        treeProps.onKeyDownCapture?.(event)
        if (!event.defaultPrevented) props.onKeyDownCapture?.(event)
      }}
      onDragStartCapture={event => {
        if (deletionPending) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        treeProps.onDragStartCapture?.(event)
        if (!event.defaultPrevented) props.onDragStartCapture?.(event)
      }}
      onDropCapture={event => {
        if (deletionPending) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        treeProps.onDropCapture?.(event)
        if (!event.defaultPrevented) props.onDropCapture?.(event)
      }}
      onClickCapture={event => {
        if (deletionPending) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        treeProps.onClickCapture?.(event)
        if (!event.defaultPrevented) props.onClickCapture?.(event)
      }}
      onClick={(event) => {
        if (deletionPending) return
        onTreeClick?.(event)
        onActivate?.(event)
      }}
      onContextMenu={event => {
        if (deletionPending) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onContextMenu?.(event)
      }}
    >
      {expandable ? (
        <button
          type="button"
          data-file-manager-toggle
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-transparent text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={expanded ? collapseLabel : expandLabel}
          aria-expanded={expanded}
          aria-disabled={expansionLocked || deletionPending}
          disabled={expansionLocked || deletionPending}
          title={expansionLocked ? collapseLabel : undefined}
          onClick={onToggle}
        >
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform duration-150',
              expanded && 'rotate-90'
            )}
          />
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden="true" />
      )}
      {children}
      {dropTarget && !deletionPending && dropLabel ? (
        <Badge variant="outline" className="pointer-events-none ml-auto max-w-36 shrink-0 truncate">
          {dropLabel}
        </Badge>
      ) : null}
    </div>
  )
})
