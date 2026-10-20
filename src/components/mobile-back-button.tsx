"use client"

import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface MobileBackButtonProps {
  label: string
  onClick: () => void
  className?: string
}

export function MobileBackButton({
  label,
  onClick,
  className,
}: MobileBackButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-10 rounded-full", className)}
      onClick={onClick}
      aria-label={label}
    >
      <ArrowLeft />
    </Button>
  )
}
