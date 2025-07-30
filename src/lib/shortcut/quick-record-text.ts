import emitter from '@/lib/emitter';
import {getCurrentWebviewWindow} from '@tauri-apps/api/webviewWindow';

export default function initQuickRecordText(router: any) {
    emitter.on('quickRecordText', async () => {
        const window = getCurrentWebviewWindow()
        if(!window) return
        if (!(await window.isVisible())) {
            await window.show()
            await window.setFocus()
            await window.setAlwaysOnTop(true)
            await window.setAlwaysOnTop(false)
            router.push('/core/record')
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
                router.push('/core/record')
                setTimeout(() => {
                    emitter.emit('quickRecordTextHandler')
                }, 300);
            }, 100);
        } else {
            // 增加判断窗口是否在最前面
            const isFocused = await window.isFocused();
            if (!isFocused) {
                await window.setFocus();
                await window.setAlwaysOnTop(true);
                await window.setAlwaysOnTop(false);
            }
            router.push('/core/record')
            setTimeout(() => {
                emitter.emit('quickRecordTextHandler')
            }, 300);
        }
    })
}
