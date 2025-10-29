# NoteGen 專案結構與架構

## 專案概述

**NoteGen** 是一個現代化的跨平台桌面應用程式，結合了**多功能瀏覽器**和**AI 輔助筆記工具**。專案採用 Tauri + Next.js 的架構，提供了豐富的網路瀏覽體驗和知識管理功能。

## 🎯 核心功能

- 🌐 **多分頁瀏覽器** - 支持同時開啟多個網站標籤
- 🔖 **書籤管理** - 收藏和組織常用網站
- 📚 **瀏覽歷史** - 記錄和搜索訪問記錄
- 🤖 **AI 整合** - MCP 協議支持的 AI 功能
- 🎨 **主題切換** - 深色/淺色主題模式
- 🌍 **國際化** - 多語言支持
- 📱 **響應式設計** - 支持桌面和移動端

## 📁 專案結構總覽

```
note-gen/
├── 📁 .github/                    # GitHub 配置與 CI/CD
│   ├── ISSUE_TEMPLATE/           # Issue 提交模板
│   │   ├── bug_report.yml        # 🐛 Bug 報告模板
│   │   ├── config.yml           # ⚙️ Issue 配置
│   │   └── feature_request.yml  # 💡 功能請求模板
│   └── workflows/               # 🚀 GitHub Actions
│       └── release.yml          # CI/CD 自動化部署
├── 📁 docs/                      # 📖 專案文檔
│   ├── ci-cd-setup.md           # CI/CD 設置指南
│   ├── component-ids.md         # 組件 ID 參考
│   ├── development-guide.md     # 開發指南
│   ├── project-structure.md     # 📋 本文檔
│   ├── repo-migration-guide.md  # 倉庫遷移指南
│   └── ui-architecture.md       # UI 架構說明
├── 📁 public/                    # 🖼️ 靜態資源
│   ├── app-icon.png             # 應用圖標
│   ├── markdown/                # Markdown 樣式資源
│   │   ├── github-markdown-light.css
│   │   └── github-markdown-dark.css
│   └── [其他圖標和資源文件]
├── 📁 src/                       # 💻 源代碼
│   ├── app/                      # Next.js App Router
│   │   ├── core/                 # 🏗️ 核心功能模組
│   │   │   ├── article/          # 📝 文章處理模組
│   │   │   ├── image/            # 🖼️ 圖片處理模組
│   │   │   ├── record/           # 📊 記錄管理模組
│   │   │   ├── setting/          # ⚙️ 設定頁面模組
│   │   │   └── webview/          # 🌐 瀏覽器功能模組 ⭐
│   │   │       ├── page.tsx      # 瀏覽器主頁面
│   │   │       ├── simple-webview.tsx # 簡化 WebView 組件
│   │   │       └── webview-toolbar.tsx # 工具列組件
│   │   ├── mobile/               # 📱 移動端適配
│   │   ├── layout.tsx            # 主佈局組件
│   │   └── page.tsx              # 應用首頁
│   ├── components/               # 🧩 React 組件
│   │   ├── ui/                   # UI 組件庫 (shadcn/ui)
│   │   ├── app-sidebar.tsx       # 應用側邊欄
│   │   ├── app-footbar.tsx       # 應用底部欄
│   │   ├── app-status.tsx        # 應用狀態欄
│   │   ├── webview.tsx           # 舊版 WebView 組件
│   │   └── [其他功能組件]
│   ├── config/                   # ⚙️ 配置檔案
│   ├── db/                       # 🗄️ 資料庫相關
│   ├── hooks/                    # 🪝 自定義 React Hooks
│   ├── i18n/                     # 🌍 國際化配置
│   ├── lib/                      # 🛠️ 工具函數庫
│   └── stores/                   # 📦 狀態管理 (Zustand)
└── 📁 src-tauri/                 # 🦀 Tauri Rust 後端
    ├── src/                      # Rust 源碼
    ├── Cargo.toml               # Rust 依賴配置
    ├── tauri.conf.json          # Tauri 應用配置
    └── [其他 Tauri 配置文件]
```

## 🏗️ 架構特點

