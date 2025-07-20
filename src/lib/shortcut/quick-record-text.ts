import emitter from '@/lib/emitter';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export default function initQuickRecordText(router: any) {
  emitter.on('quickRecordText', async () => {
    const window = getCurrentWebviewWindow()
    await window.show()
    await window.setFocus()
    router.push('/core/record')
    setTimeout(() => {
      emitter.emit('quickRecordTextHandler')
    }, 500);
  })
}
