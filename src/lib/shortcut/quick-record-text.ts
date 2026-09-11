import emitter from '@/lib/emitter'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { emitTo } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Store } from '@tauri-apps/plugin-store'
import { getTags } from '@/db/tags'
import { insertExternalMark } from '@/db/marks'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'
import useMarkStore from '@/stores/mark'
import { getRecordSaveTagIdFromTags } from '@/lib/record-save-target'
import { EmitterRecordEvents } from '@/config/emitters'
import { QUICK_RECORD_WINDOW, type QuickRecordRequest, type QuickRecordResponse } from '@/lib/quick-record-window'

let opening: Promise<void> | undefined

async function openQuickRecordWindow() {
  await invoke('remember_quick_record_foreground')
  const existing = await WebviewWindow.getByLabel(QUICK_RECORD_WINDOW)
  if (existing) {
    await existing.show()
    await existing.unminimize()
    await existing.setFocus()
    await emitTo(QUICK_RECORD_WINDOW, 'quick-record-open')
    return
  }

  const window = new WebviewWindow(QUICK_RECORD_WINDOW, {
    url: '/quick-record',
    title: 'NoteGen',
    width: 460,
    height: 460,
    minWidth: 320,
    minHeight: 320,
    center: true,
    resizable: true,
    dragDropEnabled: false,
  })
  await new Promise<void>((resolve, reject) => {
    void window.once('tauri://created', () => resolve())
    void window.once('tauri://error', event => reject(new Error(String(event.payload))))
  })
  await window.show()
  await window.unminimize()
  await window.setFocus()
}

export default async function initQuickRecordText() {
  const unlisten = await getCurrentWindow().listen<QuickRecordRequest>('quick-record-request', event => {
    const request = event.payload
    const respond = (response: Omit<QuickRecordResponse, 'id'>) =>
      emitTo(QUICK_RECORD_WINDOW, 'quick-record-response', { ...response, id: request.id })

    void (async () => {
      const tags = await getTags()
      const settings = useSettingStore.getState()
      if (request.action === 'prepare') {
        const store = await Store.load('store.json')
        await respond({
          context: {
            selectedTagId: getRecordSaveTagIdFromTags({
              mode: 'current',
              currentTagId: useTagStore.getState().currentTagId,
              lastTagId: settings.lastRecordTagId,
              fixedTagId: settings.fixedRecordTagId,
              tagIds: tags.map(tag => tag.id),
            }),
            autoReadClipboard: (await store.get<boolean>('autoReadClipboard')) ?? true,
            uiScale: settings.uiScale,
            appFontFamily: settings.appFontFamily,
            customThemeColors: settings.customThemeColors,
          },
        })
        return
      }

      const content = request.text?.trim()
      const tagId = request.tagId
      if (request.action !== 'save' || !content || typeof tagId !== 'number' || !tags.some(tag => tag.id === tagId)) {
        await respond({ error: 'invalid' })
        return
      }
      // A stable source ID makes retries safe, including after a lost response.
      await insertExternalMark({
        sourceId: `quick-record:${request.id}`,
        tagId,
        type: 'text',
        content,
        desc: content,
      })
      await respond({ saved: true })
      // Post-save refresh failures must not turn a saved record into a retry.
      try {
        await settings.setLastRecordTagId(tagId)
        await useTagStore.getState().fetchTags()
        await useMarkStore.getState().fetchMarks()
        emitter.emit(EmitterRecordEvents.refreshMarks)
      } catch (error) {
        console.error('Failed to refresh quick record state:', error)
      }
    })().catch(error => {
      console.error('Quick record request failed:', error)
      void respond({ error: 'failed' }).catch(console.error)
    })
  })

  const handleOpen = () => {
    if (opening) return
    opening = openQuickRecordWindow()
      .catch(error => { console.error('Failed to open quick record window:', error) })
      .finally(() => { opening = undefined })
  }
  emitter.on('quickRecordText', handleOpen)
  return () => {
    emitter.off('quickRecordText', handleOpen)
    unlisten()
  }
}
