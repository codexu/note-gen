import { useTranslations } from "next-intl";
import { TooltipButton } from "@/components/tooltip-button";
import { ArrowBigUpIcon, CommandIcon, OptionIcon, RotateCcw, TrashIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useShortcutStore from "@/stores/shortcut";
import { Badge } from "@/components/ui/badge";
import { platform } from "@tauri-apps/plugin-os";
import hotkeys from 'hotkeys-js';
import { useClickAway } from 'react-use'
import { uniq } from "lodash-es";

export default function ShortcutsInput({
  name,
  disabled
}: {
  name: string;
  disabled?: boolean;
}) {
  const t = useTranslations('settings.shortcuts');
  const { shortcuts, setShortcut, resetDefault } = useShortcutStore()
  const [isFocus, setIsFocus] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const keys: string[] = []

  const shorcut = useMemo(() => {
    return shortcuts.find((shortcut) => shortcut.key === name)
  }, [name, shortcuts]);

  const keyGroup = useMemo(() => value.split('+').filter((key) => key.length), [value])

  async function init() {
    setValue(shorcut?.value || '')
  }

  useClickAway(inputRef, async () => {
    if (isFocus) {
      setIsFocus(false)
      hotkeys.unbind('*')
      await setShortcut(name, value)
    }
  })

  async function handleSetFocus() {
    if (disabled) return
    setIsFocus(true)
    hotkeys('*', (event) => {
      let key = ''
      switch (event.key) {
        case 'Meta':
          key = 'CommandOrControl'
          break;
        default:
          key = event.key.charAt(0).toUpperCase() + event.key.slice(1)
          break;
      }
      keys.push(key)
      setValue(uniq(keys).join('+'))
    })
  }

  async function handleResetDefault() {
    await resetDefault(name)
  }

  async function handleClear() {
    setValue('')
    await setShortcut(name, '')
  }

  // 根据系统转化 CommandOrControl
  function transformKey(key: string) {
    if (platform() === 'macos') {
      switch (key) {
        case 'CommandOrControl':
          return <CommandIcon className="size-3.5" />
        case 'Control':
          return 'Control'
        case 'Shift':
          return <ArrowBigUpIcon className="size-4" />
        case 'Alt':
          return <OptionIcon className="size-3.5" />
        default:
          return key
      }
    }
    switch (key) {
      case 'CommandOrControl':
        return 'Ctrl'
      default:
        return key
    }
  }

  useEffect(() => {
    init()
  }, [shorcut, isFocus])

  return <div className="flex items-center gap-2">
    <div
      onClick={handleSetFocus}
      ref={inputRef}
      className={`
        flex-1
        px-2
        py-1
        flex
        rounded-md
        items-center
        cursor-pointer
        border
        h-9
        ${isFocus ? 'border-primary' : 'border-transparent'}
      `}
    >
      {
        keyGroup.length ? keyGroup?.map((key, index) => {
          if (index < keyGroup.length - 1) {
            return (
              <div key={index} className="flex items-center">
                <Badge variant="secondary" className="h-6">{transformKey(key)}</Badge>
                <span className="px-1 text-xs">+</span>
              </div>
            )
          } else {
            return <div className="flex items-center" key={index}><Badge variant="secondary" className="h-6">{transformKey(key)}</Badge></div>
          }
        }) : <Badge variant="secondary" className="h-6">{t('noShortcut')}</Badge>
      }
    </div>
    <TooltipButton
      size="icon"
      variant="ghost"
      tooltipText={t('resetDefaults')}
      onClick={handleResetDefault}
      icon={<RotateCcw />}
    />
    <TooltipButton
      size="icon"
      variant="destructive"
      tooltipText={t('clear')}
      onClick={handleClear}
      icon={<TrashIcon />}
    />
  </div>
}