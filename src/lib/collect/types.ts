// Fork（almanac ALMNC-8）：收集頁的資料型別。全是純資料，不碰 I/O，方便單元測試。

export type InputKind = 'text' | 'link' | 'image' | 'file'

/** 使用者丟進收集框的一筆東西。image 帶 data URL 時，AI 可用的話會一起看圖。 */
export interface CollectInput {
  kind: InputKind
  /** 文字內容、連結網址；圖片與檔案放使用者補充的說明（可空）。 */
  text: string
  /** 圖片、檔案的檔名。 */
  name?: string
  imageDataUrl?: string
}

export type ProposalKind = 'note' | 'task' | 'event'

/** 一條提案：收下才會寫入，寫到哪裡由 kind 決定（筆記檔、今日日誌的任務行、今日日誌的帶時間任務行）。 */
export interface Proposal {
  id: string
  kind: ProposalKind
  title: string
  /** 筆記內文；任務與時段通常為空。 */
  body: string
  /** YYYY-MM-DD；沒有日期為空字串。 */
  due: string
  /** HH:mm；只有 event 一定有。 */
  time: string
  /** 不含 #。 */
  tags: string[]
}

export type SplitSource = 'ai' | 'rules'

export interface SplitResult {
  proposals: Proposal[]
  source: SplitSource
}

/** 問模型：給 prompt（與可選的圖片），回傳模型的原始文字。注入進來所以拆分邏輯能在沒有 AI 時測試。 */
export type AskModel = (prompt: string, imageDataUrl?: string) => Promise<string>
