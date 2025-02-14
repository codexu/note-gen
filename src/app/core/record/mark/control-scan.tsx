import { TooltipButton } from "@/components/tooltip-button"
import { insertMark } from "@/db/marks"
import { fetchAiDesc } from "@/lib/ai"
import ocr from "@/lib/ocr"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { currentMonitor } from '@tauri-apps/api/window';
import { ScanText } from "lucide-react"
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useEffect } from "react"
import { v4 as uuid } from 'uuid'
import useSettingStore from "@/stores/setting"
import emitter from "@/lib/emitter"
import { EmitterShortcutEvents } from "@/config/emitters"
import { ShortcutDefault, ShortcutSettings } from "@/config/shortcut"
import { Store } from "@tauri-apps/plugin-store"
import { _t } from '@/locales';
 
export function ControlScan() {
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()
  const { apiKey } = useSettingStore()

  async function createScreenShot() {
    const currentWindow = getCurrentWebviewWindow()
    await currentWindow.hide()

    await invoke('screenshot')
    
    const monitor = await currentMonitor();

    if (!monitor) return;
    
    const webview = new WebviewWindow('screenshot', {
      url: '/screenshot',
      decorations: false,
    });

    webview.setPosition(monitor?.position)
    webview.setSize(monitor?.size)

    webview.onCloseRequested(async () => {
      if (!await currentWindow.isVisible()) {
        await currentWindow.show()
      } else {
        await currentWindow.setFocus()
      }
      unlisten()
    })

    const unlisten = await webview.listen("save-success", async e => {
      if (typeof e.payload === 'string') {
        const queueId = uuid()
        addQueue({ queueId, progress: _t('ocr_recognition_progress'), type: 'scan', startTime: Date.now() })
        const content = await ocr(`screenshot/${e.payload}`)
        let desc = ''
        if (apiKey) {
          setQueue(queueId, { progress: _t('ai_content_recognition_progress') });
          desc = await fetchAiDesc(content).then(res => res ? res : content) || content
        } else {
          desc = content
        }
        setQueue(queueId, { progress: _t('saving_progress') });
        await insertMark({ tagId: currentTagId, type: 'scan', content, url: e.payload, desc })
        removeQueue(queueId)
        await fetchMarks()
        await fetchTags()
        getCurrentTag()
      }
      unlisten()
    });
  }

  async function initRegister() {
    const store = await Store.load('store.json')
    let lastKey = await store.get<string>(ShortcutSettings.screenshot)
    if (!lastKey) {
      await store.set(ShortcutSettings.screenshot, ShortcutDefault.screenshot)
      lastKey = ShortcutDefault.screenshot
    }
    const isEscRegistered = await isRegistered(lastKey);
    if (isEscRegistered) {
      await unregister(lastKey);
    }
    await register(lastKey, async (e) => {
      if (e.state === 'Pressed') {
        await createScreenShot()
      }
    }).catch(e => console.log(e))
  }

  async function linstenRegister(key?: string) {
    if (!key) return
    const store = await Store.load('store.json')
    const lastKey = await store.get<string>(ShortcutSettings.screenshot)
    if (lastKey) {
      const isEscRegistered = await isRegistered(lastKey);
      if (isEscRegistered) {
        await unregister(lastKey);
      }
    }
    await store.set(ShortcutSettings.screenshot, key)
    await register(key, async (e) => {
      if (e.state === 'Pressed') {
        await createScreenShot()
      }
    }).catch(e => console.log(e))
  }

  useEffect(() => {
    initRegister()
    emitter.on(EmitterShortcutEvents.screenshot, (res) => linstenRegister(res as string))
  }, [])

  return (
    <TooltipButton icon={<ScanText />} tooltipText={_t('screenshot_action')} onClick={createScreenShot} />
  )
}
