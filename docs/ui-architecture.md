# NoteGen UI 架構分析

## 整體架構概述

NoteGen 是一個跨平台的 Markdown 筆記應用，使用 Next.js 15 + React 19 + TypeScript + Tailwind CSS + Tauri 構建。應用分為桌面端和移動端兩套 UI 架構。

## 技術棧

### 前端框架
- **Next.js 15** - App Router 架構
- **React 19** - 最新版本
- **TypeScript** - 類型安全
- **Tailwind CSS** - 樣式框架
- **shadcn/ui** - UI 組件庫 (基於 Radix UI)

### 狀態管理
- **Zustand** - 輕量級狀態管理
- 多個 store：article, chat, setting, sidebar, vector 等

### 桌面應用
- **Tauri 2.0** - 跨平台桌面應用框架
- 多個插件：剪貼板、對話框、檔案系統、全域快捷鍵等

### 其他依賴
- **Vditor** - Markdown 編輯器
- **react-resizable-panels** - 可調整面板
- **next-intl** - 國際化
- **next-themes** - 主題切換

## UI 架構分析

### 1. 佈局架構

#### 桌面端 (core/)
```
┌─────────────────────────────────────────┐
│ AppSidebar (垂直側邊欄) │ Main Content   │
│ - 導航圖標               │               │
│ - 設定按鈕               │               │
│ - 語言切換               │               │
│ - 深色模式               │               │
│ - 釘選切換               │               │
└─────────────────────────┴───────────────┘
```

#### 移動端 (mobile/)
```
┌─────────────────────────────────────────┐
│               Main Content              │
├─────────────────────────────────────────┤
│            AppFootbar (底部導航)        │
│ 聊天 記錄 寫作 設定                    │
└─────────────────────────────────────────┘
```

### 2. 頁面結構

#### 桌面端頁面
- **記錄頁面 (/core/record)**: 左右兩面板
  - 左面板: NoteSidebar (筆記列表)
  - 右面板: Chat (AI 對話介面)
  
- **寫作頁面 (/core/article)**: 左右兩面板
  - 左面板: FileSidebar (檔案管理)
  - 右面板: MdEditor (Markdown 編輯器)

- **搜尋頁面 (/core/search)**: 搜尋介面
- **圖片管理頁面 (/core/image)**: 圖片上傳和管理
- **設定頁面 (/core/setting)**: 應用設定

#### 移動端頁面
- **聊天頁面 (/mobile/chat)**: AI 對話
- **記錄頁面 (/mobile/record)**: 筆記列表
- **寫作頁面 (/mobile/writing)**: Markdown 編輯
- **設定頁面 (/mobile/setting)**: 設定介面

### 3. 組件層次

#### 核心組件
- **AppSidebar**: 桌面端側邊欄導航
- **AppFootbar**: 移動端底部導航
- **MdEditor**: Markdown 編輯器 (vditor)
- **WebView**: 嵌入式瀏覽器
- **SearchDialog**: 全域搜尋

#### UI 元件庫 (shadcn/ui)
包含 40+ 個元件：
- Button, Input, Card, Dialog, Dropdown
- Sidebar, Tabs, Table, Toast
- Resizable, ScrollArea, Tooltip 等

### 4. 響應式設計

#### 桌面端
- 使用 `react-resizable-panels` 實現可調整面板
- 側邊欄可展開/收起
- 支援自訂 CSS 和 UI 縮放

#### 移動端
- 底部導航欄
- 使用 `tailwindcss-safe-area` 適配安全區域
- 支援觸控操作

### 5. 主題和樣式

- **next-themes**: 系統/亮色/暗色主題
- **自訂 CSS**: 用戶可注入自訂樣式
- **組件 ID**: 為自訂 CSS 提供掛載點
- **Tailwind**: 原子化 CSS

### 6. 狀態管理架構

#### Store 分類
- **UI 狀態**: sidebar, article, chat
- **設定**: setting, imageHosting
- **資料**: mark, tag, vector
- **同步**: sync, settingsSync
- **功能**: shortcut, clipboard, mcp

#### 狀態同步
- Tauri Store: 本地持久化
- 多個同步服務: GitHub, Gitee, GitLab, WebDAV

### 7. 導航和路由

#### 桌面端
- App Router 路由: `/core/*`
- 側邊欄驅動的導航
- 支援鍵盤快捷鍵

#### 移動端
- App Router 路由: `/mobile/*`
- 底部導航欄
- 支援手勢操作

### 8. 功能模組

#### 核心功能
- **記錄 (Record)**: 快速筆記和 AI 對話
- **寫作 (Article)**: Markdown 編輯和檔案管理
- **搜尋 (Search)**: 全域搜尋
- **圖片管理**: GitHub 圖床等
- **設定**: 全面的應用設定

#### AI 整合
- **MCP**: Model Context Protocol
- **RAG**: 檢索增強生成
- **多模型支援**: OpenAI, SiliconFlow 等

## 架構特點

1. **模組化設計**: 清晰的目錄結構和組件分層
2. **跨平台支援**: 桌面端 + 移動端雙架構
3. **可擴展性**: 插件化架構 (MCP, 圖床等)
4. **使用者體驗**: 響應式設計，可調整面板
5. **開發體驗**: TypeScript + ESLint + Turbopack
