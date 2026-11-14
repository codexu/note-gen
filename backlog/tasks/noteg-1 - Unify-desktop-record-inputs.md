---
id: NOTEG-1
title: Unify desktop record inputs
status: Done
assignee:
  - '@scottchen'
created_date: '2026-10-31T03:49:00Z'
updated_date: '2026-10-31T16:32:00Z'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The desktop title bar and record header expose up to eight independently implemented record controls. The approved A design uses one compact entry point, where users type or paste first and explicitly expand for detailed fields while preserving existing record types and save behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Desktop title bar and record header show one unified record entry point instead of eight independent buttons
- [x] #2 The dialog supports automatic text versus single HTTP(S) link classification and manual selection with Cmd+1 through Cmd+8 on macOS and Alt+1 through Alt+8 on Windows/Linux (Windows/Linux covered by unit tests only)
- [x] #3 The dialog exposes attachment, recording, and screenshot actions without discarding the current draft
- [x] #4 Text, link, todo, and prompt-draft records persist with their existing database contracts and completion behavior
- [x] #5 In-app record shortcuts and tray record actions open the unified dialog with the requested record type; the tray screenshot action and global Cmd+Shift+S start screenshot capture directly, and global Cmd+Shift+T keeps its standalone quick-record window
- [x] #6 No files under src/app/mobile change; hands-on mobile verification is out of scope
- [x] #7 Focused automated tests cover classification and shortcut selection, and project verification passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-31 由 Claude 接手（Codex 第 10 輪撞用量上限中止）。Review 後修正：待辦保留共用草稿（resolveUnifiedTodoDraft）；連結補 https 並恢復部分擷取提示；媒體動作關視窗但保留草稿；新增檔案與音訊檔入口（toolbar-shortcut-recording-file）；入口顯示錄音時長與停止；接回 onboarding prefill／create-record 完成事件；來源欄只在 prompt-draft 顯示；字串進 6 語系 i18n；host 只留媒體控制項並還原 control-text；移除無人使用的 draggable-toolbar-item 與 toolbar-shortcuts。驗證：tsc、eslint、vitest 1042/1042 通過。未驗證：桌面實機互動（Mac 鎖定，鎖定時 WebView 不繪製，截圖全黑無法判斷）。/Applications 內仍是修正前的版本。

2026-10-31 實機驗收（隔離 identifier tw.scottchen.NoteGen.accept）。通過並寫入 DB：文字（滑鼠存檔與 Cmd+Enter）、待辦（第一行為標題、其餘為說明）、prompt-draft（含來源網址）、連結（Cmd+1、自動判斷、裸網域補 https、404 時顯示部分擷取提示）、圖片、檔案、音訊檔、麥克風錄音（入口顯示時長與停止）。草稿在媒體流程後保留。Cmd+1 到 Cmd+8 在 ABC 與注音下都能選到正確類型（AC2 未勾，見下）。新手引導範例帶入，存檔後 create-record 完成。截圖只驗到開啟視窗，未按儲存（畫面含真實內容，且會送辨識）。實測發現並修正：注音下 event.key 不是數字，改同時比對 event.code。Cmd+0 在這台 Mac 上被全域熱鍵攔走（最小 WKWebView 視窗同樣收不到），非 app 問題。mark-header 在桌面沒有掛載點，AC1 以標題列為準。未驗證：系統匣動作（AC5，與正式版的系統匣無法區分）、行動版（AC6）、Windows/Linux（AC2 寫 Cmd/Ctrl，實作沿用 Alt，待決定）。

2026-10-31 系統匣驗證（正式版已關閉，只有測試版的系統匣）：文本、录音、插圖、連結、文件、待辦都會開統一視窗並選好類型。系統匣「截圖」走 Rust start_desktop_screenshot，不開統一視窗，未改動也未在此次驗證，所以 AC5 未勾。新版 2063ff0b 已安裝到 /Applications 並確認主畫面正常顯示。

2026-11-01 使用者同意：Windows/Linux 維持 Alt+數字，AC2 改寫；系統匣截圖維持直接進截圖、不開統一視窗，AC5 放寬。AC2 尚缺 Windows/Linux 實機、AC5 尚缺系統匣截圖實測，所以都還沒勾。

2026-11-01 使用者決定不驗行動版與 Windows/Linux，AC2、AC6 依此改寫。實機驗收（隔離測試版，關閉影像辨識，所以 OCR 與摘要未跑）：系統匣截圖進框選畫面，Enter 後寫入 scan 記錄（400x200 PNG）；統一視窗的截圖按鈕開舊的視窗截圖面板，「僅保存截圖」寫入 scan 記錄，草稿保留；⌘⇧S 直接進截圖，Esc 可取消。發現：全域 ⌘⇧T 開既有的獨立快速記錄小視窗（quick-record-text.ts，此分支未改），不開統一視窗，和 AC5 條文不符，所以 AC5 未勾，待使用者決定。

2026-11-01 使用者同意保留 ⌘⇧T 獨立小視窗，AC5 依此改寫並勾選。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
桌面標題列的 8 個記錄按鈕改為單一入口與統一視窗：可自動判斷文字或連結、以 Cmd+1–8 指定類型（Windows/Linux 為 Alt+1–8），媒體動作不丟草稿。系統匣截圖與 ⌘⇧S 維持直接進截圖，⌘⇧T 維持獨立小視窗。驗證：tsc、改動檔 eslint、vitest 1043/1043、release 打包通過；macOS 測試版實機驗過各記錄類型、系統匣、快捷鍵與截圖儲存。未驗：截圖的 OCR 與 AI 摘要（驗收時關閉辨識）、正式版截圖（需螢幕錄製權限）、⌘0（這台 Mac 被全域熱鍵攔走）、Windows/Linux 與行動版實機（使用者決定不驗；行動版會載入共用的 control-recording.tsx，此次有小改動）。
<!-- SECTION:FINAL_SUMMARY:END -->
