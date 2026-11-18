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
