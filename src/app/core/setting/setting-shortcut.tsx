import { Input } from "@/components/ui/input";
import { SettingRow, SettingType } from "./setting-base";
import { useEffect, useState } from "react";
import { platform } from '@tauri-apps/plugin-os';
import emitter from "@/lib/emitter";
import { EmitterShortcutEvents } from "@/config/emitters"
import { ShortcutDefault, ShortcutSettings } from "@/config/shortcut"
import { Store } from "@tauri-apps/plugin-store";
import { CopySlash, RotateCcw, ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { _t } from '@/locales';

const keyMap = {
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Plus: 'PLUS',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Backspace: 'Backspace',
  CapsLock: 'Capslock',
  ContextMenu: 'Contextmenu',
  Space: 'Space',
  Tab: 'Tab',
  Convert: 'Convert',
  Delete: 'Delete',
  End: 'End',
  Help: 'Help',
  Home: 'Home',
  PageDown: 'Pagedown',
  PageUp: 'Pageup',
  Escape: 'Esc',
  PrintScreen: 'Printscreen',
  ScrollLock: 'Scrolllock',
  Pause: 'Pause',
  Insert: 'Insert',
  Suspend: 'Suspend',
};

interface ShortcutMap {
  id: string
  mittId: string
  title: string
  description?: string
  icon?: React.ReactNode
  defaultKey: string
}

const shortcutMap: ShortcutMap[] = [
  {
    id: ShortcutSettings.screenshot,
    mittId: EmitterShortcutEvents.screenshot,
    title: _t('shortcut_screenshot_record'),
    icon: <ScanText className="size-4" />,
    defaultKey: ShortcutDefault.screenshot,
  },
  {
    id: ShortcutSettings.text,
    mittId: EmitterShortcutEvents.text,
    title: _t('shortcut_text_record'),
    icon: <CopySlash className="size-4" />,
    defaultKey: ShortcutDefault.text,
  }
]

export function SettingShortcut({id, icon}: {id: string, icon?: React.ReactNode}) {

  return (
    <SettingType id={id} icon={icon} title={_t('shortcut_settings_title')}>
      {
        shortcutMap.map((item) => {
          return (
            <SettingRow border key={item.mittId}>
              <div className="flex flex-1 gap-2 items-center">
                {item.icon}
                <span>{item.title}</span>
                <span className="text-zinc-500 text-xs">{item.description}</span>
              </div>
              <ShortcutInput id={item.id} mittId={item.mittId} defaultKey={item.defaultKey} />
            </SettingRow>
          )
        })
      }
    </SettingType>
  )
}

function ShortcutInput({id, mittId, defaultKey}: {id: string, mittId: string, defaultKey: string}) {
  const [shortcut, setShortcut] = useState<string>('')

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const shortcut = await store.get<string>(id)
      if (shortcut) {
        setShortcut(shortcut)
      } else {
        setShortcut(defaultKey)
      }
    }
    init()
  }, [])

  function keyDownHandler(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.code === 'Backspace') {
      setShortcut('')
    } else {
      let newValue = '';
      if (e.ctrlKey) {
        newValue = 'Ctrl';
      }
      if (e.shiftKey) {
        newValue = `${newValue}${newValue.length > 0 ? '+' : ''}Shift`;
      }
      if (e.metaKey) {
        const currentPlatform = platform();
        newValue = `${newValue}${newValue.length > 0 ? '+' : ''}${currentPlatform === 'macos' ? 'Command' : 'Super'}`;
      }
      if (e.altKey) {
        newValue = `${newValue}${newValue.length > 0 ? '+' : ''}Alt`;
      }
      let code = e.code;
      if (code.startsWith('Key')) {
        code = code.substring(3);
      } else if (code.startsWith('Digit')) {
        code = code.substring(5);
      } else if (code.startsWith('Numpad')) {
        code = 'Num' + code.substring(6);
      } else if (code.startsWith('Arrow')) {
        code = code.substring(5);
      } else if (code.startsWith('Intl')) {
        code = code.substring(4);
      } else if (/F\d+/.test(code)) {
      } else if (code in keyMap) {
        code = keyMap[code as keyof typeof keyMap];
      } else {
        code = '';
      }
      const res = `${newValue}${newValue.length > 0 && code.length > 0 ? '+' : ''}${code}`
      setShortcut(res);
    }
  }

  function changeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
  }

  function blurHandler() {
    emitter.emit(mittId, shortcut);
  }

  async function resetHandler() {
    const store = await Store.load('store.json');
    await store.set(id, defaultKey)
    emitter.emit(mittId, defaultKey);
    setShortcut(defaultKey)
  }

  return <div className="flex gap-2 items-center">
    <Input
      value={shortcut}
      onKeyDown={keyDownHandler}
      onBlur={blurHandler}
      onChange={changeHandler}
    />
    <Button size={"icon"} variant="ghost" onClick={resetHandler}><RotateCcw /></Button>
  </div>
}
