import emitter from '@/lib/emitter';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export default function initShowWindow() {
  emitter.on('openWindow', async () => {
    const window = getCurrentWebviewWindow()
    if (await window.isFocused()) {
      await window.minimize()
    } else {
      await window.show()
      await window.setFocus()
    }
  })
}
