// Fork（almanac 段1 整合）：全頁覆蓋層（首頁、Inbox、提示詞庫、收集、等你定、對話頁）一次只開一個。
// 各頁原本各自手寫「打開時關掉別頁」，頁面一多就漏接；這裡集中處理：任一頁從關變開時，關掉其他頁。
// V3 專屬的頁面在切回 classic 時一併關掉。

export interface OverlayStore {
  getState: () => { visible: boolean, hide: () => void }
  subscribe: (listener: (state: { visible: boolean }, previous: { visible: boolean }) => void) => () => void
}

export function linkExclusiveOverlays(stores: OverlayStore[]): () => void {
  const unsubscribes = stores.map(store => store.subscribe((state, previous) => {
    if (!state.visible || previous.visible) return
    for (const other of stores) {
      if (other !== store && other.getState().visible) other.getState().hide()
    }
  }))
  return () => unsubscribes.forEach(unsubscribe => unsubscribe())
}

export function hideWhen(condition: () => boolean, stores: OverlayStore[]): void {
  if (!condition()) return
  for (const store of stores) {
    if (store.getState().visible) store.getState().hide()
  }
}

/** ALMNC-22：關掉所有開著的全頁畫面，回到編輯器。回傳是否有關掉任何一頁。 */
export function hideAllOverlays(stores: OverlayStore[]): boolean {
  let hid = false
  for (const store of stores) {
    if (store.getState().visible) {
      store.getState().hide()
      hid = true
    }
  }
  return hid
}

/** ALMNC-22：新介面的 ⌘⇧H——有全頁畫面就全部關掉回到編輯器，沒有就打開今天主畫面。 */
export function toggleWorkspace(stores: OverlayStore[], showToday: () => void): 'workspace' | 'today' {
  if (hideAllOverlays(stores)) return 'workspace'
  showToday()
  return 'today'
}
