# P0-b 色彩清查報告（2026-11-18）

## 範圍與規則

- 目標：把「primary 當強調色」與「非白名單具名彩色 class」從介面樣式清掉。
- 白名單（改成 `*-brand`）：文字連結／筆記連結、已勾選任務 checkbox、caret、引言左側色條。
- 強調（改成中性）：選中用 `bg-active text-ink`／`bg-invert text-invert-ink`，淡底用 `bg-hover`，強調文字用 `text-ink font-medium`，進度條用 `bg-ink`。
- 主要按鈕 `bg-primary text-primary-foreground`（反白）保留不改。
- 資料本身保留：編輯器語法高亮、圖表／關聯圖分類色、使用者自選文字／標記顏色、canvas 節點顏色、匯出 HTML 樣式、測試檔、Obsidian 色彩對照、主題預設色。
- 排除清單（另一條線在改）：`left-sidebar.tsx`、`sidebar-row.ts`、`sidebar-search.tsx`、`main-status-bar.tsx`、`status-bar-order.tsx`、`command.tsx`、`kbd.tsx`、`button.tsx`、`plugin-command-palette.tsx`、`fork-theme.css`、`fork-tokens.css`、`globals.css` → 這些檔案內的寫死色／primary 列為「交給 P0-c」。

---

## 統計

| 項目 | 數量 |
| --- | --- |
| 修改檔案數 | 127 |
| 修改處數（primary／具名彩色 class 介面樣式） | 284 |
| 保留處數（資料／semantic success-danger／分類色） | 約 120 |
| 交給 P0-c（排除清單檔案內的寫死色） | 約 15 |

備註：tsc 與 vitest 均通過（見文末第四節 PM 複驗）。

---

## 一、修改（primary 當強調色 → 中性／brand）

表格欄位：`檔案:行號｜原本｜處理｜改成`

### 反向連結／關聯圖

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| backlinks-panel.tsx:25 | `bg-primary/10 text-primary`（mark 連結高亮） | 改 | `bg-brand/10 text-brand` |
| backlinks-panel.tsx:95 | `text-primary hover:bg-primary/10 focus-visible:ring-primary`（link 按鈕） | 改 | `text-brand hover:bg-hover focus-visible:ring-ink` |
| backlinks-panel.tsx:100,160,182 | `text-primary`（數量強調） | 改 | `text-ink font-medium` |
| backlinks-panel.tsx:123,171 | `hover:bg-muted focus-visible:ring-primary` | 改 | `hover:bg-hover focus-visible:ring-ink` |
| backlinks-panel.tsx:125 | `bg-primary/10 text-primary`（mention 高亮） | 改 | `bg-brand/10 text-brand` |
| local-graph-panel.tsx:14 | `border-primary bg-primary text-primary-foreground`（中心節點） | 改 | `border-line bg-active text-ink` |
| local-graph-panel.tsx:16 | `border-primary/40 bg-primary/10 text-foreground`（同資料夾） | 改 | `border-line bg-hover text-ink` |
| local-graph-panel.test.ts:21-22 | 斷言舊 class | 改（反映源碼） | 改為新 class 斷言 |

