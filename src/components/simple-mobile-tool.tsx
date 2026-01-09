'use client'

import { Button } from "@/components/ui/button"
import { CopySlash, Mic, ImagePlus, Link, FileText } from "lucide-react"

interface SimpleMobileToolProps {
  toolId: string
  onToolClick?: (toolId: string) => void
}

export function SimpleMobileTool({ toolId, onToolClick }: SimpleMobileToolProps) {

  const getToolInfo = (id: string) => {
    switch (id) {
      case 'text':
        return { icon: <CopySlash className="w-5 h-5" /> }
      case 'recording':
        return { icon: <Mic className="w-5 h-5" /> }
      case 'image':
        return { icon: <ImagePlus className="w-5 h-5" /> }
      case 'link':
        return { icon: <Link className="w-5 h-5" /> }
      case 'file':
        return { icon: <FileText className="w-5 h-5" /> }
      default:
        return { icon: null }
    }
  }

  const toolInfo = getToolInfo(toolId)

  const handleClick = () => {
    if (onToolClick) {
      onToolClick(toolId)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      className="flex flex-col items-center space-y-1 h-auto p-2 hover:bg-accent"
    >
      <div className="text-primary">
        {toolInfo.icon}
      </div>
    </Button>
  )
}
