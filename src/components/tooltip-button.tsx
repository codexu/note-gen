"use client"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export function TooltipButton(
  {
    icon,
    tooltipText, 
    onClick,
    disabled = false,
    variant = "ghost",
    size = "icon",
    side = "top",
    buttonClassName,
    buttonId,
    ...props 
  }:
  {
    icon: React.ReactNode;
    tooltipText: string;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | null | undefined;
    size?: "icon" | "sm" | "default" | "lg";
    side?: "top" | "right" | "bottom" | "left";
    buttonClassName?: string;
    buttonId?: string;
  })
{
  const isMobile = useIsMobile()
  const button = (
    <Button
      type="button"
      id={buttonId}
      className={cn("relative", buttonClassName)}
      disabled={disabled}
      size={size}
      variant={variant}
      aria-label={tooltipText}
      title={isMobile ? tooltipText : undefined}
      onClick={onClick}
    >
      {icon}
    </Button>
  )

  if (isMobile) return button

  return (
    <TooltipProvider>
      <Tooltip {...props}>
        <TooltipTrigger asChild>
          {button}
        </TooltipTrigger>
        <TooltipContent side={side}>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
