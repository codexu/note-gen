---
title: "上游程式碼直接 parse 整份筆記時，要先過 encodeFrontmatterForEditor"
author: Scottchen
date: 2026-11-17
branch: sync/upstream-2026-11-17
cost: { minutes: 4, tokens: 47831 }
id: l-6fc6de61
scope: repo
status: active
src: agent
touches:
  - tests/agent-edit-frontmatter.test.ts
  - src/app/core/main/editor/markdown/agent-markdown-edit.ts
---

## Decided
- fork 的 Frontmatter 節點只認 `encodeFrontmatterForEditor()` 產生的 marker。上游新寫的程式碼若直接對「整份筆記」呼叫 `editor.markdown.parse()`，開頭的 `---` 會被解析成 horizontalRule 加標題。
- 2026-11-17 同步上游時，在 `src/app/core/main/editor/markdown/agent-markdown-edit.ts` 加了 `parseNoteMarkdown()`，整份筆記的 parse（assertAgentMarkdownChangeLocal、buildAgentMarkdownEdit、applyAgentSnapshotRestore）都改走它。片段 parse（單行內容、`1. ...`）不編碼。
- 含 `notegen-wiki-origin:` 的 frontmatter 在 `encodeFrontmatterForEditor` 直接放行，交給上游 `WikiMetadata` 節點（唯讀，Agent 不可改）。不放行的話會被包成 fork 的屬性卡片，繞過上游的 `assertAgentMetadataPreserved` 保護。代價是 Wiki 筆記不顯示屬性卡片。

## Tried and ruled out
- 只用 buildAgentMarkdownEdit 寫回歸測試沒用：它會把原始快照和現行文件之間的序列化差異 rebase 掉，就算沒編碼也能通過。真正壞掉的是 applyAgentSnapshotRestore（回看撤銷），它用 parse 結果覆蓋整份文件。測試寫在 `tests/agent-edit-frontmatter.test.ts`，已確認拿掉編碼時會失敗。

## Watch out
- 之後每次同步上游，都用 grep 找新增的 `editor.markdown?.parse(` 和 `setContent(..., { contentType: 'markdown' })`：只要輸入是整份筆記，就要套上編碼。
