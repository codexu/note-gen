'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreVertical } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"

interface MobileActionMenuProps {
  children: React.ReactNode
  className?: string
}

export function MobileActionMenu({ children, className }: MobileActionMenuProps) {
  const isMobile = useIsMobile()
  
  if (!isMobile) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div
          className={`h-6 w-6 p-0 hover:bg-muted rounded flex items-center justify-center cursor-pointer ${className}`}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
        >
          <MoreVertical className="h-4 w-4" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 重新导出 DropdownMenuItem 和 DropdownMenuSeparator 以便在菜单中使用
export { DropdownMenuItem as MobileMenuItem, DropdownMenuSeparator as MobileSeparator } from "@/components/ui/dropdown-menu"