### Today 系列

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| today-page.tsx:117 | `bg-primary/10 ring-primary/50`（今天） | 改 | `bg-active ring-ink/40` |
| today-page.tsx:122,189 | `bg-primary`（圓點／優先條） | 改 | `bg-ink` |
| today-page.tsx:217-223 | `bg-primary/10 text-primary border-primary/50`（承接提示） | 改 | `bg-hover text-ink border-line` |
| today-page.tsx:238 | `text-primary`（逾期警示） | 改 | `text-destructive` |
| today-page.tsx:241 | `bg-primary/10 text-primary`（逾期天數） | 改 | `bg-hover text-ink font-medium` |
| today-page.tsx:340 | `text-primary`（優先標籤） | 改 | `text-ink` |
| today-page.tsx:386-388 | `text-primary bg-primary/50`（現在線） | 改 | `text-ink bg-ink/50` |
| today-page.tsx:455 | `border-primary bg-primary shadow-primary/15`（now 點） | 改 | `border-ink bg-ink shadow-ink/15` |
| today-page.tsx:472 | `bg-primary`（進度條） | 改 | `bg-ink` |
| today-page.tsx:490 | `bg-primary/10 text-primary`（warn tile） | 改 | `bg-hover text-ink` |
| time-blocks.tsx:151-155 | `border-primary bg-primary/10 ring-primary/60`（task block） | 改 | `border-line bg-hover ring-ink/60` |
| time-blocks.tsx:175-176 | `bg-primary`（現在線與點） | 改 | `bg-ink` |
| time-blocks.tsx:181-182 | `border-primary bg-primary text-primary-foreground`（ghost） | 改 | `border-ink bg-invert text-invert-ink` |
| today-status-item.tsx:50 | `text-primary`（警示圖示） | 改 | `text-ink` |
| quick-add.tsx:74 | `bg-primary/10 text-primary`（accent chip） | 改 | `bg-hover text-ink font-medium` |
| daily-calendar.tsx:61,109 | `after:bg-primary bg-primary`（任務點／圖例） | 改 | `after:bg-ink bg-ink` |
| sidebar-calendar.tsx:117-118,124 | `text-primary ring-primary/40 bg-primary`（今天／選中） | 改 | `text-ink ring-ink/40 bg-active` |

### 首頁卡片

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| capture-bar.tsx:51-52 | `ring-primary/50 text-primary` | 改 | `ring-ink/50 text-ink` |
| report-card.tsx:53-54 | `bg-primary/15 text-primary`／`bg-primary text-primary-foreground` | 改 | `bg-hover text-ink font-medium`／`bg-active text-ink font-medium` |
| report-drawer.tsx:67 | `border-primary/50`（引言左側） | 改 | `border-line` |
| report-drawer.tsx:106 | `text-primary`（done 圖示） | 改 | `text-ink` |
| footprint-card.tsx:60-61,70-71 | `bg-primary bg-primary/50`（足跡長條） | 改 | `bg-ink bg-ink/50` |
| tasks-card.tsx:24-30 | `text-primary text-sky-700 text-emerald-700`（狀態 tone） | 改 | `text-ink` |
| tasks-card.tsx:142 | `text-emerald-700`（summarized） | 改 | `text-ink` |
| needs-list.tsx:18 | `text-primary`（tone primary） | 改 | `text-ink` |

### 屬性／標籤／mark

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| properties-panel.tsx:37,49 | `text-primary bg-primary/10 text-primary` | 改 | `text-ink bg-hover text-ink font-medium` |
| frontmatter-card-view.tsx:55 | `text-primary decoration-primary/40 hover:decoration-primary`（連結） | 改 | `text-brand decoration-brand/40 hover:decoration-brand` |
| frontmatter-card-view.tsx:133,180,182,206,313 | `bg-primary/10 text-primary hover:bg-primary/5` | 改 | `bg-hover text-ink font-medium`／`hover:bg-hover` |
| note-tags-sidebar.tsx:93-216（多處） | `text-primary bg-primary/10 ring-primary` | 改 | `text-ink font-medium bg-active ring-ink` |
| mark-item.tsx:151,199,289,588,648,653 | `text-primary bg-primary` | 改 | `text-ink bg-ink`（連結改 `text-brand`，勾選改 `text-brand`） |
| mark-item.tsx:1008-1015 | `bg-primary/8 ring-primary/40` | 改 | `bg-hover ring-ink/40` |
| tag-item.tsx:91,99 | `bg-primary text-primary-foreground text-primary-foreground/70` | 改 | `bg-active text-ink text-ink/70` |
| clipboard.tsx:165,171 | `bg-primary`（剪貼簿底） | 改 | `bg-invert` |
| image-gallery.tsx:157 | `ring-primary`（選中） | 改 | `ring-ink` |
| organize-notes.tsx:1060,1071-1072 | `border-primary bg-primary text-primary-foreground`（step） | 改 | `border-line bg-active text-ink` |
| todo-edit-button.tsx:61 | `text-primary`（active） | 改 | `text-ink` |
| mark-filter-popover.tsx:93 | `border-primary/30 bg-primary/8` | 改 | `border-line bg-hover hover:bg-active` |
| mark-loading.tsx:29 | `text-primary`（spinner） | 改 | `text-ink` |
| mark-detail-panel.tsx:984,996 | `text-primary underline`（連結） | 改 | `text-brand` |

