"use client"

import * as React from "react"

import { useTextSize } from "@/contexts/text-size-context"
import { cn } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuCheckboxItem as NovaContextMenuCheckboxItem,
  ContextMenuContent as NovaContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem as NovaContextMenuItem,
  ContextMenuLabel as NovaContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem as NovaContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut as NovaContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent as NovaContextMenuSubContent,
  ContextMenuSubTrigger as NovaContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

type MenuType = "file" | "record"

function useMenuTextClass(menuType: MenuType) {
  const { getContextMenuTextSize } = useTextSize()
  const textSize = getContextMenuTextSize(menuType)

  return {
    xs: "text-xs",
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
  }[textSize] ?? "text-sm"
}

function ContextMenuItem({
  className,
  menuType = "file",
  onClick,
  ...props
}: React.ComponentProps<typeof NovaContextMenuItem> & { menuType?: MenuType }) {
  const textClassName = useMenuTextClass(menuType)
  const novaProps = { ...props }
  delete novaProps.inset

  return (
    <NovaContextMenuItem
      {...novaProps}
      className={cn(textClassName, className)}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.(event)
      }}
    />
  )
}

function ContextMenuSubTrigger({
  className,
  menuType = "file",
  ...props
}: React.ComponentProps<typeof NovaContextMenuSubTrigger> & { menuType?: MenuType }) {
  const novaProps = { ...props }
  delete novaProps.inset

  return (
    <NovaContextMenuSubTrigger
      {...novaProps}
      className={cn(useMenuTextClass(menuType), className)}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  menuType = "file",
  ...props
}: React.ComponentProps<typeof NovaContextMenuCheckboxItem> & { menuType?: MenuType }) {
  return (
    <NovaContextMenuCheckboxItem
      className={cn(useMenuTextClass(menuType), className)}
      {...props}
    />
  )
}

function ContextMenuRadioItem({
  className,
  menuType = "file",
  ...props
}: React.ComponentProps<typeof NovaContextMenuRadioItem> & { menuType?: MenuType }) {
  return (
    <NovaContextMenuRadioItem
      className={cn(useMenuTextClass(menuType), className)}
      {...props}
    />
  )
}

function ContextMenuLabel({
  className,
  menuType = "file",
  ...props
}: React.ComponentProps<typeof NovaContextMenuLabel> & { menuType?: MenuType }) {
  const novaProps = { ...props }
  delete novaProps.inset

  return (
    <NovaContextMenuLabel
      {...novaProps}
      className={cn(useMenuTextClass(menuType), className)}
    />
  )
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof NovaContextMenuContent>) {
  return (
    <NovaContextMenuContent
      className={cn("min-w-56", className)}
      {...props}
    />
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof NovaContextMenuSubContent>) {
  return (
    <NovaContextMenuSubContent
      className={cn("min-w-56", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({
  className,
  menuType = "file",
  ...props
}: React.ComponentProps<typeof NovaContextMenuShortcut> & { menuType?: MenuType }) {
  return (
    <NovaContextMenuShortcut
      className={cn(useMenuTextClass(menuType), className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
