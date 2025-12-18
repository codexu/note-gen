import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function TooltipButton(
  {
    icon,
    tooltipText, 
    onClick,
    disabled = false,
    variant = "ghost",
    size = "icon",
    side = "top",
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
  })
{
  return (
    <TooltipProvider>
      <Tooltip {...props}>
        <TooltipTrigger asChild>
          <Button className="relative" disabled={disabled} size={size} variant={variant} onClick={onClick}>
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side}>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}