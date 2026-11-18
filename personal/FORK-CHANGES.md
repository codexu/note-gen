---
title: NoteGen Fork 偏離上游清單
filename: FORK-CHANGES.md
created: 2026-10-15 05:45 (Asia/Taipei)
modified: 2026-10-25 03:10 (Asia/Taipei)
source_llm: Claude (Opus 5.5, Claude Code session)
status: active
---

# NoteGen Fork 偏離上游清單

> 所有跟 `codexu/note-gen` 不同的修改都記在這裡。合併上游時先看這份，衝突以這裡列的修改為準。

## Git 結構

| 名稱 | 指向 | 用途 |
|---|---|---|
| remote `origin` | `ShiGaChenTW/note-gen` | 個人 fork |
| remote `upstream` | `codexu/note-gen` | 官方上游 |
| branch `dev` | 個人主線 | 日常開發 |
| branch `upstream-dev` | 追蹤 `upstream/dev` | 純鏡像，不放個人 commit |

分岔點：上游 `9859c6ef`（v0.38.2）。

## 同步上游流程

```bash
git fetch upstream
git checkout upstream-dev && git merge --ff-only upstream/dev
git checkout dev && git merge upstream-dev   # 或 cherry-pick 個別 commit
npx pnpm@9 install --frozen-lockfile
```

### 同步紀錄

| 日期 | 上游 | 結果 |
|---|---|---|
| 2026-10-25 | `upstream/dev` `ab0f5bf9`（39 個 commit，v0.38.3）→ PR #25 | 10 個衝突已解（見修改清單）。**`section-document*`／`sectioned-markdown-editor.tsx` 被上游移除**（#1299 改用 markdown-lexer worker），fork 曾在 `section-document.ts` 為大文件保留 frontmatter（F1），隨之消失。**上游的背景 tokenize 在 fork 自動停用**：`parsePreparedMarkdown` 要求編輯器的 tokenizer 名單與上游固定清單完全相同，fork 加了 frontmatter／wikilink 等自訂 tokenizer，會退回編輯器解析，所以 `trySetMarkdownContent` 的退回路徑必須先 `encodeFrontmatterForEditor`；代價是拿不到上游的大文件效能優化。同步後 `dev` 領先 `upstream-dev` 105、落後 0 |
| 2026-10-27 | `upstream/dev` `750cd738`（21 個 commit，v0.39.0） | 12 個衝突已解：6 個 `messages/*.json` 用 JSON 三方合併（無同 key 衝突，兩邊都沒遺失）；`pnpm-lock.yaml` 取上游版再用 pnpm 10 補算（fork 只多 `vitest`／`jsdom`）；`tauri.conf.json` 保留 fork 的 `productName`／`identifier`、版本採 0.39.0；`remote-mutation-recovery.ts` 採上游（上游已自己加上 `NoInfer<T>`，上次 PR #25 的型別修補不再需要）。**上游新增「左側欄大綱」頁籤**（`outline`，設定 `outlinePlacement === 'sidebar'` 才出現）：`left-sidebar.tsx` 以 fork 的啟動器版面為底接入，標籤用英文 `Outline`（#45 慣例），`SidebarSearch` 與右上角動作列都排除 `outline`；`BUILT_IN_LEFT_SIDEBAR_TABS` 兩邊的頁籤都留。**上游把 `Highlight` 換成 `ColorHighlight`＋`TextColor`**（彩色字體），tokenizer 固定名單同步改變，`MARKDOWN_LEXER_VERSION` 升 2；fork 的自訂 tokenizer 仍使背景 tokenize 停用，退回路徑（`encodeFrontmatterForEditor`）完好。上游這版把 React 升到 19.2.3、zod 升到 4 |
| 2026-11-01 | `upstream/dev` `325e9940`（23 個 commit，v0.39.2） | 6 個衝突已解：`tauri.conf.json` 保留 fork 名稱與 identifier；`tiptap-editor.tsx` 採上游 `trySetMarkdownContent`，保留 `encodeFrontmatterForEditor`。**上游把非中英語言移成插件（8088a60f）**：`zh-TW` 留在內建，用 8088a60f 前一版做 JSON 三方合併（無同 key 衝突）；`de`／`ja`／`pt-BR` 跟著上游刪除，已存的選擇退回簡中，需要時裝語言插件。 |

下次同步前先看：上游若新增 markdown tokenizer 或改動 `schema-markdown.ts`／`markdown-tokenizers.ts`，要確認 fork 的自訂 tokenizer（`notegen_frontmatter`、wikilink、表格原文、Bases）仍走得通。

## 修改清單

