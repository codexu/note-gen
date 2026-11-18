// Fork（#44 後續；almanac P0-c 改 v5）：左側欄裡可點的列共用的樣式。
// v5：圓角 6px、hover bg-hover、選中 bg-active，全用 ink 疊透明的 token，亮暗自動切換。
export const SIDEBAR_ROW = 'cursor-pointer rounded-md outline-none transition-colors duration-100 ease-out hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/60'

export const SIDEBAR_ROW_ACTIVE = 'bg-active font-[560] text-ink'

/** 次要選中：首頁或 Inbox 頁開著時，下半部顯示中的入口只用字色標示，不加底色。 */
export const SIDEBAR_ROW_ACTIVE_SECONDARY = 'font-[560] text-ink'