### 檔案管理

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| folder-item/index.tsx:169,989 | `text-primary`（資料夾圖示） | 改 | `text-ink` |
| file-toolbar.tsx:95 | `text-primary`（BookA） | 改 | `text-ink` |
| file-footer.tsx:287 | `text-primary`（workspace 圖示） | 改 | `text-ink` |
| file-tree-decorations.tsx:73 | `text-primary`（wikiWorking） | 改 | `text-ink` |
| file-manager.tsx:1190 | `border-primary/70 bg-primary/10`（選取框） | 改 | `border-ink/40 bg-hover` |
| inbox-screen.tsx:95-97 | `bg-primary/10 bg-primary`（focused 列） | 改 | `bg-hover hover:bg-active bg-ink` |
| tab-bar.tsx:170-190,207 | `text-primary bg-primary text-amber-500`（圖示／底線） | 改 | `text-ink bg-ink` |

### 編輯器

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| editor-layout.tsx:209-210 | `bg-primary/10 bg-primary/25 ring-primary/60`（drop zone） | 改 | `bg-hover bg-active ring-ink/60` |
| unsupported-file.tsx:168 | `hover:text-primary` | 改 | `hover:text-ink` |
| browser-panel.tsx:626 | `text-primary`（書籤星號） | 改 | `text-ink` |
| skills-list.tsx:38-85 | `text-primary bg-blue-50/50 bg-purple-50/50` | 改 | `text-ink bg-hover` |
| skill-detail.tsx:19 | `text-primary` | 改 | `text-ink` |
| folder-stats.tsx:236 | `bg-primary/10 text-primary` | 改 | `bg-hover text-ink` |
| wiki-folder-view.tsx:53 | `bg-primary/10 text-primary` | 改 | `bg-hover text-ink` |
| empty-state.tsx:641 | `text-primary`（連結） | 改 | `text-brand` |
| table-context-toolbar.tsx:60 | `text-primary`（active） | 改 | `text-ink` |
| wikilink-suggest.tsx:381,404,426-427 | `text-primary bg-primary/10` | 改 | `text-ink bg-hover` |
| math-extension.tsx:133 | `focus:ring-primary` | 改 | `focus:ring-ink` |
| slash-menu.tsx:343,387,426 | `bg-primary/10 text-primary`（選中） | 改 | `bg-active text-ink font-medium` |
| bubble-menu.tsx:806 | `text-primary` | 改 | `text-ink` |
| history-sheet.tsx:325,354 | `hover:text-primary` | 改 | `hover:text-ink` |
| ai-suggestion-floating.tsx:440,442,468,470 | `text-blue-500 text-primary` | 改 | `text-ink` |
| tiptap-editor.tsx:8029,8086,8090 | `bg-primary text-primary-foreground border-primary/60 bg-primary/5 text-primary` | 改 | `bg-invert text-invert-ink border-ink/60 bg-hover text-ink` |

