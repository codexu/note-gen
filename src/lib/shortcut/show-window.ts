import emitter from '@/lib/emitter';
import {getCurrentWebviewWindow} from '@tauri-apps/api/webviewWindow';

export default function initShowWindow() {
    emitter.on('openWindow', async () => {
        const window = getCurrentWebviewWindow()
        if (!window) return
        if (!(await window.isVisible())) {
            await window.show()
            await window.setFocus()
            await window.setAlwaysOnTop(true)
            await window.setAlwaysOnTop(false)
        } else if (await window.isMinimized()) {
            await window.unminimize()
            setTimeout(async () => {
                await window.show()
                await window.setFocus()
                await window.setAlwaysOnTop(true)
                await window.setAlwaysOnTop(false)
            }, 100)
        } else {
            // 增加判断窗口是否在最前面
            const isFocused = await window.isFocused();
            if (!isFocused) {
                await window.setFocus();
                await window.setAlwaysOnTop(true);
                await window.setAlwaysOnTop(false);
            } else {
                await window.hide()
            }
        }
    })
}
