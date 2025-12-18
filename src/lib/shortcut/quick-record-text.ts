import emitter from '@/lib/emitter';
import {getCurrentWebviewWindow} from '@tauri-apps/api/webviewWindow';

export default function initQuickRecordText() {
    emitter.on('quickRecordText', async () => {
        const window = getCurrentWebviewWindow()
        if(!window) return
        if (!(await window.isVisible())) {
            await window.show()
            await window.setFocus()
            await window.setAlwaysOnTop(true)
            await window.setAlwaysOnTop(false)
            setTimeout(() => {
                emitter.emit('quickRecordTextHandler')
            }, 300);
        } else if (await window.isMinimized()) {
            await window.unminimize()
            setTimeout(async () => {
                await window.show()
                await window.setFocus()
                await window.setAlwaysOnTop(true)
                await window.setAlwaysOnTop(false)
                emitter.emit('quickRecordTextHandler')
            }, 100);
        } else {
            // 增加判断窗口是否在最前面
            const isFocused = await window.isFocused();
            if (!isFocused) {
                await window.setFocus();
                await window.setAlwaysOnTop(true);
                await window.setAlwaysOnTop(false);
            }
            emitter.emit('quickRecordTextHandler')
        }
    })
}