### 聊天

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| response-controls.tsx:101 | `text-primary underline`（連結） | 改 | `text-brand` |
| artifact-link.tsx:53 | `text-primary underline`（連結） | 改 | `text-brand` |
| agent-context-tray.tsx:195,204 | `text-primary hover:underline`（連結） | 改 | `text-brand` |
| history-dropdown.tsx:106 | `group-hover:text-primary` | 改 | `group-hover:text-ink` |
| quote-display.tsx:59 | `text-primary`（show more） | 改 | `text-ink` |
| chat-empty.tsx:122,140,145,170 | `text-primary bg-primary-foreground hover:border-primary/50` | 改 | `text-ink bg-background hover:border-line` |
| chat-images.tsx:34 | `hover:border-primary` | 改 | `hover:border-line` |
| chat-header.tsx:137 | `group-hover:text-primary` | 改 | `group-hover:text-ink` |
| chat-input.tsx:1568-1569,1597 | `border-primary/50 border-primary bg-primary/5 text-primary` | 改 | `border-line bg-hover text-ink` |
| agent-panel-with-rag.tsx:321,339,348,354 | `group-hover:text-primary text-primary text-blue-500` | 改 | `group-hover:text-ink text-brand text-ink` |
| agent-run-timeline.tsx:77,97,289 | `text-primary`（spinner/sparkle） | 改 | `text-ink` |
| chat-thinking.tsx:55,57 | `text-blue-500` | 改 | `text-ink` |
| chat-clipboard.tsx:145,172 | `text-red-500`（倒數） | 改 | `text-ink` |
| mcp-tool-call.tsx:22 | `text-yellow-500`（calling） | 改 | `text-ink` |

### 其他 UI

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| sync-status-badge.tsx:45,51,75,122-123 | `text-primary bg-primary`（狀態 icon／pending 點） | 改 | `text-ink bg-ink` |
| search-dialog.tsx:118,161,163 | `bg-primary/15 border-primary/20 bg-primary/10 text-primary` | 改 | `bg-hover border-line text-ink font-medium` |
| agent-plan.tsx:689-697,832,958,973-975 | `text-primary bg-primary/60` | 改 | `text-ink bg-ink/60` |
| plugin-item-list.tsx:31 | `bg-primary/15`（高亮） | 改 | `bg-hover` |
| record-sync-status-banner.tsx:40 | `border-primary/20 bg-primary/5` | 改 | `border-line bg-hover` |
| activity-day-detail.tsx:156 | `bg-primary`（時間軸點） | 改 | `bg-ink` |
| activity-heatmap.tsx:73-74 | `ring-primary`（選中） | 改 | `ring-ink` |
| onboarding-spotlight.tsx:79 | `border-primary` | 改 | `border-ink` |
| title-bar.tsx:252 | `bg-primary/50 hover:bg-primary/60`（settings 開） | 改 | `bg-active hover:bg-active` |
| knowledge-setting-card.tsx:25 | `bg-primary/10 text-primary` | 改 | `bg-hover text-ink` |
| expandable-tabs.tsx:55 | `activeColor="text-primary"` | 改 | `"text-ink"` |
| empty.tsx:76 | `[&>a:hover]:text-primary` | 改 | `[&>a:hover]:text-brand` |
| field.tsx:107,155 | `border-primary/30 bg-primary/5 [&>a:hover]:text-primary` | 改 | `border-line bg-active [&>a:hover]:text-brand` |
| item.tsx:142 | `[&>a:hover]:text-primary` | 改 | `[&>a:hover]:text-brand` |
| progress.tsx:25 | `bg-primary`（進度條） | 改 | `bg-ink` |
| slider.tsx:45 | `bg-primary`（滑桿） | 改 | `bg-ink` |
| avatar.tsx:65 | `bg-primary text-primary-foreground`（badge） | 改 | `bg-invert text-invert-ink` |

