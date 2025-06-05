"use client"

import * as React from "react"
import { Moon, Sun, SunMoon } from "lucide-react"
import { useTheme } from "next-themes"
import { useTranslations } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const t = useTranslations();
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton asChild className="md:h-8 md:p-0"  
          tooltip={{
            children: t('common.theme'),
            hidden: false,
          }}
        >
          <a href="#">
            <div className="flex size-8 items-center justify-center rounded-lg">
              <Button
                variant="ghost"
                size="sm" 
              >
                <ThemeIcon theme={theme} />
              </Button>
            </div>
          </a>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="right">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" />
          <span>{t('common.light')} {theme === "light" && "✓"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          <span>{t('common.dark')} {theme === "dark" && "✓"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <SunMoon className="mr-2 h-4 w-4" />
          <span>{t('common.system')} {theme === "system" && "✓"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThemeIcon({ theme }: { theme?: string }) {
  switch (theme) {
    case "light":
      return <Sun />
    case "dark":
      return <Moon />
    case "system":
      return <SunMoon />
    default:
      return <SunMoon />
  }
}