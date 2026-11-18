"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group"
import { SearchIcon, CheckIcon } from "lucide-react"
import { CommandHighlightScope, CommandItemHighlight } from "@/components/fork/command-highlight"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandHighlightScope>
      <CommandPrimitive
        data-slot="command"
        className={cn(
          "flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground in-data-[slot=dialog-content]:rounded-md! in-data-[slot=dialog-content]:bg-bg in-data-[slot=dialog-content]:p-0",
          className
        )}
        {...props}
      />
    </CommandHighlightScope>
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-[16vh] translate-y-0 gap-0 overflow-hidden rounded-md! border border-line bg-bg p-0 shadow-dialog ring-0 sm:w-[560px] sm:min-w-0 sm:max-w-[min(560px,calc(100vw-32px))]",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0 in-data-[slot=dialog-content]:border-b in-data-[slot=dialog-content]:border-line-soft in-data-[slot=dialog-content]:p-0">
      <InputGroup className="h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2! in-data-[slot=dialog-content]:h-12! in-data-[slot=dialog-content]:rounded-none! in-data-[slot=dialog-content]:border-0 in-data-[slot=dialog-content]:bg-transparent! in-data-[slot=dialog-content]:*:data-[slot=input-group-addon]:pl-4!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "min-w-0 flex-1 border-0 bg-transparent text-sm outline-none ring-0 placeholder:text-faint focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 in-data-[slot=dialog-content]:text-[14.5px]",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50 in-data-[slot=dialog-content]:text-faint in-data-[slot=dialog-content]:opacity-100" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  onWheel,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    onWheel?.(event)
    if (event.defaultPrevented) return

    const list = event.currentTarget
    if (list.scrollHeight <= list.clientHeight) return

    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * list.clientHeight
        : event.deltaY

    list.scrollTop += delta
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-72 min-h-0 scroll-py-1 in-data-[slot=dialog-content]:max-h-80 in-data-[slot=dialog-content]:p-1 overflow-x-hidden overflow-y-auto overscroll-contain outline-none",
        className
      )}
      onWheel={handleWheel}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground in-data-[slot=dialog-content]:**:[[cmdk-group-heading]]:text-faint",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative z-0 flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:h-8 in-data-[slot=dialog-content]:rounded-md! in-data-[slot=dialog-content]:px-2.5 in-data-[slot=dialog-content]:py-0 in-data-[slot=dialog-content]:text-[13px] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-active data-selected:text-ink in-data-[slot=dialog-content]:data-selected:bg-transparent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className
      )}
      {...props}
    >
      <CommandItemHighlight />
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