### 設定

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| webSearch/page.tsx:163,431 | `text-primary bg-primary/10 text-primary` | 改 | `text-ink bg-hover text-ink` |
| ai/page.tsx:525 | `data-[state=on]:border-primary data-[state=on]:bg-primary/5` | 改 | `data-[state=on]:border-line data-[state=on]:bg-active` |
| ai/model-card.tsx:234 | `text-primary` | 改 | `text-ink` |
| sync/page.tsx:414 | `data-[state=on]:border-primary data-[state=on]:bg-primary/5` | 改 | `data-[state=on]:border-line data-[state=on]:bg-active` |
| imageHosting/page.tsx:267,301 | `data-[state=on]:border-primary data-[state=on]:bg-primary/5` | 改 | `data-[state=on]:border-line data-[state=on]:bg-active` |
| imageHosting/smms.tsx:88, picgo.tsx:96, github.tsx:176, s3.tsx:138, service-settings-card.tsx:103 | `text-primary`（成功 check） | 改 | `text-ink` |
| sync/workspace-repo-mapping.tsx:566,655,682,692,710 | `text-primary border-primary/35 bg-primary/10` | 改 | `text-ink border-line bg-hover` |
| sync/self-hosted-sync.tsx:326 | `text-primary underline`（連結） | 改 | `text-brand` |
| sync/components/token-input-control.tsx:72 | `text-blue-500`（連結） | 改 | `text-brand` |
| sync/webdav-sync.tsx:92, s3-sync.tsx:95 | `text-blue-500`（loading） | 改 | `text-ink` |
| interface/theme-color-picker.tsx:121 | `hover:border-primary` | 改 | `hover:border-line` |
| interface/theme-presets.tsx:374-375 | `hover:border-primary` | 改 | `hover:border-line` |
| about/updater.tsx:115 | `[&_a]:text-primary`（連結） | 改 | `[&_a]:text-brand` |
| shortcuts/editor-shortcut-input.tsx:138 | `border-primary`（錄製中） | 改 | `border-ink` |

### Canvas／mobile

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| canvas-sidebar.tsx:96,99,100,550,561,606 | `border-primary/40 bg-primary/10 text-primary border-amber-500` | 改 | `border-line bg-hover text-ink` |
| canvas-nodes.tsx:46-47 | `border-primary bg-primary/5 ring-primary/40` | 改 | `border-line bg-hover ring-ink/40` |
| obsidian-canvas-page.tsx:36,46-47 | `bg-primary/10 text-primary` | 改 | `bg-hover text-ink`（連結 `text-brand`） |
| mobile/writing/entry-list-item.tsx:132,139,140 | `outline-primary bg-primary/5 ring-primary` | 改 | `outline-ink bg-hover ring-ink` |
| mobile/writing/custom-header.tsx:1083 | `border-primary bg-primary/5 text-primary` | 改 | `border-line bg-hover text-ink` |
| mobile/setting/theme/page.tsx:545 | `hover:border-primary` | 改 | `hover:border-line` |
| mobile/setting/mobile-me-profile-card.tsx:55 | `text-primary` | 改 | `text-ink` |
| mobile/chat/model-selector.tsx:60, prompt-selector.tsx:47 | `bg-primary border-primary text-primary-foreground` | 改 | `bg-active border-line text-ink` |
| mobile/canvas/page.tsx:288 | `text-primary`（pin） | 改 | `text-ink` |
| mobile/record/mobile-record-stream.tsx:604,699 | `bg-primary border-primary/30` | 改 | `bg-ink border-line` |
| mobile/chat/mcp-selector.tsx:63 | `text-yellow-600` | 改 | `text-ink` |
| screenshot/page.tsx:577,580 | `border-primary`（選取框） | 改 | `border-ink` |

### 具名彩色（其他）

