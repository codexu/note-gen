---
title: NoteGen 產品定位是取代桌面 Obsidian，行動版不能壞；PRODUCT.md 被 gitignore
author: Scottchen
date: 2026-11-01
branch: dev
cost: { minutes: 6, tokens: 119871 }
id: l-afa91909
scope: repo
status: active
src: agent
touches:
  - PRODUCT.md
  - personal/PLAN.md
  - GLOSSARY.md
  - README.md
---

## Decided
- `/impeccable init`（2026-11-01）經 Scott 確認：定位是取代桌面 Obsidian，成為第二大腦、個人資料、日程的單一中心；使用者以 Scott 為主，也會分享給別人；macOS 桌面版是設計基準，改共用元件時行動版不能壞。
- 著陸頁與展示型畫面用 comp-first（`.impeccable/config.json` 的 `buildPath: comp`）；app 畫面與文件一律直接寫程式。

## Tried and ruled out
- 定位不採「先捕捉、後整理」（上游主張）或「AI 知識管家」：Scott 選了取代 Obsidian。
- 平台不採「只做 macOS」（`personal/PLAN.md` 的 D5）或「桌面與行動都維護」：改為 macOS 為主、行動版不能壞。
- 建置方式不採 code-first：Scott 選了先產圖定標準。

## Watch out
- 根目錄 `.gitignore` 的 `/*.md` 會忽略 `PRODUCT.md`，新 worktree 不會有這個檔案，要手動複製。
- `impeccable detect-csp` 回報的 `meta-tag` 來自外掛 iframe（`src/components/plugins/plugin-*-preview.tsx`、`plugin-sandboxed-view.tsx`），不是 app 主頁的 CSP，不需要為 live mode 修改。
