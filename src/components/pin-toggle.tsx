"use client"

import * as React from "react"
import { Pin, PinOff } from "lucide-react"
import { useTranslations } from 'next-intl'

import { Button } from "@/components/ui/button"
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";

export function PinToggle() {
  const t = useTranslations();
  const [isPin, setIsPin] = useState(false)

  useEffect(() => {
    async function loadPinState() {
      const store = await Store.load('store.json')
      const pin = await store.get<boolean>('pin')
      setIsPin(!!pin)
    }
    loadPinState()
  }, [])

  async function togglePin() {
    const store = await Store.load('store.json')
    const newPinState = !isPin
    setIsPin(newPinState)
    const window = getCurrentWindow()
    await window.setAlwaysOnTop(newPinState)
    await store.set('pin', newPinState)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={togglePin}
      title={isPin ? t('common.unpin') : t('common.pin')}
    >
      {isPin ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
    </Button>
  )
}
