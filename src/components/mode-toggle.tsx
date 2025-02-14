"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { SidebarMenuButton } from "./ui/sidebar"
import { _t } from '@/locales/index';

function Toggle() {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}

export function ModeToggle() {
  return (
    <SidebarMenuButton asChild className="md:h-8 md:p-0"
      tooltip={{
        children: _t("theme"),
        hidden: false,
      }}
    >
      <a href="#">
        <div className="flex size-8 items-center justify-center rounded-lg">
          <Toggle />
        </div>
      </a>
    </SidebarMenuButton>
  )
}
