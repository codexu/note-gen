import { ChevronRight } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

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
        dropTarget && 'file-on-drop',
        treeClassName,
        className
      )}
      style={{
        ...treeStyle,
        ...style,
        paddingInlineStart: `${4 + level * 16}px`,
      }}
      onClick={(event) => {
        onTreeClick?.(event)
        onActivate?.(event)
      }}
      onContextMenu={onContextMenu}
    >
      {expandable ? (
        <button
          type="button"
          data-file-manager-toggle
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-transparent text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={expanded ? collapseLabel : expandLabel}
          aria-expanded={expanded}
          aria-disabled={expansionLocked}
          disabled={expansionLocked}
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
      {dropTarget && dropLabel ? (
        <Badge variant="outline" className="pointer-events-none ml-auto max-w-36 shrink-0 truncate">
          {dropLabel}
        </Badge>
      ) : null}
    </div>
  )
})