| 日期 | 檔案 | 修改 | 原因 |
|---|---|---|---|
| 2026-10-15 | `src-tauri/tauri.conf.json` | `identifier` → `tw.scottchen.NoteGen`、`productName` → `NoteGen (Scott)` | 資料目錄與官方版分開，可並存（D1） |
| 2026-10-15 | `src-tauri/tauri.conf.json` | `plugins.updater.endpoints` → `[]` | 防止自動更新把 fork 換回官方版（D4）。「關於」頁按檢查更新會顯示錯誤，屬預期 |
| 2026-10-15 | `personal/` | 新增：個人文件、custom CSS、NoteGen Today 插件 | D6 |
| 2026-10-15 | `.mcp.json`、`.ignore`、`.gitignore` | graft 程式碼索引設定 | 本機開發工具 |
| 2026-10-17 | `src/lib/markdown/frontmatter-split.ts`（新） | frontmatter 切分與拼回，`block + body === raw` | F1：共用的 frontmatter 規則 |
| 2026-10-17 | `src/app/core/main/editor/markdown/frontmatter-extension.ts`（新） | Tiptap `frontmatter` 節點：載入前把 YAML 換成標記，存檔時原樣輸出 | F1：原本 `---` 被讀成分隔線，第一個 key 被讀成 `## 標題`，存檔就改壞 frontmatter |
| 2026-10-17 | `src/app/core/main/editor/markdown/tiptap-editor.tsx` | 掛載點：import、extensions 加 `Frontmatter`、3 處 `setContent` 包 `encodeFrontmatterForEditor()` | F1 |
| 2026-10-17 | `src/app/core/main/editor/markdown/section-document.ts` | `findFrontmatterRange` 改呼叫共用的 `findFrontmatterEnd` | F1：大檔模式與一般模式同一套規則 |
| 2026-10-17 | `src/app/core/main/editor/markdown/style.css` | 檔尾加 `.notegen-frontmatter` 樣式 | F1：frontmatter 以唯讀區塊顯示 |
| 2026-10-17 | `package.json`、`pnpm-lock.yaml`、`vitest.config.ts`（新）、`tests/`（新） | 加 `vitest`、`jsdom` 與 `test` script | 上游沒有測試框架；往返測試用 |
| 2026-10-17 | `.gitignore` | 在上游的 `*.test.*` 之後加 `!src/**/*.test.ts`、`!tests/**/*.test.ts` | 上游忽略所有測試檔，fork 的 vitest 測試要進版控 |
| 2026-10-17 | `src/lib/daily/`（新） | F2 日期與檔名、D1 模板引擎、任務與 Daily Note 解析、D4 自然語言、D5 重複任務、今日筆記內容與開啟服務 | Phase 1 純函式與 I/O，全部是新檔 |
| 2026-10-17 | `src/stores/daily-settings.ts`（新） | 日記設定存在 `store.json` 的 `dailySettings` key | D1：不改上游的 `setting.ts` |
| 2026-10-17 | `src/app/core/setting/daily/page.tsx`（新） | 設定頁「日記」分區 | D1 |
| 2026-10-17 | `src/stores/settings-dialog.ts`、`src/app/core/setting/config.tsx`、`src/app/core/setting/components/settings-dialog.tsx` | 掛載點：加 `daily` 分區、導覽項目、頁面對應 | D1 |
| 2026-10-17 | `messages/{en,zh,zh-TW,ja,de,pt-BR}.json` | 在 `settings.record` 前加 `settings.daily` | D1 |
| 2026-10-17 | `src/app/core/main/daily-note-auto-open.tsx`（新）、`src/app/core/main/page.tsx` | 啟動時開啟今日筆記；page 只加 import 與一行掛載 | D1 |
| 2026-10-18 | `src/lib/vault-index/`（新）、`src/stores/vault-index.ts`（新） | vault 索引：任務行、frontmatter、mtime；快取存在 AppData `vault-index/`，不寫進 vault；用 fs watch 增量更新 | F3 |
| 2026-10-18 | `src/app/core/main/fork-services.tsx`（新）、`src/app/core/main/page.tsx` | fork 背景服務統一從 `<ForkServices />` 掛載（F3 索引＋D1 自動開啟）；page 仍只有一行 import 與一行掛載 | F3 |
| 2026-10-18 | `src/lib/today/`（新）、`src/app/core/main/today/`（新）、`src/lib/daily/note-io.ts`（新） | D2 原生今日頁（設計 v2）：任務分組（逾期＋近三日）、今日進程、本週、勾選寫回與復原、早晨啟動／整日復盤、D6 帶入今天 | D2、D6 |
| 2026-10-18 | `src/app/core/main/editor/editor-layout.tsx` | 掛載點：`blank://fork-today` 分頁改畫 `<TodayPage />`；呼叫 `useTodayTabOpener`（共 8 行） | D2：沿用上游 blank 分頁機制，不新增分頁種類 |
| 2026-10-18 | `src/app/core/main/main-status-bar.tsx` | 掛載點：狀態列「需處理 N」 | D2 |
| 2026-10-18 | `messages/*.json` | 新增頂層 `today` 命名空間（6 語系） | D2 |
| 2026-10-18 | `src-tauri/native-calendar/`（新）、`src-tauri/src/calendar.rs`（新）、`build.rs`、`lib.rs`、`tauri.conf.json`、`Info.plist`、`Entitlements.plist`、`.gitignore` | macOS 行事曆唯讀：Swift EventKit 小工具（比照 OCR 由 build.rs 編譯、放 `resources/calendar/`），Rust 指令 `calendar_events`／`calendar_request_access`；補行事曆用途說明與 entitlement | D2：Scott 決定 Phase 1 接行事曆 |
| 2026-10-18 | `src/app/core/main/daily/`（新）、`src/lib/daily/daily-nav.ts`（新）、`open-daily-note.ts` | D3 日記導航：前一篇／後一篇日記（跳過沒有日記的日子，往今天走時停在今天）、月曆跳日期（有日記灰點、有任務到期琥珀點）、快捷鍵 `⌘⌥[`／`⌘⌥]` | D3 |
| 2026-10-18 | `src/app/core/main/main-status-bar.tsx` | 掛載點：狀態列加 `fork:daily-nav`（開著日記時顯示「‹ 日期 ›」，其他時候只有月曆按鈕） | D3 |
| 2026-10-18 | `src/app/core/main/today/quick-add.tsx`（新）、`src/lib/today/today-actions.ts` | D4 快速新增：今日頁任務區的輸入框，即時預覽解析結果，Enter 寫進今日筆記「捕捉軌」區塊最後 | D4：Inbox 資料夾不在任務索引範圍內，所以只寫今日筆記 |
| 2026-10-18 | `src/app/core/main/editor/markdown/recurring-task-extension.ts`（新）、`tiptap-editor.tsx` | D5：在編輯器勾選 `🔁` 任務時加上 `✅ 今天`，下一行產生下一次；只認單一勾選動作，載入 Obsidian 已勾好的檔案不會重複產生。`tiptap-editor.tsx` 只加 import 與 extensions 一行 | D5：今日頁勾選在 D2 已接好，這次補編輯器 |
| 2026-10-18 | `src/lib/reminders/`（新）、`src/app/core/main/daily/reminder-service.tsx`（新）、`src/stores/daily-settings.ts`、`src/app/core/setting/daily/page.tsx` | D7 提醒：每分鐘檢查 `⏰` 任務並發 macOS 通知，App 關掉期間錯過的打開時補發（最多 24 小時，超過 3 個合併成一則）；已通知紀錄存在 AppData 的 `reminders.json`；設定頁加開關與「傳送測試通知」 | D7 |
| 2026-10-18 | `src/app/core/main/today/time-blocks.tsx`（新）、`src/lib/today/schedule.ts`（新） | D8 時間區塊：今日進程可切換「清單／時間軸」，把任務拖到時間軸寫入 `📅 今天 ⏰ HH:mm`（15 分鐘一格），時間軸上的任務可再拖動；任務列的時鐘按鈕是鍵盤替代方式 | D8 |
| 2026-10-18 | `messages/*.json` | `today` 加 `calendarNav`、`quickAdd`、`timeBlocks`、`reminders` 等；`settings.daily` 加 `reminders` | D3、D4、D7、D8 |
| 2026-10-19 | `personal/make-test-vault.mjs`（新） | 產生測試用 vault（預設 `~/Documents/NoteGen-Test-Vault`），日期以執行當天為今天，涵蓋 F1、D1–D8 的測試情境；只會覆寫自己建立的 vault | 驗收用，不動真正的 vault |
| 2026-10-19 | `src/app/core/main/today/use-today-data.ts`（新）、`use-today-actions.ts`（新）、`today-page.tsx` | 重構：今日頁的資料讀取與寫回動作抽成兩個 hook，`TodayPage` 只負責畫面；行為不變 | graphify 指出 `TodayPage` 直接呼叫 37 個函式 |
| 2026-10-19 | `src/lib/markdown/wikilink.ts`（新） | Phase 2 共用：`[[ ]]` 解析（別名、`\|`、`#標題`、`^block`、嵌入）、全文搜尋（跳過 code）、Obsidian「shortest path」目標解析與寫法 | Phase 2-1 三條軌道共用；規格 `personal/specs/07-Phase2-1實作規格.md`（`docs/notegen-plan/07` 的版控副本） |
| 2026-10-19 | `src/lib/vault-index/index-note.ts`、新檔 `links.ts`、`src/stores/vault-index.ts` | 索引 `links`（wikilink＋相對 markdown 連結，含行號、上下文）、`aliases`、`tags`（frontmatter＋內文 `#tag`，允許 `-`／`_`）；`INDEX_SCHEMA_VERSION` 2，舊快取自動重建；`selectBacklinks`／`selectOutgoingLinks` 按路徑快取 | L3（Codex 實作） |
| 2026-10-19 | `src/app/core/main/backlinks/`（新）、`src/components/plugins/plugin-right-sidebar.tsx` | 右側欄「反向連結」tab：連結到這篇（依來源筆記分組、強調連結文字、點擊開啟）、本篇連出（標示尚未建立）。掛載點：加 `@backlinks` tab，沒有外掛時也畫 Tabs（原本直接回 `<Chat />`） | L3 |
| 2026-10-19 | `src/lib/wikilink-suggest-model.ts`（新）、`src/app/core/main/editor/markdown/wikilink-suggest.tsx`（新）、`tiptap-editor.tsx` | L2：輸入 `[[` 跳出筆記選單（名稱／別名前綴 > 子序列 > 路徑；空 query 列已開分頁），Enter／Tab 插入 `[[目標]]` 或 `[[目標|別名]]`，最後一列「建立」；`tiptap-editor.tsx` 只加 import 與掛載一行 | L2（Grok 實作） |
| 2026-10-19 | `messages/*.json` | 頂層 `backlinks` 命名空間（`today` 之後）、`editor.wikilinkSuggest`（`smartFileLink` 之後） | L2、L3 |
| 2026-10-19 | `src/app/core/main/editor/markdown/wikilink-extension.ts`（新）、`tiptap-editor.tsx`、`markdown/style.css`、`tests/l1-wikilink-roundtrip.test.ts`（新） | L1：`[[ ]]`／`![[ ]]` 成為 inline atom 節點，存檔輸出原始字串；表格內 `\|` 由附帶的 block tokenizer 還原（只對含 `[[` 的表格出手；上游 marked 會把 `\|` 切成 `|`，這是目前唯一真的會改壞檔案的情境）；已建立／未建立用 decorations 跟隨索引；點擊開啟、不存在則在同資料夾建立 `名稱.md`；打完 `]]` 的 input rule 轉成節點。`tiptap-editor.tsx` 加 import 與 extensions 一行、L2 掛載兩行 | L1（Claude Code 子代理實作）；已知上游限制：`**粗體 [[B]]**` 會存成 `**粗體** [[B]]`（@tiptap/markdown 只把 mark 套在 text node，InlineMath 同病），測試以 `it.fails` 記錄 |
| 2026-10-19 | `tests/p2-1-wikilink-integration.test.ts`（新） | 整合：手打 `]]` 轉節點、L2 選單直接插入 L1 節點（連既有 `]]` 一起換掉） | PM 整合 |
| 2026-10-19 | `src/lib/note-rewrite.ts`（新） | Phase 2-2 共用：改寫可能正在編輯器裡開著的筆記（`runEditorPathWriteTransaction` 排隊、寫前重讀、開著的那篇寫完發 `editor-file-content-updated`／`external-content-update` 讓編輯器重載、失敗整批還原），照上游 `markdown-media-path.ts` 的流程 | 2-2 三軌寫檔的唯一入口；規格 `personal/specs/08-Phase2-2實作規格.md` |
| 2026-10-19 | `src/lib/vault-index/tags.ts`（新）、`src/stores/vault-index.ts`、`src/app/core/main/note-tags/`（新） | L6 筆記標籤：以索引的 `tags` 建樹（`/` 分層、不分大小寫、去重計數）、搜尋、依名稱／數量排序、點標籤列筆記；store 檔尾加 `selectTagTree` | L6（Grok 實作）；與上游「記錄」的標籤表完全分開 |
| 2026-10-19 | `src/stores/sidebar.ts`、`src/app/core/main/left-sidebar.tsx` | 掛載點：內建左側欄 tab 加 `noteTags`（lucide `Hash`，放在畫布之後）；`SidebarSearch` 不涵蓋這個 tab | L6 |
| 2026-10-19 | `src/lib/markdown/frontmatter-edit.ts`（新）、`src/lib/obsidian-types.ts`（新）、`src/app/core/main/properties/`（新） | L5 屬性面板：用 `yaml` `parseDocument` 的節點 range 做文字替換，只改動到的 key（註解、引號、順序、CRLF 不動）；八種 Obsidian 型別，優先讀 vault 的 `.obsidian/types.json`（唯讀）；巢狀、多行、錨點唯讀；各型別編輯元件、新增屬性 key 自動完成（全 vault 索引）、原始碼模式；寫回走 `rewriteNote` | L5（Codex 實作）；已知：被改的那一行若有行尾註解，註解前的多個空白會縮成一個；flow 清單被改時轉 block |
| 2026-10-19 | `src/components/plugins/plugin-right-sidebar.tsx` | 掛載點：右側欄加 `@properties` tab（lucide `SlidersHorizontal`，放在反向連結之後） | L5 |
| 2026-10-19 | `src/lib/markdown/wikilink-rewrite.ts`（新）、`src/lib/wikilink-rename.ts`（新）、`src/app/core/main/link-rewrite/`（新）、`fork-services.tsx` | L7 改名改寫連結：改名／搬動後用索引篩出連到被搬動檔案的筆記，比較搬動前後的解析結果，只改真的會指錯的連結（保留 `#標題`、`\|別名`、嵌入、frontmatter 引號內；markdown 相對連結重算）；補上「相對本篇資料夾的部分路徑」解析；AlertDialog 每次詢問；改寫走 `rewriteNotes`，失敗還原但不回滾改名 | L7（Claude Code 子代理實作）；2-1 的「部分路徑不解析」限制在 L7 的解析器已補，L1 的 decorations 仍用舊 resolver（2-3 統一） |
| 2026-10-19 | `src/app/core/main/file/file-item.tsx`、`file-dnd.ts`、`folder-item/index.tsx` | 掛載點：各加 1 行 import 與 2 行 `await requestLinkRewrite(...)`，放在上游 `rewriteWorkspaceMarkdownMediaPaths` 之後、外層 try 之內；函式內部 catch，不觸發上游 rollback | L7 |
| 2026-10-19 | `src/lib/markdown/unlinked-mentions.ts`（新）、`src/lib/vault-index/unlinked-mentions-scan.ts`（新）、`src/app/core/main/backlinks/backlinks-panel.tsx` | L4 未連結提及：反向連結面板第三區（預設收合、展開時才掃描全 vault、依索引 revision 快取、索引變動後改按「掃描」重掃）；純字串比對（ASCII 邊界、CJK 不設邊界，跳過 code／`[[ ]]`／markdown 連結／frontmatter／URL／`#tag`）；「連結」「全部連結」改寫為 `[[目標]]` 或 `[[目標|原文字]]` | L4（Claude Code 子代理實作） |
| 2026-10-19 | `messages/*.json` | 頂層 `linkRewrite`（`today` 之後）、`backlinks` 尾端 8 個未連結提及 key、頂層 `properties`（`backlinks` 之後）、頂層 `noteTags`（`tags` 之後）、`navigation.noteTags` | L4、L5、L6、L7 |
| 2026-10-19 | `personal/make-test-vault.mjs` | `60 Notes/` 加 2-2 樣本：`.obsidian/types.json`、屬性樣本、標籤 A／B／C、待改名與三篇改名來源、提及目標與兩篇提及來源 | 驗收用 |
| 2026-10-19 | `src/lib/vault-index/index-note.ts`、`src/lib/wikilink-suggest-model.ts`、`wikilink-suggest.tsx` | 2-3a：索引 `INDEX_SCHEMA_VERSION` 3，加 `headings`（ATX）與 `blockIds`（行尾 `^id` 含 context）；`#tag` 允許緊接全形標點、純數字不算；自動完成 `[[Note#` 列標題、`[[Note#^` 列區塊、`[[#` 為本篇（筆記唯一才列） | Grok 實作；舊快取自動重建 |
| 2026-10-19 | `src/lib/vault-index/graph.ts`（新）、`src/app/core/main/graph/`（新）、`plugin-right-sidebar.tsx` | L8 local graph：中心筆記 1／2 層鄰接圖（未解析目標虛線、150 節點上限），elkjs 佈局、xyflow 唯讀繪圖，點節點換中心；右側欄加 `@graph` tab（屬性之後） | Codex 實作 |
| 2026-10-19 | `src/app/core/main/editor/markdown/table-raw-extension.ts`（新）、`tiptap-editor.tsx` | 表格原文往返：載入時把 marked 的 `token.raw` 與儲存格簽章存進 table 節點（不輸出 HTML），存檔時簽章相同就輸出原文；`tiptap-editor.tsx` 只在 `MarkdownTable` 外包一層 `withRawTableRoundtrip` 加一行 import | 解掉 2-1 以來「表格會被重排」；Claude Code 子代理實作 |
| 2026-10-19 | `src/app/core/main/editor/markdown/wikilink-extension.ts`、`markdown/style.css` | `[[Note#標題]]`／`[[#標題]]`／`[[Note#^id]]` 點擊後開檔並捲到目標（`^id` 高亮 1.5 秒，decoration 不進檔案）；`embed: true` 改走 React node view | 同上 |
| 2026-10-19 | `src/app/core/main/editor/markdown/wikilink-embed-view.tsx`（新）、`src/lib/markdown/note-section.ts`（新） | `![[嵌入]]` 轉入：整篇／`#標題` 段／`^id` 區塊／圖片（`\|寬`）／附件，markdown-it 渲染（`html: false`）、巢狀 2 層、依 mtime 快取；介面文字 `editor.wikilinkEmbed` | 同上 |
| 2026-10-19 | `messages/*.json` | `localGraph`（`properties` 之後）、`editor.wikilinkSuggest` 加 4 key、`editor.wikilinkEmbed`（`wikilinkSuggest` 之後） | 2-3a |
| 2026-10-19 | `personal/make-test-vault.mjs` | `60 Notes/` 加 2-3a 樣本：區塊目標（標題＋`^id`）、嵌入來源／嵌入中層、`附件.png`；標籤樣本改驗新規則 | 驗收用 |
| 2026-10-19 | `src/stores/article.ts`、`src/app/core/main/editor/editor-layout.tsx` | 2-3b 掛載點：檔案樹也列 `.base` 與 `.canvas`（第 4104 行過濾）；`getItemType` 多 `base`／`canvas`，分頁對應 `BasesPage`／`ObsidianCanvasPage` | PM；注意上游同步功能可能會把 `.base`／`.canvas` 當一般檔案處理 |
| 2026-10-19 | `src/lib/vault-index/links.ts`、`graph.ts`、`index-core.ts`、`service.ts`、`src/stores/vault-index.ts`、`src/lib/wikilink-suggest-model.ts`、`src/lib/markdown/unlinked-mentions.ts`、`tests/perf/`（新） | 大 vault 效能（行為不變）：store 每 revision 建一次反向連結索引（3,000 篇反向連結 11 s → 25 ms，關聯圖 11 s → 26 ms）、預建解析對照表、鄰接表快取、未連結提及合併 RegExp、建議模型 WeakMap 快取；`service.ts` 讀檔並行數依檔案數、`listVault` 只 stat mtime、快取寫入改 `requestIdleCallback`；合成 vault 基準測試 | Grok 實作；`listVault` 改動走 Tauri fs，只能實機驗 |
| 2026-10-19 | `src/lib/obsidian-canvas/`（新）、`src/app/core/main/obsidian-canvas/`（新） | Obsidian `.canvas`（JSON Canvas 1.0）：解析驗證、未知欄位保留、沒動過輸出原文、改動後 Tab 縮排序列化；xyflow 編輯頁（四種節點、群組、各側邊線、拖曳縮放、文字雙擊編輯、檔案節點預覽與開啟、新增文字、刪除、拉邊），500 ms 防抖寫回走 `rewriteNote`，外部變更保護 | Codex 實作；與上游 NoteGen 自己的畫布（AppData、`canvas://` 分頁）無關 |
| 2026-10-19 | `src/lib/bases/`（新）、`src/app/core/main/bases/`（新）、`src/app/core/main/editor/markdown/bases-block-extension.tsx`（新）、`tiptap-editor.tsx` | Obsidian Bases 子集：自寫運算式語言（`file.*`、`note.*`、`formula.*`、最小函式集、方法寫法、日期差）、filters and/or/not、sort、limit、table／list view（其他型別退回 table）；`.base` 整頁（view 切換、表頭排序、原始碼唯讀）與筆記內 ```` ```base ```` 區塊（沒改時輸出原文）；`tiptap-editor.tsx` 加 import 與 extensions 各一行 | Claude Code 子代理實作；本段只讀不寫 `.base` |
| 2026-10-19 | `messages/*.json` | `obsidianCanvas`（頂層 `canvas` 之後）、`bases`（`settings` 之後，因既有測試鎖定 `localGraph` 後接 `settings`） | 2-3b |
| 2026-10-19 | `personal/make-test-vault.mjs` | `60 Notes/` 加 `筆記查詢.base`、`Bases 區塊.md`、`白板.canvas`；`--big N` 產生 `90 Big/` 合成筆記量啟動時間 | 驗收用 |
| 2026-10-20 | `src/app/core/main/editor/markdown/block-roundtrip-extension.ts`（新）、`tiptap-editor.tsx`、`markdown-paragraph.ts`、`frontmatter-extension.ts` | 頂層區塊原文往返與區塊間空行（Issue #18）：載入時把 marked 的 `token.raw` 與內容簽章存進段落／標題／清單／引用／程式碼／分隔線節點，並從 raw 結尾算出每個頂層區塊前面幾個空行（`gapBefore`）；存檔時沒動過就輸出原文，區塊之間的空行數照載入時的（0 個只在 CommonMark 不會改變結構時採用，例如標題後緊接清單）；`doc` 節點改用 `BlockRoundtripDocument`（`StarterKit` 設 `document: false`）；清單項裡的空段落輸出空字串而不是 `&nbsp;`；frontmatter 的 marker 保留本文前原有的空行數 | 解掉「標題後清單多一空行」「空清單項變 `&nbsp;`」，順帶 `*` 項目符號、tab 縮排、`1)`、setext 標題、`***`、混合清單都不再被重排；PM 自己實作 |
| 2026-10-24 | `src/app/core/main/editor/markdown/frontmatter-card-view.tsx`（新）、`frontmatter-create-button.tsx`（新）、`frontmatter-extension.ts`、`tiptap-editor.tsx` | 編輯區頂端 frontmatter 改成 React node view 卡片（取代唯讀 `<pre>`）：閱讀模式純展示、編輯模式依型別換元件並只改被改的那一行、整塊收合（全域一個）、沒有屬性時一鍵建立範本；游標在卡片後按 Backspace 不再刪整塊。卡片只 `updateAttributes({raw})`，磁碟寫入沿用編輯器防抖存檔，**不呼叫 `rewriteNote`**；刪光屬性或「移除全部」時移除整個節點。`tiptap-editor.tsx` 只掛 `FrontmatterCreateButton` | PR #24，Scott 要「格式不動、只改 UI」，參考 MetaEdit／Meta Bind |
| 2026-10-24 | `src/lib/markdown/frontmatter-edit.ts`、`frontmatter-template.ts`（新）、`src/stores/setting.ts`、`src/app/core/setting/editor/frontmatter-templates.tsx`（新）、`setting/editor/page.tsx`、`mobile/setting/pages/editor/page.tsx`、`properties-model.ts` | `applyFrontmatterEdit` 編輯 flow 清單（`tags: [a, b]`）維持 flow 寫法；新增 `applyFrontmatterEditToBlock`（刪光回傳空字串）、`yamlScalarText`；範本在 設定 → 編輯器 → 屬性範本 維護（`{{title}}` 預填檔名、`{{date}}`、`{{datetime}}`，存檔前驗證 YAML）；store 新增 `frontmatterTemplates`、`frontmatterDefaultTemplateId`、`frontmatterCollapsed`；`properties-model.ts` 加日期格式化與選項清單 | PR #24 |
| 2026-10-24 | `messages/*.json` | `properties` 加卡片用 17 個 key；`settings.editor.frontmatter`（`sourceLineNumbers` 之前）；六語系皆有翻譯 | PR #24 |
| 2026-10-25 | `src-tauri/tauri.conf.json`、`.gitignore`、`editor-layout.tsx`、`markdown/style.css`、`main-status-bar.tsx`、`file-dnd.ts`、`file-item.tsx`、`folder-item/index.tsx`、`tiptap-editor.tsx` | 同步上游 39 個 commit（v0.38.3）的衝突解法：`tauri.conf.json` 保留 productName／identifier、採上游版本號；status bar 採上游 rank 制，fork 的 daily-nav／today 改為 rank 86／87；檔案樹改名與搬動採上游同步日誌流程，L7 改寫連結詢問接在交易之外；表格採上游對齊與 `<br>` 儲存格換行但仍包 `withRawTableRoundtrip`；`setContent` 對字串保留 `encodeFrontmatterForEditor` | PR #25 |
| 2026-10-25 | `src/lib/sync/remote-mutation-recovery.ts`、`file-manager.tsx`、`mobile/writing/custom-header.tsx`、`src/lib/sync/auto-sync.ts` | 修上游 dev 在 v0.38.3 之後無法 `next build` 的問題：`reconcile` 型別加 `NoInfer<T>`（消除 `src/lib/sync` 56 個型別錯誤）、移除 4 處未使用變數；不改執行行為 | PR #25；純 `upstream-dev` 以同一套依賴重現，若上游已修可丟掉這個 commit |
| 2026-10-25 | `src/stores/vector.ts`、`src/lib/knowledge-index.ts`、`src/lib/config-center/client.ts` | 停用上游對外連線（Issue #16）：儲存後自動算向量預設改為關（`autoVectorEnabled ?? false`，預設嵌入模型打 `api.notegen.top`，每次存檔跳錯誤；要用的人到 RAG 設定打開）；設定中心預設不連線（`fetchConfigCenterConfig` 回傳 `not-modified`，沿用快取與內建設定），要連就在 `store.json` 設 `upstreamConfigCenterEnabled: true`。沒有加設定介面 | 每次存檔都跳 toast 很吵；啟動時 `download.notegen.top` 逾時 3 秒 |
| 2026-10-25 | `src/lib/markdown/note-section.ts`（`hideBlockIds`）、`wikilink-embed-view.tsx` | 嵌入顯示時隱藏行尾的 ` ^blk-1` 與單獨一行的 `^id`（程式碼區塊與 `x^2` 不處理），只影響顯示、不動檔案（Issue #15） | 像 Obsidian 閱讀模式 |
| 2026-10-25 | `src/app/core/main/editor/markdown/block-roundtrip-extension.ts` | 編輯器裡新建的空段落（Enter 留下的、沒有原文的）存檔不再輸出 `&nbsp;` 行，改成多一個空行，結尾的空段落省略（Issue #17）；載入時就存在的 `&nbsp;` 行有原文，仍原樣輸出。存檔後重新開檔，這些空段落會變成區塊之間的空行（`gapBefore`），畫面上不再有空段落，位元組不變 | Obsidian 開起來看到字面的 `&nbsp;` |
| 2026-10-25 | `src/stores/article.ts` | `sortType` 初始值 `'none'` → `'name'`（一行）：上游預設只把資料夾排前面、檔案照目錄讀取順序，fork 改成與 Obsidian 一樣預設依名稱（數字自然排序），資料夾仍在前；使用者在檔案工具列選過的排序照舊從 store 讀回覆蓋（Issue #19） | 上游選單只有名稱／建立／修改三種，`'none'` 只是沒選過的預設 |
| 2026-10-25 | `src/app/core/main/editor/markdown/wikilink-extension.ts` | wikilink plugin 的 view 在 `view.dom` 的 capture 階段攔 `mousedown`（左鍵、無 Shift／Alt、目標是 `a[data-type="wikilink"]`）並 `preventDefault`，再在 `click` 開啟；原本編輯器有焦點時瀏覽器會把 DOM 游標放進 atom 文字，ProseMirror 從 selectionchange 讀回來成了 NodeSelection（黃框），`handleClickOn` 那一輪拿不到點擊，要點第二下（Issue #20）。嵌入（`span`）與 ⌘／Ctrl 點擊不受影響，`handleClickOn` 保留當後援 | 單擊一律開啟，與 Obsidian 一致 |
| 2026-10-25 | `src/lib/vault-index/service.ts` | 每次掃描與增量更新後把統計寫到快取旁的 `vault-index/<hash>.stats.json`（`kind`、`ms`、`files`、`indexed`、`fromCache`、`sinceLoadMs`＝網頁載入到索引就緒的毫秒數、`at`）；只寫 AppData，不碰 vault（Issue #22） | 正式 build 看不到 console，量效能要有地方讀 |
| 2026-10-26 | `src/lib/agent-tasks/`（新）、`src/db/agent-tasks.ts`（新）、`src/app/core/main/agent-tasks/`（新） | Agent 任務中心（#30，ADR 0001）：重用 `AgentRuntime`，每個任務各自一份狀態與草稿，不經過 `chat-send.tsx`／`useChatStore`。背景任務只拿到唯讀工具（排除 editor／canvas／attachment／image／chat 類與 `note_open_file`、`ask_user_question`）＋包成草稿的 `note_create/update/delete/rename/move/copy_file`、`folder_create`；`folder_delete`、記憶寫入、標籤／記錄寫入、腳本、MCP 都不提供。草稿收下時用原工具寫入，寫入前比對衝突；搬移、刪除、衝突逐條確認。並行上限讀 `store.json` 的 `agentTaskConcurrency`（預設 2）；啟動時把 running／queued 標成 interrupted | Scott 要 AI 能在背景做事，修改先存草稿最後一起審 |
| 2026-10-26 | `src/lib/agent/types.ts`、`src/lib/agent/runtime.ts` | 掛載點：`AgentRuntimeInput.transformTools?`；`run()` 組好工具清單後若有就套用（1 行，標 `// Fork #30`）。上游同步時要確認這段仍在、工具清單的組法沒變 | #30 |
| 2026-10-26 | `src/app/core/main/chat/chat-input.tsx`、`src/app/core/main/fork-services.tsx`、`messages/*.json` | 掛載點：輸入框右側（`AgentPermissionModeSelect` 後）加 `BackgroundTaskControls`（丟到背景、背景任務清單，桌面才顯示）；`ForkServices` 掛 `AgentTaskService`；頂層新增 `agentTasks`，六語系皆有翻譯 | #30 |
| 2026-10-26 | `src/app/core/main/home/`（新）、`src/lib/home/cards.ts`（新）、`src/stores/home.ts`（新） | 首頁（#31，版型 D）：蓋在三欄工作區上方（`absolute`，保留狀態列，不卸載工作區），⌘⇧H 切換（比對 `code`／`key`／`keyCode`，注音輸入法下才穩定）；卡片登記在 `home-cards.tsx`，可放進 header／top／main／side，開關與排序存在 `store.json` 的 `homeCards`，啟動是否顯示存在 `homeShowOnStartup`（預設是） | Scott 要「全新首頁」當第二大腦與日程的入口 |
| 2026-10-26 | `src/app/core/main/today/today-page.tsx`、`today-tab.tsx`（原 `.ts`）、`src/app/core/main/editor/editor-layout.tsx` | Today 分頁退役：`TodayPage` 拆成 `TodayProvider`＋`TodayTitle`／`TodayWeekNav`／`TodayFocus`／`TodayTasks`／`TodayAgenda`／`TodayFootprint`，組成首頁「日程」卡片；從首頁開筆記後自動回工作區。`openTodayTab()` 改為打開首頁；`editor-layout.tsx` 拿掉 `useTodayTabOpener`，舊版存下的 `blank://fork-today` 分頁改顯示 `TodayMovedNotice` | #31 |
| 2026-10-26 | `src/app/core/main/page.tsx`、`fork-services.tsx`、`messages/*.json` | 掛載點：`/core/main` 根元素加 `relative`（首頁定位用）；`ForkServices` 掛 `HomeService`；頂層新增 `home`，`today.status.aria` 改成「開啟首頁」，六語系皆有翻譯 | #31 |
| 2026-10-26 | `src/app/core/main/home/cards/`（新）、`src/lib/home/signals.ts`、`activity.ts`、`capture.ts`（新）、`src/stores/home-activity.ts`（新）、`src/stores/home.ts`、`home-cards.tsx`、`home-screen.tsx`、`home-edit-sheet.tsx`、`home-service.tsx` | 首頁卡片（#32）：快速記錄（top；Enter 存成 `inboxFolder` 裡的新筆記、⌘Enter 交給背景任務）、需要你處理（主欄最上方，由卡片的 `useNeeds` 提供）、可以交給 Agent（五類規則，設定在 `store.json` 的 `homeSignalRules`，顯示在編輯首頁該卡片下方；按下先開預填指令對話框）、Agent 任務、最近筆記、本週足跡（預設關，`home-activity.json` 只記日期／路徑／事件，留 60 天）。`normalizePrefs` 改成把新卡片插在登記表裡下一張既有卡片之前 | #32 |
| 2026-10-26 | `src/stores/vault-index.ts` | 新增 `selectLinklessPaths`（沒有進出連結的筆記，可排除資料夾），共用既有的反向索引快取 | #32「缺連結」規則 |
| 2026-11-01 | `src/i18n/config.ts`、`language.tsx`、`messages/zh-TW.json`、`messages/common/zh-TW.json` | 保留內建 `zh-TW`，缺字退回簡中；語言選單加「繁體中文」。之後 fork 字串只需要 `zh-TW`、`zh`、`en` 三份 | 上游刪除 `zh-TW`（`config.test.ts` 防回退） |
| 2026-10-26 | `src/lib/conversation-summary/`（新）、`src/app/core/main/conversation-summary/`（新）、`home/cards/tasks-card.tsx` | 對話摘要（#33）：依對話 id 從 `chats` 讀訊息，逐字稿標「我」（role `user`）與「AI」（role `system`），模型回傳 JSON 後輸出固定分節的 Markdown；frontmatter `type: 對話摘要`、`conversation`（syncId 優先）、`date`、`topics`。再按一次依 `conversation` 找到既有摘要更新；目的路徑若是別的筆記不覆蓋。首頁最近對話旁顯示「摘要／已摘要」，最近 3 天、4 則以上、未摘要（或摘要比對話舊）的對話列進「需要你處理」 | Scott 要把對話收斂成知識報告的證據 |
| 2026-10-26 | `src/app/core/main/chat/chat-header.tsx`、`fork-services.tsx`、`messages/*.json` | 掛載點：標題列右側（臨時對話按鈕前）加 `ConversationSummaryButton`；`ForkServices` 掛 `ConversationSummaryDialog`；頂層新增 `conversationSummary`，六語系皆有翻譯 | #33 |
| 2026-10-26 | `src/lib/knowledge-report/`（新） | 知識報告（一）（#34）：主題清單筆記 `報告/主題清單.md`（`## 主題` ＋ `- 標籤／MOC／資料夾／筆記／狀態／備註：`，「狀態：待確認」是提議）；候選主題取第一層標籤與 MOC；掌握度公式 `mastery.ts`（七個分項合計 100，等級＝分數區間且門檻全過，否則壓在下一級起點之下；附離下一級的缺口）；資料來源：筆記（自己寫的字／摘抄、結構、總結、心得）、每日筆記的連結、對話摘要條數、筆記連到的 PDF（`parseLocalDocument`）、本週足跡、`active` 記憶（只讀）；排除資料夾存在 `store.json` 的 `knowledgeReportExcludeFolders`，`報告/` 永遠排除；增量快取在 AppData `knowledge-report/<hash>.json`（依 mtime 重讀、記修改日、PDF 字數、主題摘要指紋）。只有 lib，沒有畫面（畫面在 #35） | 規格 §3.1–§3.3 |
| 2026-10-26 | `src/lib/knowledge-report/report.ts`、`generate.ts`、`index.ts`（新）、`home/cards/report-card.tsx`、`report-drawer.tsx`（新） | 知識報告（二）（#35）：報告筆記 `報告/<期別> 知識報告.md`，frontmatter 存結構化資料（主題等級／分數／上期、缺口、評語、證據、建議與處理狀態、統計），內文給人讀；引文在內文壓成一行並中和任務／雙鏈／標籤語法。逐主題問模型（JSON），引文必須逐字出現在摘錄的筆記裡才留下；主題指紋沒變就沿用上一期評語（0 token）。建立基準＝勾選標籤／MOC 候選＋AI 提議 → 寫主題清單 → 估 token → 開始。排程 30 分鐘檢查一次，已有基準且這一期還沒產出才產生；估算超過上限就在「需要你處理」等確認。設定 `store.json` 的 `knowledgeReportSettings`、模型 `knowledgeReportModel`。首頁卡片：知識報告（top：主題膠囊、立即產生／建立基準；優化建議與待確認進「需要你處理」）、知識庫健康（side，預設關） | 規格 §3.4–§3.5 |
| 2026-10-26 | `src/lib/agent-tasks/task-center.ts` | 任務中心加「固定流程」執行器（`registerRunner`）：kind `report` 不走 AgentRuntime，照樣排隊、取消、通知、沒做完可繼續；執行器註冊前不開始 | #35 |
| 2026-10-26 | `src/stores/vault-index.ts`、`home/cards/signals-card.tsx`、`stores/home.ts`、`needs-list.tsx`、`agent-tasks-sheet.tsx` | `selectLinklessPaths` 加 `ignoreSourceFolders`（報告引用不算連結）；每週複盤判斷排除 `報告/`（週報檔名含 W44）；`HandoffDraft.onStarted` 回報任務 id；任務抽屜寬度改用 `data-[side=right]:` 前綴才蓋得過 Sheet 預設的 `max-w-sm` | #35 |
| 2026-11-18 | `src/app/globals.css` | 加一行 `@import "./fork-tokens.css"`（almanac P0-a）。`fork-tokens.css`（新）在 `@theme inline` 對應 v5 token（`bg-panel`、`text-ink`、`text-faint`、`border-line`、`text-brand`、`shadow-menu`…），並把 orange／amber／yellow／lime／teal／cyan／sky／blue／indigo／violet／purple／fuchsia／pink 色票改成暖灰（stone）；red／rose、green／emerald 不動。`fork-theme.css` 改成 v5 單色＋唯一 accent（`--brand-accent` 亮 #167a6e／暗 #4cc3b0），`--primary` 改反白；`public/fonts/` 收 Inter、Fira Code（OFL） | almanac V3 改版，簡報 §3；自訂 CSS（設定 > 自訂 CSS）會蓋過這些 token |
| 2026-11-18 | `src/` 下 127 個檔（逐處見 `personal/2026-11-18_report_p0b-color-audit.md`） | almanac P0-b 色彩清查：把 primary 當強調色的地方改成中性 token（`bg-hover`、`bg-active`、`text-ink`、`bg-invert`），白名單（連結、已勾選任務）改 `text-brand`；非白名單具名彩色 class 改中性；資料類顏色（語法高亮、圖表、使用者自選色、canvas、記錄類型分類色）保留 | 單色＋唯一 accent；合併上游時這些檔的 className 衝突，以 token 版本為準 |
| 2026-11-18 | `src/components/ui/kbd.tsx` | `Kbd` 改 v5 樣式：`bg-sunken`、高 18px、圓角 4px、10.5px、`font-mono`、svg 11px（almanac P0-c）。新增 `src/components/fork/shortcut-kbd.tsx`（`ShortcutKbd`：⌘⇧⌥⌃ 用 lucide icon、組合鍵一顆 pill） | P0-c 外框元件改版 |
| 2026-11-18 | `src/components/ui/command.tsx` | `Command` 包 `CommandHighlightScope`；`CommandDialog` 寬 560、距頂 16vh、`bg-bg`／`border-line`／`shadow-dialog`；`CommandInput` 在 Dialog 內為 48px／14.5px／底線；`CommandList` 在 Dialog 內最高 320px；`CommandItem` 選中底改 `bg-active`，Dialog 內多渲染 `CommandItemHighlight`（framer-motion layoutId 滑動，spring 360/32/0.6，新檔 `src/components/fork/command-highlight.tsx`）。所有新樣式用 `in-data-[slot=dialog-content]:` 限定，彈出式選單（model-select 等）維持原外觀。輸入框加 `focus-visible:outline-none!`（蓋過 fork-theme.css 的全域 focus 外框） | P0-c ⌘ 命令面板 |
| 2026-11-18 | `src/components/ui/button.tsx` | 按下效果 `translate-y-px` → `scale-[.96]`（`motion-reduce:active:scale-100`）；`transition-all` → 指定屬性＋`duration-100 ease-out` | P0-c 按鈕按下回饋 |
| 2026-11-18 | `src/app/core/main/left-sidebar.tsx` | 外層加 `bg-panel`＋右邊 `border-line-soft`；`LauncherButton` 28px／13px／`py-1`、選中不再用 sidebar-primary 色、badge 改等寬 10.5px `text-faint`；分隔線與標題列邊線改 `line-soft` | P0-c 左側欄 |
| 2026-11-18 | `src/app/core/main/sidebar-row.ts` | `SIDEBAR_ROW` 系列改 `bg-hover`／`bg-active`／`text-ink` token（原用 shadcn sidebar-accent）；同時影響 `daily/sidebar-calendar.tsx`、`timeline/timeline-sidebar.tsx` | P0-c 左側欄 |
| 2026-11-18 | `src/app/core/main/sidebar-search.tsx` | 搜尋框改假輸入框外觀（30px、`bg-bg`、`border-line-soft`、12.5px、placeholder `text-faint`），右側加 `ShortcutKbd ⌘K`（有輸入時隱藏）；掛 `useFocusSearchShortcut`（新檔 `fork-shell/use-focus-search-shortcut.ts`：⌘K 聚焦搜尋；焦點在編輯器／輸入框時不攔截，因為編輯器的 ⌘K 是插入連結） | P0-c 搜尋入口 |
| 2026-11-18 | `src/app/core/main/main-status-bar.tsx` | `<footer>` class：`bg-statusbar`、`border-line-soft`、`text-[10.5px]` | P0-c 狀態列 |
| 2026-11-18 | `src/app/core/main/page.tsx` | `MIN_LEFT_SIDEBAR_WIDTH_PX` 260 → 240 | P0-c 左側欄寬 240px 規格 |
| 2026-11-18 | `src/stores/article.ts` | `loadFileTree` 本體包 `try/catch`（刻意不縮排）：讀取失敗時最新一次請求結束 `fileTreeLoading`、設 `fileTreeInitialized` 避免無限重試，並跳「無法讀取工作區」提示；`src/app/core/main/fork-services.tsx`、`src/lib/vault-index/service.ts`（fork 自有）：索引等設定載入完才啟動，`startVaultIndex` 收 `AbortSignal`，寫入 store／快取前確認 store 仍屬於該工作區 | Issue #75：首次啟動檔案樹空白、短暫顯示別的工作區任務（ALMNC-1） |
| 2026-11-18 | `pnpm-workspace.yaml`（新）、`src-tauri/tauri.dev.conf.json`（新）、`package.json`、`next.config.ts` | almanac P0.5：pnpm 10 起不讀 package.json 的 `pnpm` 欄位，overrides 搬到 `pnpm-workspace.yaml`（package.json 的欄位是上游的，保留；兩邊要一致），並用 `allowBuilds` 放行 @parcel/watcher、esbuild、sharp、unrs-resolver 的 build script；新增 `pnpm tauri:dev`，dev 版用 identifier `tw.scottchen.NoteGen.dev`、名稱 `NoteGen (Scott) Dev`，資料目錄與正式版分開；`assetPrefix` 改讀 `PORT`（預設 3456） | dev 與正式版共用 AppData 是 #75 的環境因素；全域 pnpm 12 下 `pnpm dev`／打包會失敗；第二個 worktree 開 dev server 不必改檔 |
| 2026-11-18 | `src/app/layout.tsx`、`src/app/core/setting/general/interface-settings/index.tsx`、`messages/{zh-TW,zh,en}.json`、`src/components/ui/{kbd,command,button}.tsx`、`src/app/core/main/{left-sidebar,main-status-bar,sidebar-search}.tsx`；fork：`src/lib/fork-ui.ts`、`src/components/fork/ui-mode.tsx`、`fork-theme.css`、`fork-tokens.css` | almanac ALMNC-7 新介面開關：`<html data-ui="v3|classic">`（layout 加屬性、首屏腳本、`UiModeSync`），設定 > 介面加「新介面（V3）」開關，存 store.json 的 `almanacUiMode` 與 localStorage。v5 token 只在 `data-ui="v3"` 下生效，classic 還原 905d2c12 的 Obsidian baseline 色票與 Tailwind 原彩色；P0-c 的尺寸類別改成 `舊類別 v3:新類別`（Tailwind `v3:` variant） | V3 新頁面與 v5 外觀都藏在開關後，dev 隨時能切回舊介面（v2 計畫 §8） |
| 2026-11-18 | `src/app/core/main/fork-services.tsx`、`src/app/core/main/fork-shell/use-focus-search-shortcut.ts`、`messages/{zh-TW,zh,en}.json`；fork 新增：`src/app/core/main/anywhere/`（`anywhere-service.tsx`、`command-palette.tsx`、`chat-panel.tsx`）、`src/lib/anywhere/`（`palette-search.ts`、`context.ts`、`store.ts` 與測試） | almanac ALMNC-9：新介面（v3）下 ⌘K 開命令面板（同時搜尋筆記、核心指令與外掛命令；焦點在筆記編輯器時不攔截，編輯器的 ⌘K 仍是插入連結），⌘⇧A 開隨處對話面板（顯示用 `ChatContent`，送出走既有的 `quick-prompt-send`，不再掛第二個 `ChatInput`）。`fork-services` 掛 `AnywhereService`；`use-focus-search-shortcut` 在 v3 時讓出 ⌘K，classic 維持「聚焦側欄搜尋」；messages 新增頂層 key `anywhere`。⌘⇧P 的外掛命令面板（`plugin-command-palette.tsx`）未動 | V3 能在任何頁面叫出對話，並把 ⌘K 合成一個命令面板（v2 計畫 §8、P4-B） |
| 2026-11-18 | `src/app/core/main/left-sidebar.tsx`、`src/app/core/main/home/home-service.tsx`、`messages/{zh-TW,zh,en}.json`；fork：`src/app/core/main/collect/`、`src/lib/collect/`、`src/stores/collect.ts` | almanac ALMNC-8 收集頁：左側欄在新介面（`useUiV3()`）多一個 Collect 入口，home-service 掛 `CollectScreen`（同 Inbox 頁做法：全頁覆蓋層、左側欄開檔時收起、與首頁／Inbox／提示詞庫互斥）；訊息新增頂層 `collect` key。輸入拆成筆記／任務／時段提案（AI 拆、規則驗證，AI 不可用退回規則），收下後寫進收件資料夾的新筆記與今日日誌「捕捉軌」，不新增資料表 | V3 核心入口，藏在新介面開關後（classic 看不到） |
| 2026-11-18 | `src/lib/agent/runtime.ts` | 在工具呼叫解析參數與預覽前執行選用的 `authorizeToolCall`，拒絕時回傳工具結果 | ALMNC-12：記錄未知及越權的工具呼叫 |
| 2026-11-18 | `src/lib/agent/types.ts` | 增加選用的 `AgentRuntimeInput.authorizeToolCall` 型別 | ALMNC-12：背景代理人逐次查核工具權限 |
| 2026-11-18 | `src/app/core/setting/general/page.tsx` | 掛載由 V3 開關控制的代理人設定區 | ALMNC-12：新增、編輯及停用代理人 |
| 2026-11-18 | `messages/en.json` | 新增 `agents` 英文設定字串 | ALMNC-12：代理人設定 |
| 2026-11-18 | `messages/zh.json` | 新增 `agents` 簡中設定字串 | ALMNC-12：代理人設定 |
| 2026-11-18 | `messages/zh-TW.json` | 新增 `agents` 繁中設定字串 | ALMNC-12：代理人設定 |
| 2026-11-18 | Fork：`src/db/agents.ts`、`src/lib/agents/`、`src/lib/agent-tasks/`、`src/app/core/setting/agents/` | 本機代理人設定與拒絕紀錄、依 ID 註冊 runner、擴充既有草稿審核、V3 設定編輯與遷移回退測試 | ALMNC-12；回退步驟見 `src/lib/agents/README.md` |
| 2026-11-18 | `src/db/agent-tasks.ts` | almanac ALMNC-12 複審修正：`deleteAgentTask` 一併刪除 `agent_tool_refusals` 的對應紀錄（表不存在時略過） | 刪任務後拒絕紀錄成為孤兒資料 |
| 2026-11-18 | `src/app/core/main/home/cards/needs-list.tsx`、`src/app/core/main/home/cards/tasks-card.tsx`、`src/app/core/main/left-sidebar.tsx`、`src/app/core/main/home/home-service.tsx`、`messages/{zh-TW,zh,en}.json`；fork：`src/app/core/main/decide/`、`src/lib/decide/`、`src/stores/decide.ts`、`src/lib/collect/persist.ts`、`src/stores/collect.ts` | almanac ALMNC-10 等你定：`needs-list` 在新介面（`useUiV3()`）最上面多列等你定項目（最多 3 條＋「全部查看」，各有收下／不要），總數含它；`tasks-card` 新介面不再列整任務的「待審草稿」（草稿已逐條在等你定）；左側欄新介面多一個 Decide 入口與待決數；`home-service` 掛 `<DecideScreen />`；messages 新頂層 key `decide`。清單由收集提案（保存在 store.json 的 `collectItems`）與任務中心待審草稿投影，不另存待決狀態 | ALMNC-10 |
| 2026-11-18 | `src/components/plugins/plugin-right-sidebar.tsx`、`src/app/core/main/chat/chat-content.tsx`、`src/app/core/main/left-sidebar.tsx`、`src/app/core/main/home/home-service.tsx`、`src/app/core/main/anywhere/chat-panel.tsx`、`messages/{zh-TW,zh,en}.json`；fork：`src/app/core/main/threads/`、`src/lib/threads/`、`src/stores/threads.ts` | almnc14 對話頁（P4-A）：左側欄在新介面多一個 Threads 入口，打開全頁覆蓋層：左邊對話串列表（依專案分組／最近、搜尋、移到專案），右邊就是既有對話面板。`plugin-right-sidebar.tsx` 把 `<Chat />` 包進 `<ChatDock>`（對話頁開著時，把右側欄那份對話面板的 DOM 搬進對話頁，不重新掛載；輸入框、審批、修改比對都沒改）；`chat-content.tsx` 在訊息下加一行 `<ThreadMessageCards>`（提案卡、開工卡結果，v3 才畫）；`left-sidebar.tsx`／`home-service.tsx` 各加入口與掛載；`anywhere/chat-panel.tsx` 的「移到側欄」改成「移到對話頁」。專案分組存 store.json 的 `threadProjects`（syncId → 專案名），不改資料表；新字串在頂層 `threads` | 對話頁需要列出全部對話串、專案分組與訊息內嵌卡片，又不能重寫對話內部 |
| 2026-11-18 | `src/app/core/main/home/home-service.tsx`；fork：`src/lib/fork-overlays/exclusive.ts` | almanac 段1 整合：首頁、Inbox、提示詞庫、收集、等你定、對話頁六個全頁覆蓋層集中互斥（任一頁打開時關其他頁），切回 classic 時關掉 V3 專屬頁 | 各頁手寫互斥在頁面增加後漏接（等你定與對話頁互不關閉） |
| 2026-11-18 | `src/app/core/main/chat/chat-content.tsx` | 在訊息流掛載 JobMessages | ALMNC-13：開工卡 |
| 2026-11-18 | `src/app/core/main/fork-services.tsx` | 啟動主視窗的開工卡狀態訂閱 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/app/core/main/threads/threads-screen.tsx` | 在對話頁加入新增開工卡入口 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/app/core/main/threads/thread-cards.tsx` | 隱藏舊的開工卡示範資料 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/app/core/main/agent-tasks/agent-tasks-sheet.tsx` | 開工卡的任務操作回對話卡片；保留草稿審核 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/db/agent-tasks.ts` | 重啟時保留載入開工卡的任務嘗試紀錄 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/lib/agent-tasks/task-center.ts` | 支援事先保留任務 ID，開工卡任務先持久化再公布狀態 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/lib/agents/index.ts` | P5 派工入口接受排程已保留的任務 ID | ALMNC-13：開工卡 |
| 2026-11-18 | `src/lib/decide/project.ts` | 合併開工卡的待驗收結果投影 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/lib/decide/use-decisions.ts` | 訂閱開工卡來源並納入統一投影 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/lib/decide/actions.ts` | 開工卡結果的收下與拒絕更新原步驟 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/app/core/main/decide/decide-parts.tsx` | 加入開工卡結果的圖示 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/app/core/main/decide/decide-screen.tsx` | 顯示開工卡的結果、驗收標準及操作 | ALMNC-13：開工卡 |
| 2026-11-18 | `src/app/core/main/decide/decide-needs.tsx` | 首頁的開工卡結果連到等你定詳情 | ALMNC-13：開工卡 |
| 2026-11-18 | `messages/en.json` | 新增 jobs 英文字串 | ALMNC-13：開工卡 |
| 2026-11-18 | `messages/zh-TW.json` | 新增 jobs 繁中字串 | ALMNC-13：開工卡 |
| 2026-11-18 | `messages/zh.json` | 新增 jobs 簡中字串 | ALMNC-13：開工卡 |
| 2026-11-18 | Fork：`src/lib/jobs/`、`src/app/core/main/jobs/` | 新增開工卡規劃、排程、持久化、結果卡和測試 | ALMNC-13：開工卡 |
| 2026-11-18 | `src-tauri/src/lib.rs` | 註冊 `calendar_week` | ALMNC-16.1：週計畫查詢 |
| 2026-11-18 | `src-tauri/src/calendar.rs` | 以本地週首及週末時間戳唯讀查詢 EventKit，回傳存取狀態 | ALMNC-16.1：七日本地日曆區間 |
| 2026-11-18 | `src/lib/calendar/calendar.ts` | 共用原生日曆橋接與結果型別，日界線按本地日期計算 | ALMNC-16.1：週／日曆共用與夏令時間 |
| 2026-11-18 | `src/app/core/main/left-sidebar.tsx` | 掛上 V3 週計畫入口與選取樣式 | ALMNC-16.1：從導覽開啟週計畫 |
| 2026-11-18 | `src/app/core/main/home/home-service.tsx` | 掛載週計畫與時段服務，將週計畫加入全頁互斥及 classic 收起流程 | ALMNC-16.1：週計畫與主動提案 |
| 2026-11-18 | `src/lib/collect/ai.ts` | 既有 AI 呼叫支援靜默檢查設定 | ALMNC-16.1：背景排程遇到未設定的模型不跳通知 |
| 2026-11-18 | `src/lib/collect/types.ts` | 時段提案可保存原任務的工作區、檔案與行定位 | ALMNC-16.1：核准時更新原任務 |
| 2026-11-18 | `src/lib/collect/persist.ts` | 保存排程提案定位並略過過期批次 | ALMNC-16.1：沿用原收集來源的持久化 |
| 2026-11-18 | `src/stores/collect.ts` | 提供已驗證提案批次入口並共用還原中的 Promise | ALMNC-16.1：排程員提案進既有來源 |
| 2026-11-18 | `src/lib/collect/write.ts` | 接受排程員時段時交由原任務寫入流程驗證 | ALMNC-16.1：確認後才寫回今日日誌 |
| 2026-11-18 | `src/lib/decide/actions.ts` | 今日日誌快照附帶工作區與檔案路徑 | ALMNC-16.1：限制時段提案的使用範圍 |
| 2026-11-18 | `src/lib/decide/project.ts` | 從收集投影排程員時段，顯示時間區間及原任務差異 | ALMNC-16.1：沿用等你定 |
| 2026-11-18 | `src/lib/decide/use-decisions.ts` | 將目前工作區交給等你定投影 | ALMNC-16.1：切換工作區時隔離排程提案 |
| 2026-11-18 | `src/app/core/main/collect/collect-screen.tsx` | 收集操作介面篩除排程員批次 | ALMNC-16.1：排程員時段從等你定審核 |
| 2026-11-18 | `src/app/core/main/decide/decide-parts.tsx` | 顯示時段或原任務已變更的提示 | ALMNC-16.1：核准時遇到衝突 |
| 2026-11-18 | `messages/en.json` | 新增英文 `week` 字串 | ALMNC-16.1：週計畫 |
| 2026-11-18 | `messages/zh.json` | 新增簡中 `week` 字串 | ALMNC-16.1：週計畫 |
| 2026-11-18 | `messages/zh-TW.json` | 新增繁中 `week` 字串 | ALMNC-16.1：週計畫 |
| 2026-11-18 | Fork：`src/lib/week/`、`src/lib/timeslots/`、`src/app/core/main/week/` | 週資料投影、空檔及提案驗證、排程服務、週計畫與測試 | ALMNC-16.1 |
| 2026-11-18 | `src/app/core/main/home/home-screen.tsx` | v3 時首頁／今日入口改顯示 TodayV3Screen（早退一行），classic 不變 | ALMNC-16.2：v5 今天主畫面 |
| 2026-11-18 | `messages/en.json` | 新增頂層 todayV3 英文字串 | ALMNC-16.2：v5 今天主畫面 |
| 2026-11-18 | `messages/zh-TW.json` | 新增頂層 todayV3 繁中字串 | ALMNC-16.2：v5 今天主畫面 |
| 2026-11-18 | `messages/zh.json` | 新增頂層 todayV3 簡中字串 | ALMNC-16.2：v5 今天主畫面 |
| 2026-11-18 | Fork：`src/lib/today-v3/`、`src/app/core/main/today-v3/` | 新增 v5 今天主畫面的版面資料組裝（純函式＋測試）與三欄畫面、記／問輸入列 | ALMNC-16.2：v5 今天主畫面 |
| 2026-11-18 | fork：`src/app/core/main/today-v3/timeline.tsx`、`today-v3-screen.tsx`、`src/lib/today-v3/layout.ts`；`messages/*.json` | almanac ALMNC-16 整合：排程員的時段提案（`usePendingSlots`）畫在 v5 今天主畫面的時間軸上（虛線框、收下／不要），動作走等你定的 `acceptDecision`／`rejectDecision` | 把 16.1 的提案接到 16.2 的時間軸，對齊 v5 樣稿 |
| 2026-11-19 | `src/app/core/setting/general/page.tsx` | 掛載 V3 自動整理設定 | ALMNC-17：自動整理 |
| 2026-11-19 | `messages/en.json` | 新增 organize 英文字串 | ALMNC-17：自動整理 |
| 2026-11-19 | `messages/zh-TW.json` | 新增 organize 繁中字串 | ALMNC-17：自動整理 |
| 2026-11-19 | `messages/zh.json` | 新增 organize 簡中字串 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/db/agent-tasks.ts` | 載入超出近期清單的待審整理草稿 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/lib/agent-tasks/types.ts` | 新增 organize 任務類型 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/lib/agent-tasks/task-center.ts` | 將確定性草稿直接送審並先持久化 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/lib/agent-tasks/index.ts` | 整理提案的寫入由等你定處理 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/lib/decide/project.ts` | 投影本工作區的整理草稿和合併目的 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/lib/decide/actions.ts` | 將整理草稿核准與拒絕交給整理審核 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/app/core/main/fork-services.tsx` | 掛載 V3 閒置整理服務 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/app/core/main/decide/decide-screen.tsx` | 顯示合併說明與復原紀錄 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/app/core/main/decide/decide-parts.tsx` | 顯示整理衝突的提示 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/app/core/main/agent-tasks/agent-tasks-sheet.tsx` | 整理草稿由等你定逐筆審核 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/app/core/main/agent-tasks/background-task-controls.tsx` | 背景任務角標排除等你定的整理草稿 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/app/core/main/home/cards/tasks-card.tsx` | 首頁任務卡沿用等你定入口處理整理草稿 | ALMNC-17：自動整理 |
| 2026-11-19 | Fork：`src/lib/organize/`、`src/app/core/main/organize/` | 閒置掃描、規則、草稿、復原、設定和測試 | ALMNC-17：自動整理 |
| 2026-11-19 | `src/app/core/main/left-sidebar.tsx` | v3 時早退回 `<SidebarV3 />`（import＋一行），classic 路徑不變 | ALMNC-20：v5 側欄方案 B |
| 2026-11-19 | `src/app/core/main/page.tsx` | v3 時左欄固定 240px（defaultSize／minSize／maxSize 用 px）；classic 維持百分比 | ALMNC-20：側欄固定 240px |
| 2026-11-19 | `src/app/core/main/home/home-service.tsx` | 知識頁覆蓋層加入互斥、開檔收起，並掛上 `<KnowledgeScreen />`（知識頁含大綱與外掛左側欄視圖分頁） | ALMNC-20：知識導覽項 |
| 2026-11-19 | `src/app/core/main/collect/collect-screen.tsx` | 頁首加「收集｜Inbox」分頁（v3 才顯示） | ALMNC-20：Inbox 收進收集 |
| 2026-11-19 | `src/app/core/main/inbox/inbox-screen.tsx` | 頁首加「收集｜Inbox」分頁（v3 才顯示） | ALMNC-20：Inbox 收進收集 |
| 2026-11-19 | `src/app/core/main/prompt-library/prompt-library-screen.tsx` | 頁首加知識分頁（v3 才顯示） | ALMNC-20：提示詞庫收進知識 |
| 2026-11-19 | `src/app/core/main/week/week-screen.tsx` | 計畫頁左側加月曆欄（重用 SidebarCalendar） | ALMNC-20：月曆移到計畫頁 |
| 2026-11-19 | `messages/en.json`、`messages/zh.json`、`messages/zh-TW.json` | 新增頂層 `sidebarV3`、`week.calendarLabel` | ALMNC-20：側欄字串 |
| 2026-11-19 | Fork：`src/lib/sidebar-v3/`、`src/app/core/main/sidebar-v3/` | 導覽資料組裝與測試、收合狀態（store.json）、知識頁覆蓋層、側欄與分頁元件 | ALMNC-20 |
| 2026-11-19 | `messages/en.json`、`messages/zh.json`、`messages/zh-TW.json` | 按簡中鍵序補齊 350 個既有繁中缺鍵，三語新增編輯器狀態列字串 | ALMNC-18：繁中完整性與狀態列在地化 |
| 2026-11-19 | `src/app/core/main/editor/markdown/footer-bar/copy-button.tsx` | 複製按鈕、純文字選項與結果訊息接上語系，補焦點環 | ALMNC-18：狀態列繁中與鍵盤操作 |
| 2026-11-19 | `src/app/core/main/editor/markdown/footer-bar/export-button.tsx` | 匯出按鈕與結果訊息接上語系，補焦點環 | ALMNC-18：狀態列繁中與鍵盤操作 |
| 2026-11-19 | `src/app/core/main/page.tsx` | V3 頁面遮住工作區時，讓背景中欄和右欄暫停接收焦點 | ALMNC-18：Tab 跳過被遮住的控制項 |
| 2026-11-19 | `src/components/ui/button.tsx` | V3 按下縮放只在允許動態效果時生效 | ALMNC-18：減少動態效果 |
| 2026-11-19 | `src/components/ui/command.tsx` | 將無障礙標題放入對話框，關閉後還原焦點，補搜尋輸入列焦點環 | ALMNC-18：命令面板鍵盤操作 |
| 2026-11-19 | `src/components/ui/dialog.tsx` | 減少動態效果時停用對話框縮放動畫 | ALMNC-18：減少動態效果 |
| 2026-11-19 | `src/components/ui/dropdown-menu.tsx` | 減少動態效果時停用選單與子選單縮放動畫 | ALMNC-18：減少動態效果 |

## 刻意不改的東西

- `.github/workflows/*`：`release.yml`、`publish-config.yml` 只能手動觸發，`plugin-contract.yml` 只在 PR 跑檢查，不會自動發佈。保留原檔，減少合併衝突。
- `deep-link` scheme `notegen`：Web Clipper 擴充依賴這個名稱。如果同一台機器同時裝官方版，macOS 只會把連結交給其中一個。
- Mobile（iOS / Android）設定：只維護 macOS（D5）。

## 開發環境注意

- **pnpm**（2026-11-18 起）：全域 pnpm 10+（本機 12.18）直接用，設定在 `pnpm-workspace.yaml`（overrides、allowBuilds）；`pnpm install --frozen-lockfile` 不會改 lockfile。上游 CI 用 pnpm 9，它讀 `package.json` 的 `pnpm.overrides`，所以兩處的 overrides 要保持一致。舊說明「pnpm 用 9 版」已不需要。
- 同步上游後若 `pnpm install` 報 `ERR_PNPM_IGNORED_BUILDS`，表示上游新增了需要 build script 的套件：確認後用 `pnpm approve-builds <套件>` 加進 `allowBuilds`。
- **dev 版**：`pnpm tauri:dev`（identifier `tw.scottchen.NoteGen.dev`，資料在 `~/Library/Application Support/tw.scottchen.NoteGen.dev`，與正式版分開）。直接 `pnpm tauri dev` 仍會用正式版資料，不要用。
- 第二個 dev server：`PORT=3457 npx next dev`（不要加 `-p`，`assetPrefix` 讀 `PORT`）。worktree 的 `node_modules` 若是 symlink，Turbopack 會 panic，要拿掉 `--turbopack`。
- 桌面版 build 需要 Rust（`rustup`）。
- **Rust 用 stable，不用 repo 指定的 1.88.0**：macOS 27 的 dyld 拒絕載入 1.88.0 編出的 proc-macro（`sqlx-macros` 報 `mis-aligned LINKEDIT string pool`）。本機用 `rustup override set stable` 蓋過 `rust-toolchain.toml`，不改 repo 檔案。1.99.0 驗證可 build。
- 本機 build：`CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none pnpm tauri build --bundles app` → `src-tauri/target/release/bundle/macos/NoteGen (Scott).app`。

## 測試步驟

### 今日頁（D2）與 macOS 行事曆

**啟動**（分支 `feat/d2-today-page` 或之後的分支；確定 port 3456 沒被其他 dev server 佔用）：

```bash
source "$HOME/.cargo/env"
npx pnpm@9 tauri dev
```

第一次啟動會由 `build.rs` 編譯行事曆小工具，需要幾分鐘。

**測試前**：勾選、帶入、標記都會直接寫進 vault。建議改用測試 vault：`node personal/make-test-vault.mjs`（已存在時加 `--force` 重建），再到設定把工作區切到 `~/Documents/NoteGen-Test-Vault`。

**今日頁**

1. 開啟：點底部狀態列右側的「需處理 N」或「今日」，分頁列最左邊出現「今日」分頁。
2. 頂列：日期、問候語、時間正確；點本週任一天，開啟那天的日記，不存在時依模板建立。
3. 唯一要務／三件 MIT：顯示今日日記的對應區塊，沒填時顯示「尚未填寫」；改日記存檔後幾秒內更新。
4. 任務清單：分成逾期、今天、明天、後天、今天完成；逾期項目顯示「逾期 N 天」，高優先度顯示「高」。
5. 勾選任務：原筆記那一行變成 `[x]` 並加上 `✅ 今天日期`；按提示的「復原」會還原。勾帶 `🔁` 的任務時，下一行會多出下一次的任務。
6. 帶入今天（D6）：昨天日記有未完成任務時出現琥珀色提示；按「帶入今天」後，任務移到今日筆記的「捕捉軌」區塊最後，昨天那行變成 `- 原文字 → [[今天]]`。
7. 「⋯」選單：早晨啟動／整日復盤會在今日筆記寫入 `morning:: done`／`reviewed:: done`；「重新掃描 vault」會重讀索引。
8. 窄寬度：分割編輯區（`Cmd+\`）讓今日分頁變窄，版面改成單欄。

**行事曆**

1. 今日進程顯示「連接 macOS 行事曆…」，按「連接行事曆」。
2. `tauri dev` 不是打包好的 App，系統權限詢問會以啟動它的終端機 App（例如 Terminal、iTerm）名義跳出。允許後，今天的非全天事件依時間排進進程，標示日曆名稱。
3. 拒絕過或沒跳出詢問：到「系統設定 → 隱私權與安全性 → 行事曆」開啟該終端機 App，再切回 NoteGen 視窗，切回時會重新讀取。
4. 打包版（`npx pnpm@9 tauri build --bundles app`）才會用 `Info.plist` 裡「NoteGen 會在『今日』頁顯示你今天的行事曆事件」的說明，權限也記在 NoteGen 名下。

**這份步驟沒涵蓋的**

- F3 首次掃描時間：看開發者工具 Console 的 `[vault-index] N files in Xms`。
- 打包版的行事曆權限流程。

### 時間管理（D3、D4、D5、D7）與時間區塊（D8）

啟動方式同上。這些動作同樣會寫進 vault，先確認 vault 已備份或 git 狀態乾淨。

**D3 日記導航**

1. 打開任一篇日記，狀態列右側出現「‹ 10月18日 週日 ›」。
2. 按 `‹`／`›` 或 `⌘⌥[`／`⌘⌥]`：跳到前一篇／後一篇已存在的日記，中間沒有日記的日子會跳過；往今天的方向走時會停在今天（今天的日記不存在就依模板建立）。到最早一篇再按會提示「沒有更多日記了」。
3. 點日期打開月曆：有日記的日子有灰點，有未完成任務到期的日子有琥珀點；點任一天打開那天的日記（不存在就建立），「今天」按鈕回到今天。
4. 今日頁本週列的最右邊也有月曆按鈕，行為相同。

**D4 快速新增**

1. 今日頁任務區最上方的輸入框輸入 `買菜 @明天 9am !high #家`，下方即時顯示：買菜、明天的日期、09:00、高、家。
2. 按 Enter：今日筆記「捕捉軌」區塊最後多出 `- [ ] 買菜 📅 YYYY-MM-DD ⏰ 09:00 ⏫ #家`；按提示的「復原」會移除。
3. 再試 `回信 @下週五`、`開會 下午3點`、`繳費 @25號`。

**D5 重複任務（編輯器）**

1. 在任一筆記寫 `- [ ] 澆花 🔁 every week 📅 今天日期`，在編輯器裡勾選。
2. 這行變成 `- [x] … ✅ 今天日期`，下一行出現 `- [ ] 澆花 🔁 every week 📅 下週同一天`。按 `⌘Z` 一次會連同新的那行一起復原。
3. 今日頁勾選 `🔁` 任務時，提示會寫「已完成，下一次 YYYY-MM-DD」。

**D7 提醒**

1. 設定 →「日記」→「提醒」：開關預設開啟。按「傳送測試通知」，第一次會跳出通知權限詢問（`tauri dev` 下以終端機 App 名義），允許後收到測試通知。
2. 在今日筆記寫 `- [ ] 測試提醒 📅 今天日期 ⏰ 兩分鐘後的時間`，存檔後等到那個時間，一分鐘內收到「⏰ HH:mm 任務提醒」。
3. 補發：再寫一個 ⏰ 五分鐘後的任務，關掉 App，過了時間再打開，App 載入完成後收到那則提醒。
4. 同一個提醒不會重複通知；關掉開關期間到點的提醒，重新打開開關後不會補發。

**D8 時間區塊**

1. 今日頁「今日進程」右上角切到「時間軸」，看到 07:00–22:00 的時間格與「現在」線；錨點時段、⏰ 任務、行事曆事件依時間排上去，重疊的會並排。
2. 從右邊任務清單拖一個任務到時間軸：出現虛線與對齊 15 分鐘的時間，放開後原筆記那行改成 `📅 今天 ⏰ HH:mm`，任務出現在時間軸上。
3. 把時間軸上的任務拖到別的時間，⏰ 跟著改；按提示的「復原」會還原。
4. 鍵盤：滑鼠移到任務列（或用 Tab）會出現時鐘按鈕，選時間後按「排入」；已有時間的任務可以「清除時間」（不改到期日）。

**這份步驟沒涵蓋的**

- 打包版的通知權限（會記在 NoteGen 名下）。
- 時間軸拖放只支援滑鼠或觸控板；用鍵盤時改用任務列的時鐘按鈕。

### Phase 2-1 基本雙鏈（L1 wikilink、L2 自動完成、L3 反向連結）

啟動方式同上。測試 vault：`node personal/make-test-vault.mjs --force`，雙鏈樣本在 `60 Notes/`（見該 vault 的 README）。

**L1 wikilink**

1. 開一篇含 `[[筆記]]`、`[[筆記|別名]]`、`[[筆記#標題]]`、`![[圖.png]]` 的筆記：連結顯示為琥珀色底線文字（別名優先），嵌入顯示 `⧉ 檔名` 的虛線框。
2. 指向不存在筆記的連結是虛線、較淡；建好那篇筆記後幾秒內虛線消失（索引 watcher）。
3. 點既有連結：左側檔案樹 reveal 並開啟那篇；點不存在的連結：在目前筆記同資料夾建立 `名稱.md`（內容 `# 名稱`）並開啟；`[[#標題]]` 與嵌入點了不動作。
4. **存檔 diff 為空**：開 `60 Notes/雙鏈來源.md` 不改內容只按存檔，再用 git 或 Obsidian 比對，必須是空的（含行內 code `` `[[x]]` ``、frontmatter `related: "[[Front]]"`、markdown 相對連結）。`60 Notes/雙鏈表格.md`：只允許表格欄寬補空白與表前多一個空行，`[[A\|a]]` 的 `\|` 必須還在。
5. 方向鍵會跳過整個連結，Backspace 整個刪掉。手動打 `[[新連結]]`，打完第二個 `]` 立刻變成節點。

**L2 自動完成**

1. 輸入 `[[` 出現選單：名稱前綴命中的在前，別名命中的有「別名」badge，淡色顯示資料夾；空 query 時列出已開分頁的筆記。
2. ↑↓ 選擇、Enter 或 Tab 送出：插入 `[[筆記]]`（同名筆記存在時寫完整路徑 `[[folder/筆記]]`）；用別名選到時是 `[[筆記|別名]]`。Esc 關閉。
3. 游標後面已有 `]]` 時不會多出一組。
4. 打一個不存在的名稱，最後一列「建立「名稱」」：送出後插入 `[[名稱]]`（虛線），點它才建立檔案。

**L3 反向連結**

1. 右側欄多一個鏈結圖示的 tab「反向連結」（沒有安裝任何外掛時也有）。
2. 開一篇被其他筆記連到的筆記：「連結到這篇 N」依來源筆記分組，每筆顯示那一行的上下文並強調連結文字；點一筆開啟來源筆記。相對路徑的 markdown 連結 `[文字](../筆記.md)` 也算。
3. 「本篇連出 N」列出這篇的連結，尚未建立的標「尚未建立」。
4. 索引掃描中顯示「索引中…」；開的不是 `.md` 時顯示提示。
5. 第一次啟動會因 `INDEX_SCHEMA_VERSION` 升到 2 而整份重建索引，Console 看 `[vault-index]` 時間。

**這份步驟沒涵蓋的**

- 嵌入 `![[ ]]` 的內容轉入、`#標題` 捲動、block ref 跳轉（Phase 2-3）。
- 跨連結套粗體／斜體的存檔差異（上游限制，見修改清單）。
- ~~表格存檔會被重排~~：2-3a 的 `table-raw-extension.ts` 已解，沒動過的表格存檔輸出原文。
- **部分路徑**：2-2 的 L7 解析器已支援相對本篇資料夾的 `[[子資料夾/同名]]`；L1 的 decorations 與點擊仍用 `resolveWikilinkTarget`（只認完整路徑或純檔名），兩邊統一留到之後。

### Phase 2-2 知識庫整理（L5 屬性面板、L7 改名改寫連結、L6 筆記標籤、L4 未連結提及）

啟動方式同上。測試 vault：`node personal/make-test-vault.mjs --force`，樣本在 `60 Notes/`，預期數字見該 vault 的 README。驗收前先在 Obsidian 開同一個 vault 一次，確認 `.obsidian/types.json` 是腳本放的那份（Obsidian 可能會改寫它）。

**L5 屬性面板**

1. 右側欄多一個滑桿圖示的 tab「屬性」（對話、反向連結之後）。開 `60 Notes/屬性樣本.md`：列出 9 個屬性，`due` 是日期、`reviewed` 是日期時間、`rating` 數字、`done` 核取、`related`／`tags`／`aliases` 是 chip 列、`nested` 顯示原文並標「不支援」。
2. 改 `rating` 為 5、勾 `done`、改 `title`：每次存檔後 `git diff` 只有那一行；`title` 行尾的 `# 行尾註解要留著` 仍在（註解前空白會縮成一個）。
3. `tags` 加一個 chip：那段從 `[notegen, phase-2]` 變成 block 清單（三行），其他行不動。刪掉 `aliases` 的唯一一個值：變成 `aliases: []`。
4. 「新增屬性」打 `due`：下拉有 vault 裡出現過的 key，型別自動顯示「日期」（來自 `types.json`）。新 key 加在 `nested` 區塊之後、`---` 之前。
5. 「原始碼」：改壞 YAML 按套用會顯示錯誤、不寫檔；改好再套用整塊替換。
6. 編輯器同時開著這篇：改屬性後編輯器畫面上的 frontmatter 區塊即時更新，游標不跳。開著「今日頁」或非 `.md` 時面板顯示提示。

**L6 筆記標籤**

1. 左側欄多一個 `#` 圖示的 tab「筆記標籤」（畫布之後）；索引中顯示「索引中…」。
2. 樹：`專案`（3）展開有 `alpha`（1）、`beta`（1）；`閱讀` 2；`Reading` 2（`#Reading` 與 `#reading` 合併，顯示第一次遇到的寫法）；`待辦` 1；frontmatter 的 `notegen`、`phase-2` 也在。code 內的 `#code裡的不算` 不出現。
3. 點 `專案`：下方列 標籤A、標籤B、標籤C（含子標籤的筆記）；點 `alpha` 只有標籤A。點筆記會開啟。
4. 搜尋框打 `alp`：只剩 `專案 › alpha`，祖先自動展開；「依數量」切換排序。
5. 這個 tab 與上游「記錄」頁的標籤互不影響。

**L7 改名改寫連結**

1. 在檔案樹把 `60 Notes/待改名.md` 改名為 `新名字`：跳出「更新連結」對話框，寫「4 篇筆記共 10 個連結」，列出 改名來源一（5）、改名來源二（2）、子資料夾/改名來源三（2）、屬性樣本（1）。
2. 按「改寫」：toast「已更新 4 篇筆記」。`git diff`：改名來源一只有 5 行變（frontmatter 引號內、一般、別名、標題、嵌入），行內 code 的 `[[待改名]]` 不變；改名來源二的表格 `[[新名字\|表格別名]]` 保留 `\|`，markdown 連結變 `(新名字.md)`，檔案仍是 CRLF；來源三的 `[連結](../新名字.md)`；屬性樣本的 `related` 那一行。
3. 把改名後的檔案拖進 `子資料夾/`：對話框只列 markdown 連結會變的檔案（來源二、來源三、被搬動的那篇自己的 `[雙鏈目標](../雙鏈目標.md)`）；`[[新名字]]` 這種 wikilink 不列、不改（shortest path 不受資料夾影響）。
4. 按「不改寫」：什麼都不動，連結變虛線（未建立）。
5. 改名整個 `60 Notes/` 資料夾：只有寫完整路徑的 `[[60 Notes/子資料夾/同名]]` 會改，`[[同名]]` 不動。
6. 被連到的筆記正開在編輯器裡時改名另一篇：編輯器內容即時更新、不會出現「檔案已變更」衝突。改寫失敗（例如改寫期間編輯器還有未存檔的輸入）會 toast「改寫失敗，檔案已還原」，改名本身維持成功。

**L4 未連結提及**

1. 開 `60 Notes/提及目標.md`，右側欄「反向連結」最下方「未連結提及」預設收合；展開顯示「掃描中…」然後列出 4 筆：提及來源（純文字 1、別名「提及別名」1）、提及來源二（標題 1）、README（1）。已是 `[[ ]]`、code、markdown 連結裡的不算；`Note` 不命中 `Notes`。
2. 按某一筆的「連結」：那一筆消失、toast「已轉成連結」，`git diff` 只有那一行，純文字變 `[[提及目標]]`，別名那筆變 `[[提及目標|提及別名]]`；幾秒後索引更新，它出現在「連結到這篇」。
3. 「全部連結」一次改同一篇的多筆；改完後區塊上方出現「掃描」按鈕（索引變了不自動重掃），按下重掃。

**這份步驟沒涵蓋的**

- L5：Properties 的 Visible／Hidden 模式、寫入 `types.json`、Dataview 行內欄位；YAML 錨點／別名／多行字串只能用原始碼改。
- L7：指向非 `.md` 附件（PDF 等）的連結不在索引裡，改名附件不會改寫（圖片由上游處理）；`[text](Note)` 省略 `.md` 的 markdown 連結不會跟著搬；「記住選擇」設定沒做，每次都問。
- L4：純字串比對，很短或很常見的名稱會命中很多；每次展開都讀全 vault 的 `.md`，3,000 篇以內可接受。
- ~~索引的內文 `#tag` 規則~~、~~表格重排~~：2-3a 已解。

### Phase 2-3a 嵌入與跳轉、local graph、索引標題與區塊、表格原文往返

啟動方式同上。測試 vault：`node personal/make-test-vault.mjs --force`，樣本在 `60 Notes/`。第一次啟動索引會因版本升到 3 整份重建。

**表格原文往返**

1. 開 `60 Notes/雙鏈表格.md` 不改內容直接存檔：`git diff` 必須是空的（緊湊 `|---|---|` 不再補空白、表前不多空行）。`改名來源二.md`（CRLF）同樣。
2. 改一格再存：那個表格走正常序列化（會重排），其他表格不受影響。Undo 回原樣再存又是原文。

**嵌入轉入與跳轉**

1. 開 `嵌入來源.md`：整篇嵌入顯示「雙鏈目標」去掉 frontmatter 的內容，上方小字可點開；`#第二節` 只顯示那一節；`^blk-1` 只顯示那一段；`^row-1` 顯示那一列；圖片 120px 寬；「沒有這篇」虛線「找不到」；「不存在的節」顯示「這篇沒有這個標題或區塊」。
2. 「嵌入中層」在本篇內是第二層，裡面的 `![[雙鏈目標]]` 是第三層，只顯示「⧉ 雙鏈目標」晶片。
3. 存檔 diff 為空。嵌入內的 `[[連結]]` 可點。
4. 最後一行三個連結：`[[雙鏈目標#第二節]]` 開檔並捲到第二節；`[[區塊目標#^item-1]]` 捲到清單項並高亮 1.5 秒；`[[#本篇標題]]` 本篇捲動不重開。目標筆記若已在別的分頁開著也要捲。

**L8 關聯圖**

1. 右側欄多一個「關聯圖」tab（屬性之後）。開 `雙鏈目標.md`：1 層看到所有連入（雙鏈來源、雙鏈表格、改名來源一、屬性樣本…）與連出（區塊目標…），未建立的目標是虛線節點。
2. 切「2 層」多一圈；點任一節點換中心並開啟那篇；索引更新後圖會重算。

**自動完成 `#`／`^` 與索引規則**

1. 任一筆記打 `[[區塊目標#`：列 第一節、第二節、第三節；`[[區塊目標#^`：列 blk-1、item-1、row-1、sec-3（各附那一行前 60 字）；`[[#` 列本篇標題；Enter 插入 `[[區塊目標#第二節]]` 等。
2. 左側欄筆記標籤：`待辦` 1（緊接 `，` 的也算）；沒有 `12` 這個標籤。

**這份步驟沒涵蓋的**

- 嵌入：附件只找本篇同資料夾與 vault 根目錄（不讀 `.obsidian/app.json` 的附件資料夾）；嵌入內的 `- [ ]` 任務照字面顯示；大檔分段模式的非作用中段落只顯示晶片；嵌入內容不可就地編輯。
- 跳轉：目標沒有該標題時只開檔；pending 10 秒後作廢。
- 表格：只改儲存格對齊屬性而不改內容時仍輸出原文；含字面 `&nbsp;` 的表格列仍被上游換成空格。
- 關聯圖：超過 150 節點只畫前 150；不畫標籤節點。
- L1 的連結解析仍不認「相對本篇資料夾的部分路徑」（L7 已認），兩邊統一待之後。

### Phase 2-4 試用期修正：頂層區塊原文往返（Issue #18）

1. 開 `00 System/05 templates/Daily.md`，在任一 MIT 項目尾端打一個字再存：`diff` 只有那一行；`## 🎯 唯一要務` 下面的 `-` 仍是單獨一個 `-`，標題與清單之間沒有多出空行。
2. 開任一篇日記（例如 `20 Journal/21 Daily/20261020.md`，「捕捉軌」是一般項目接任務項目的混合清單）同樣打一個字再存：`diff` 只有那一行。
3. 不動內容的筆記：`* ` 項目符號、tab 縮排的巢狀清單、`1)` 編號、setext 標題、`***` 分隔線、連續兩個空行都要原樣保留（單元測試 `tests/block-roundtrip.test.ts` 已鎖定）。

### Phase 2-3b Bases 子集、.canvas 相容、大 vault 效能

啟動方式同上。測試 vault：`node personal/make-test-vault.mjs --force`（要量大 vault 加 `--big 3000`），樣本在 `60 Notes/`。

**Bases**

1. 檔案樹看得到 `60 Notes/筆記查詢.base`，點開是整頁表格，上方四個 view：「全部」21 筆、「高分」只有屬性樣本、「連到雙鏈目標」是 list 顯示 3 筆並提示還有更多、「不支援的檢視」提示退回表格。「剩餘天數」欄是 due 減今天的天數。
2. 點表頭切換排序（ASC → DESC → 取消），不會寫回檔案。「原始碼」顯示 YAML 唯讀；在 Obsidian 改這個 `.base` 後按「重新整理」會更新。
3. 開 `Bases 區塊.md`：兩個區塊在筆記內渲染成表格（專案筆記 3 篇、標籤開頭 3 篇）；不改內容直接存檔 `git diff` 為空；雙擊區塊可編輯 YAML，⌘Enter 完成。
4. 在 Obsidian 開同一個 `.base`：Obsidian 自己的 Bases 也能讀（本段只讀不寫，所以檔案不會被改）。

**`.canvas`**

1. 檔案樹看得到 `60 Notes/白板.canvas`，點開是畫布：群組「研究」框住檔案節點與文字節點，文字節點裡的 `[[雙鏈來源]]`、網址節點、群組外的卡片、兩條邊（一條有箭頭與標籤）。
2. 不動直接關閉：`git diff` 為空。拖一張卡片：500 ms 後寫檔，`git diff` 只有那個節點的 `x`／`y`，`extraField` 還在、Tab 縮排與結尾換行維持。
3. 雙擊文字節點編輯、雙擊檔案節點開筆記、點網址節點開瀏覽器、從節點拉到另一節點產生邊、「新增文字」、選取後 Delete 刪除。
4. Obsidian 同時開著同一個 `.canvas` 並改動：NoteGen 切回該分頁時若自己沒有未存變更就重讀；有未存變更則 toast「檔案在外部被修改」並停止寫入。
5. 改完後在 Obsidian 開：節點位置一致。

**大 vault 效能**

1. `node personal/make-test-vault.mjs --force --big 3000` 後啟動：Console 的 `[vault-index]` 第一次掃描時間（目標 3 秒內，含讀檔）；第二次啟動（快取命中）1 秒內。
2. 開任一 `90 Big/` 筆記：反向連結、關聯圖 2 層、`[[` 自動完成、筆記標籤樹都應即時（不到 0.1 秒）。
3. 改一篇筆記存檔：索引 1 秒內更新，不會卡住輸入。
4. `--big 10000` 仍可用，上述時間 4 倍以內。

**這份步驟沒涵蓋的**

- Bases：cards／kanban／map view、summary 列、寫回 `.base`、UI 編輯 filter、`file.embeds`、`format()` 日期格式化、正規表示式；`.base` 不在索引 watcher 內，外部改動要重新整理。
- canvas：undo／redo、群組新增、顏色選擇、圖片節點、群組背景圖；顏色 6（紫）在 UI 用琥珀顯示但寫檔保留原值。
- 效能：索引仍在主執行緒，10,000 篇以上再評估 worker 或 Rust 端。

### Phase 2-4 屬性卡片（PR #24）與上游同步（PR #25）

啟動方式：`pnpm tauri dev`（若 `/Applications` 的 NoteGen 開著，dev 版會立刻結束，先關舊版）。測試筆記：`60 Notes/屬性樣本.md`。

1. 預設是閱讀模式：沒有輸入框，日期顯示成中文、`done` 顯示「✗ 否」、`[[連結]]` 可點、`nested` 維持原文。
2. 按「編輯」：切換 `done`，再看原始碼，只有那一行變；`tags` 新增標籤仍是 `[a, b, c]` 寫法，行尾註解 `# 行尾註解要留著` 還在。
3. 點標題或箭頭收合，只剩一行摘要；開另一篇筆記狀態相同（全域一個）。
4. 開沒有屬性的筆記：頂端出現「一鍵建立 Frontmatter 範本」，title 是檔名；▾ 可換範本；設定 → 編輯器 → 屬性範本 可改範本。
5. 「移除全部」或刪光屬性：整個 frontmatter 消失，本文不變。
6. 同步後回歸：雙鏈顯示與點擊、表格不改直接存檔位元組相同、改名被連結的筆記仍跳出「改寫連結」詢問、帶 frontmatter 的長筆記存檔後 frontmatter 不變。

### Phase 2-4 小缺口 #15、#16、#17

1. #16：全新環境存檔、啟動後不再跳「Request failed … api.notegen.top/v1/embeddings」，console 也沒有 `config-manifest.json` 逾時；要恢復用 RAG 設定打開自動向量、`store.json` 設 `upstreamConfigCenterEnabled: true`。
2. #15：`![[區塊目標]]`、`![[區塊目標#^blk-1]]` 的嵌入裡看不到行尾的 `^blk-1`；被嵌入的檔案本身不變。
3. #17：新筆記按 Enter 留下空段落再存檔，檔案裡是空行、沒有 `&nbsp;`；用 Obsidian 開同一檔沒有字面 `&nbsp;`；重開檔案後再存，`diff` 為空。含既有 `&nbsp;` 行的檔案存檔不變。

### Phase 2-4 小缺口 #19、#20、#22

1. #19：沒選過排序的工作區（`store.json` 沒有 `sortType`）打開後，檔案樹每一層都是資料夾在前、檔案依名稱（`1.md`、`2.md`、`10.md`）；新建或改名的檔案落在正確位置。檔案工具列「⋯」選過「建立時間」的工作區不受影響。
2. #20：先點進編輯器內文讓它有焦點，再單擊 `[[雙鏈目標]]`：第一下就開啟目標，連結不會先變成黃框；`![[附件.png]]` 嵌入與 ⌘＋點擊行為不變；Shift＋點擊仍是 ProseMirror 的選取。
3. #22：`~/Library/Application Support/tw.scottchen.NoteGen/vault-index/<hash>.stats.json` 在每次掃描（`kind: "scan"`）與改檔（`kind: "event"`）後更新，`sinceLoadMs` 是這次網頁載入到索引就緒的時間；量測結果見 `personal/2-4-試用期紀錄.md`。

### Phase 3-1 Agent 任務中心（#30）

啟動方式：`npx pnpm@9 tauri dev`（先關 `/Applications` 的 NoteGen）。需要已設定可用的 AI 模型。在 `note-gen-wt/` 的 worktree 裡（`node_modules` 是指回主 repo 的符號連結）Turbopack 會報「Next.js package not found」，改成先 `npx next dev -p 3456`（webpack），再 `CARGO_TARGET_DIR=<主 repo>/src-tauri/target npx pnpm@9 tauri dev --config '{"build":{"beforeDevCommand":""}}'`。

1. 對話輸入框打「在 Inbox 新增一篇 測試.md，內容寫 hello」，按輸入框右側的「丟到背景執行」：輸入框清空、跳出「已交給背景任務」，右側清單按鈕出現數字。
2. 任務跑完前 vault 沒有 `Inbox/測試.md`（`ls` 確認）；跑完跳「背景任務完成，等你審核」。
3. 打開清單 → 審核：看到一筆「新增 Inbox/測試.md」，按「收下」後檔案出現在 vault 與檔案樹；任務變「已完成」。
4. 再丟一個「把 Inbox/測試.md 改名成 測試2.md 並在內容最後加一行 world」：審核畫面上改名標「逐條確認」，整批收下只寫入修改；改名要單獨按收下。
5. 衝突：丟一個修改某檔的任務，任務完成後、審核前先用外部編輯器改那個檔案；審核畫面該項顯示衝突提示，按鈕變「仍要覆蓋」。
6. 並行：連續丟三個任務，清單裡兩個進行中、一個排隊。取消進行中的那個：沒有草稿的變「已取消」。
7. 任務進行中關掉 app 再開：該任務在「沒做完」，按「繼續」重新執行，已存的草稿還在、不會重複。

### Phase 3-2 首頁骨架（#31）

1. 啟動後先看到首頁：頂部日期、週列、開啟 Daily Note；主欄今日焦點與任務；右欄今日進程與今日足跡（內容與原 Today 相同）。
2. ⌘⇧H 切到工作區，原本開著的分頁與捲動位置都在；再按一次回首頁。狀態列「今日／需處理」也會打開首頁。
3. 在首頁點任務下方的來源檔名：打開該筆記並回到工作區。
4. 「編輯首頁」關掉日程：首頁顯示「所有卡片都關掉了」；關掉「啟動時顯示首頁」後重開 app 直接進工作區；兩個設定重開後都保留。
5. 舊版存下的「今日」分頁：內容改成「今日頁已經移到首頁」與「打開首頁」按鈕。

### Phase 3-3 首頁卡片（#32）

1. 首頁頂部指令列打一句話按 Enter：日記設定的 Inbox 資料夾多一則 `YYYY-MM-DD HHmm <開頭文字>.md`；「需要你處理」裡 Inbox 的數字跟著變。
2. 指令列打一句話按 ⌘Enter：不建立筆記，「背景任務」出現一個進行中的任務。
3. 「需要你處理」：有逾期待辦、Inbox 積壓、沒連結的筆記時出現對應提醒；按「交給 Agent」先跳出預填指令，可以修改，按「開始」才建立任務。有待審草稿或沒做完的任務時也列在這裡，按鈕是「審核」／「繼續」。
4. 編輯首頁：「可以交給 Agent」下方可以開關每條規則、調門檻；改了之後提醒立刻跟著變。
5. 最近筆記：最新一篇有摘要；點任一篇會打開並回到工作區。
6. 本週足跡（先在編輯首頁打開）：新增、修改、打開筆記後，今天的長條跟著變；資料在 `~/Library/Application Support/tw.scottchen.NoteGen/home-activity.json`。

### Phase 3-4 對話摘要（#33）

1. 在右側對話問一題並帶一句自己的看法，等 AI 回答後按標題列的「對話摘要」：出現預覽，路徑是 `對話摘要/YYYY/MM/YYYY-MM-DD <主旨>.md`；「我的觀點與理解」只有自己說的話，AI 的說明在「AI 的解答重點」。
2. 改內容或路徑後按「存檔」：vault 出現該檔；用 Obsidian 開，屬性與分節正常。
3. 同一對話再按一次：按鈕變「更新摘要」、路徑沿用既有那份；存檔後仍只有一個檔案。
4. 對話用到過的筆記（RAG 來源、Agent 讀過的檔案）列在「相關筆記」為雙鏈。
5. 首頁「Agent 任務」卡：最近對話旁顯示「摘要」或「已摘要」；點對話會切過去並回到工作區。

### Phase 3-6 知識報告（二）（#35）

1. 首頁頂部「知識報告　還沒有知識報告　[建立基準]」→ 抽屜列出標籤／MOC 候選；按「請 AI 提議其他主題」多出附理由的提議；勾選後「儲存主題清單」：vault 出現 `報告/主題清單.md`，接著顯示 token 估算。
2. 按「開始」：背景任務「產生 <期別> 知識報告」→ 完成通知；首頁出現主題膠囊，「需要你處理」出現前 3 條優化建議；`報告/<期別> 知識報告.md` 的評語都附逐字引文與雙鏈，內文沒有 `- [ ]`。
3. 「完整報告」抽屜：略過一條 → 劃線、frontmatter `dismissed`；交給 Agent 一條 → 抽屜先關、出現預填指令 → 開始後 `handed`＋任務 id；任務完成後自動變 `done`。
4. 同一期再按「立即產生」：主題沒變就是 0 tokens，已處理的建議狀態保留。
5. 編輯首頁：頻率、token 上限、模型、排除資料夾、提醒開關；把上限調低並刪掉 AppData `knowledge-report/` 快取 → 「立即產生」改為在「需要你處理」出現「估算 N tokens，超過上限」與「確認產生」。
6. 打開「知識庫健康」：右欄顯示缺少連結／孤立筆記／Inbox 積壓／筆記數，取自最新一期。

### Phase 3-5 知識報告（一）（#34）

沒有畫面，驗收在 #35 的報告卡一起做。本 PR 以單元測試（`src/lib/knowledge-report/knowledge-report.test.ts`）與對測試 vault 的一次唯讀試算確認。
1. 用 Obsidian 手機版打開 `報告/主題清單.md`，改一個主題的標籤或刪掉「狀態：待確認」：下次報告依新清單計算。
2. 權重校準：用真實 vault 跑一次，看各主題的等級是否符合自己的感覺，再調 `DEFAULT_MASTERY_CONFIG`。