### 前端架構 (Next.js + React)
- **App Router**: 使用最新的 Next.js 15 App Router
- **組件化**: 基於 shadcn/ui 的組件庫
- **狀態管理**: Zustand 輕量級狀態管理
- **樣式系統**: Tailwind CSS + CSS Variables
- **類型安全**: 完整的 TypeScript 支持

### 後端架構 (Tauri + Rust)
- **跨平台**: Windows, macOS, Linux 原生支持
- **系統集成**: 訪問檔案系統、網路、系統托盤等
- **效能優化**: Rust 的高性能和記憶體安全
- **插件系統**: 豐富的 Tauri 插件生態

### 開發工具鏈
- **包管理**: pnpm (高效能的包管理器)
- **構建工具**: Turbopack (Next.js 的快速構建器)
- **代碼品質**: ESLint + TypeScript 嚴格檢查
- **版本控制**: Git + GitHub 完整工作流程

## 🎯 功能模組詳解

### 🌐 WebView 瀏覽器模組 (核心功能)

**位置**: `src/app/core/webview/`

**組件結構**:
```
webview/
├── page.tsx              # 🎯 主瀏覽器頁面
├── simple-webview.tsx    # 🔧 簡化 WebView 組件
└── webview-toolbar.tsx   # 🛠️ 工具列組件
```

**功能特點**:
- ✅ 多分頁瀏覽 (同時開啟多個網站)
- ✅ 完整工具列 (前進、後退、重新載入、首頁)
- ✅ 書籤管理系統
- ✅ 瀏覽歷史記錄
- ✅ 外部連結處理
- ✅ 網站兼容性優化 (支持 Google 等現代網站)

### 📝 文章處理模組

**位置**: `src/app/core/article/`

負責文章的解析、格式化和展示功能。

### 🖼️ 圖片處理模組

**位置**: `src/app/core/image/`

處理圖片的載入、編輯和展示。

### 📊 記錄管理模組

**位置**: `src/app/core/record/`

管理各種記錄和數據的存儲和檢索。

### ⚙️ 設定頁面模組

**位置**: `src/app/core/setting/`

應用程式的各項設定和配置。

## 📋 開發與部署

### 本地開發
```bash
# 安裝依賴
pnpm install

# 啟動開發服務器
pnpm dev

# 構建生產版本
pnpm build

# Tauri 桌面應用開發
pnpm tauri dev
```

### 部署流程
- **自動化 CI/CD**: GitHub Actions 自動編譯
- **多平台支持**: Windows (x64/ARM64), macOS (Intel/Apple Silicon), Linux
- **代碼簽名**: 自動應用程式簽名
- **發佈管理**: GitHub Releases 自動發佈

## 📚 文檔系統

專案包含完整的文檔系統：

- **`ci-cd-setup.md`** - CI/CD 設置和部署指南
- **`development-guide.md`** - 開發環境設置和開發流程
- **`ui-architecture.md`** - UI 設計系統和組件架構
- **`component-ids.md`** - 組件 ID 參考和命名規範
- **`repo-migration-guide.md`** - 倉庫遷移和重新部署指南

## 🔧 配置檔案

### 前端配置
- **`next.config.ts`** - Next.js 構建配置
- **`tailwind.config.ts`** - Tailwind CSS 主題配置
- **`tsconfig.json`** - TypeScript 編譯配置
- **`components.json`** - shadcn/ui 組件配置

### 後端配置
- **`src-tauri/tauri.conf.json`** - Tauri 應用程式配置
- **`src-tauri/Cargo.toml`** - Rust 依賴配置

## 🌟 專案亮點

1. **現代化架構** - 使用最新的 Web 技術棧
2. **跨平台支援** - 一套代碼，多平台部署
3. **開發者友好** - 完整的開發工具鏈和文檔
4. **使用者體驗** - 直觀的界面和豐富功能
5. **開源生態** - GitHub 完整的工作流程

## 📈 未來規劃

- [ ] AI 功能深度整合
- [ ] 移動端應用開發
- [ ] 插件系統擴展
- [ ] 多用戶協作功能
- [ ] 雲端同步服務

---

*本文檔會隨著專案發展持續更新。如有任何問題或建議，歡迎提交 Issue 或 Pull Request。*