| 檔案:行號 | 原本 | 處理 | 改成 |
| --- | --- | --- | --- |
| server-config-dialog.tsx:240 | `text-amber-500` | 改 | `text-ink` |
| control-scan.tsx:732,763 | `text-amber-300` | 改 | `text-ink` |
| prompt-version-banner.tsx:149 | `border-amber-200/60 bg-amber-50 text-amber-900` | 改 | `border-line bg-hover text-ink` |
| simple-mobile-tool.tsx:59,70 | `border-red-500/40 bg-red-500/10 text-red-600` | 改 | `border-line bg-active text-ink` |
| recording-indicator.tsx:44-45 | `text-red-500 bg-red-500` | 改 | `text-ink bg-ink` |
| recording-dialog.tsx:136,142 | `bg-red-500 bg-yellow-500` | 改 | `bg-ink` |
| app-footbar.tsx:236 | `rgb(239 68 68)` | 改 | `var(--danger)` |
| agent-tasks-sheet.tsx:37-38,90,100,113 | `text-primary text-sky-500 bg-emerald-500/15` | 改 | `text-ink bg-hover` |
| agent-tasks/background-task-controls.tsx:45 | `bg-primary text-primary-foreground` | 改 | `bg-invert text-invert-ink` |
| prompt-library-screen.tsx:228 | `bg-primary/10 hover:bg-primary/15` | 改 | `bg-active hover:bg-active` |
| link-rewrite-prompt.tsx:63,72,76 | `text-primary bg-primary/10` | 改 | `text-ink bg-hover` |
| bases-view.tsx:52,57,70,114 | `text-primary` | 改 | `text-brand`（連結／checkbox）／`text-ink`（排序） |
| wikilink-embed-view.tsx:483 | `text-primary underline`（連結） | 改 | `text-brand` |

---

## 二、保留（資料／semantic success-danger／分類色）

