# NoteGen 專案結構註解

## 專案概述

NoteGen 是一個跨平台的 Markdown 筆記應用程式，專注於使用 AI 橋接記錄和寫作，將碎片化知識組織成可讀的筆記。

## 專案結構

### 根目錄檔案
- `package.json` - 專案依賴和腳本配置
- `next.config.ts` - Next.js 配置
- `tailwind.config.ts` - Tailwind CSS 配置
- `tsconfig.json` - TypeScript 配置
- `postcss.config.mjs` - PostCSS 配置
- `.eslintrc.json` - ESLint 配置
- `README.md` - 專案說明文檔

### src/ 目錄
- `app/` - Next.js App Router 頁面和路由
- `components/` - React 元件
  - `ui/` - UI 組件 (如 Button, Input 等)
  - `webview.tsx` - WebView 元件，用於嵌入瀏覽器
- `config/` - 配置檔案
- `db/` - 資料庫相關
- `hooks/` - 自定義 React Hooks
- `i18n/` - 國際化
- `lib/` - 工具函數和庫
- `stores/` - 狀態管理 (可能使用 Zustand 或類似)

### src-tauri/ 目錄
- Tauri 相關配置，用於桌面應用

### docs/ 目錄
- `component-ids.md` - 組件 ID 參考文檔

### public/ 目錄
- 靜態資源檔案

### messages/ 目錄
- 可能包含國際化訊息檔案

## 主要功能模組
- **記錄 (Recording)** - 快速記錄碎片化資訊
- **寫作 (Writing)** - Markdown 編輯器進行深入撰寫
- **AI 對話** - 整合 AI 功能
- **搜尋** - 筆記搜尋功能
- **圖片管理** - 圖片上傳和管理
- **設定** - 應用設定

## 技術棧
- **前端**: Next.js, React, TypeScript, Tailwind CSS
- **桌面**: Tauri
- **移動端**: React Native (開發中)
- **狀態管理**: 可能使用 Zustand 或類似
- **資料庫**: 可能使用 SQLite 或 IndexedDB
- **AI 整合**: MCP 支援
