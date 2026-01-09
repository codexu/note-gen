import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ReactNode } from 'react'

interface DraggableToolbarItemProps {
  id: string
  children: ReactNode
  shortcutNumber?: number
  showShortcut?: boolean
}

export function DraggableToolbarItem({ 
  id, 
  children, 
  shortcutNumber,
  showShortcut = false 
}: DraggableToolbarItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="relative cursor-grab active:cursor-grabbing"
    >
      {children}
      {showShortcut && shortcutNumber !== undefined && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-medium flex items-center justify-center pointer-events-none z-10">
          {shortcutNumber}
        </span>
      )}
    </div>
  )
}