| 檔案 | 原本 | 保留理由 |
| --- | --- | --- |
| lib/obsidian-canvas/flow.ts | `#e05252` 等 Obsidian 節點色 | Obsidian 色彩對照（匯入用） |
| lib/text-colors.ts | `TEXT_COLORS`／`HIGHLIGHT_COLORS` | 使用者自選文字／標記顏色清單 |
| lib/markdown/export-document.ts | 匯出 HTML 樣式色碼 | 匯出文件樣式 |
| lib/plugins/documents.ts | `#262626` 等文章 CSS | 匯出 CSS |
| lib/plugins/code-block-export.ts | `#ffffff` | canvas 匯出填充 |
| lib/canvas/static-export.ts | `#18181b` 等 SVG 色 | 靜態 SVG 匯出樣式 |
| lib/canvas/templates.ts | `#ef4444` 等模板分類色 | canvas 模板節點顏色 |
| lib/canvas/chart-appearance.ts | `#2563eb` 等圖表色盤 | 圖表分類色 |
| lib/infographic.ts | `hsl()` 解析與錯誤樣式 | 匯出／資料 |
| components/ui/chart.tsx | chart 主題色 | 圖表分類色 |
| components/markdown/streamdown-renderer.tsx | `backgroundColor`／`#1f2937` | 使用者標記顏色渲染 |
| components/ui/shine-border.tsx | `#000000` 預設 | 裝飾預設值 |
| components/ui/sonner.tsx | `hsl(var(--popover))` 等 | 使用語意 token |
| components/ui/modern-mobile-menu.tsx | `hsl(var(--component-*))` | 元件 token |
| components/mobile-record-tools.tsx | `hsl(var(--component-*))` | 元件 token |
| components/plugins/plugin-sandboxed-view.tsx | 探測色 `#fff` | 外掛主題探測 |
| mobile/setting/theme/page.tsx | 主題預設色碼 | 使用者自選主題預設 |
| setting/interface/theme-presets.tsx | 主題預設色碼 | 使用者自選主題預設 |
| setting/interface/theme-color-picker.tsx | 預設色碼 | 使用者自選顏色 |
| screenshot/page.tsx | 標註顏色清單 | 使用者自選顏色清單 |
| editor/markdown/markdown-export.ts | 匯出 HTML 色碼 | 匯出文件樣式 |
| editor/markdown/tiptap-editor.tsx | `REMOTE_CURSOR_COLORS` | 協作者游標色 |
| editor/markdown/source-markdown-editor.tsx | `REMOTE_CURSOR_COLORS`／語法主題 | 編輯器語法高亮 |
| editor/markdown/color-marks.ts | 使用者標記色 | 資料 |
| editor/markdown/color-menu.ts | `hsl(var(--primary) / 0.3)`／`currentColor` | 高亮指示器語意 token |
| editor/markdown/image-node-view.ts | `hsl(var(--muted) / 0.35)` | 語意 token |
| editor/markdown/quote-mark.ts | `hsl(var(--primary) / 0.12)` | 引言 mark 語意 token |
| components/activity/*.tsx | `emerald`／`rose`／`sky` 活動分類 | 活動資料分類色 |
| components/activity/activity-legend.tsx | `emerald` 熱度 | 資料視覺化 |
| mark/mark-type-meta.ts | `lime/rose/cyan/fuchsia/blue/amber/violet` | record 類型分類色 |
| mark/mark-detail-panel.tsx | 類型色／`green/yellow/red` 優先度 | 分類色／優先度 |
| mark/todo-item-content.tsx | `green/orange/red` 優先度 | 優先度資料 |
| mobile-me-profile-card.tsx | `emerald/sky/amber` 帳號類型 | 帳號類型分類 |
| plugin-article-preview.tsx | `red/amber/green` 圓點 | 視窗控制裝飾 |
| 多處 | `text-red-*`／`text-destructive` | danger／錯誤語意保留 |
| 多處 | `text-green-*`／`text-emerald-*`／`text-success` | success 語意保留 |
| fork-theme.test.ts | 色碼斷言 | 測試檔 |
| components/ui/checkbox.tsx／switch.tsx／radio-group.tsx／calendar.tsx | `bg-primary` 等 | shadcn form control（primary = 反白） |

---

## 三、交給 P0-c（排除清單檔案內寫死色）

| 檔案 | 寫死色／primary 位置 |
| --- | --- |
| core/main/left-sidebar.tsx | 側欄樣式 |
| core/main/sidebar-row.ts | 列樣式 |
| core/main/sidebar-search.tsx:99 | `bg-primary/15` |
| core/main/main-status-bar.tsx | 狀態列 |
| core/main/status-bar-order.tsx:170,209 | `border-primary` |
| components/ui/command.tsx | 命令面板 |
| components/ui/kbd.tsx | kbd 樣式 |
| components/ui/button.tsx:12,21 | `bg-primary text-primary-foreground`／`text-primary` |
| components/plugins/plugin-command-palette.tsx | 外掛命令面板 |
| app/fork-theme.css／fork-tokens.css／globals.css | token 定義 |

---

## 四、型別與測試結果（PM 複驗後更正）

- `npx tsc --noEmit`：通過。
- `npx vitest run`：82 檔 1058 測試全部通過（PM 在同一個 worktree 重跑）。Command Code 回報的「10 檔失敗、既有環境問題」不成立，推測是它執行時的環境差異，已作廢。
- `local-graph-panel.test.ts` 是 class 字串的規格測試，隨規格更新：中心節點改反白（`bg-invert text-invert-ink`），同資料夾用 `bg-hover`。

## 五、PM 補改（Command Code 漏掉的介面用色）

- `editor/markdown/sync/history-sheet.tsx:374`：連結 `text-blue-500` → `text-brand`
- `chat/agent-panel-with-rag.tsx:279`：圖示 `text-blue-500` → `text-muted-foreground`
- `mark/todo-item-content.tsx:68`：中優先級圓點 `bg-orange-500` → `bg-muted-foreground`（low 綠、high 紅保留為 success／danger）
- `mobile/setting/components/mobile-me-profile-card.tsx`：sky／amber 狀態框與徽章 → `border-line`、`bg-sunken text-ink`
- 保留：`mark/mark-type-meta.ts`、`mark/mark-detail-panel.tsx` 的記錄類型分類色（使用者辨識類型的分類資料；fork-tokens.css 已把這些色票轉成暖灰，視覺上已是單色）、`canvas/canvas-editor.tsx:2800` 的顏色選擇器色塊（使用者資料）。
