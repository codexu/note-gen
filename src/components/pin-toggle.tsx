"use client"

import * as React from "react"
import { Pin, PinOff } from "lucide-react"
import { useTranslations } from 'next-intl'

import { Button } from "@/components/ui/button"
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useState } from "react";
import { SidebarMenuButton } from "./ui/sidebar";
import { Store } from "@tauri-apps/plugin-store";

export function PinToggle() {
  const t = useTranslations();
  const [isPin, setIsPin] = useState(false)

  async function setPin() {
    const store = await Store.load('store.json')
    const pin = await store.get<string>('pin')
    setIsPin(!pin)
    const window = getCurrentWindow()
    await window.setAlwaysOnTop(!pin)
    await store.set('pin', !pin)
  }

  return (
    <SidebarMenuButton asChild className="md:h-8 md:p-0"
      tooltip={{
        children: isPin ? t('common.unpin') : t('common.pin'),
        hidden: false,
      }}
    >
      <a href="#">
        <div className="flex size-8 items-center justify-center rounded-lg">
          <Button
            variant="ghost"
            size="sm"
            onClick={setPin}
          >
            {
              isPin ?
                <Pin className="h-[1.2rem] w-[1.2rem]" /> :
                <PinOff className="h-[1.2rem] w-[1.2rem]" />
            }
          </Button>
        </div>
      </a>
    </SidebarMenuButton>
  )
}
