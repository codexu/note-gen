# NoteGen 開發指南

## 開發環境設置

### 環境要求
- Node.js 18+
- pnpm 8+
- Rust (用於 Tauri)
- Windows/macOS/Linux

### 安裝依賴
```bash
# 安裝 Node.js 依賴
pnpm install

# 安裝 Rust 依賴 (如果需要 Tauri)
cargo install tauri-cli
```

## 開發命令

### 啟動開發伺服器
```bash
# 使用 Turbopack (推薦)
pnpm dev

# 或使用傳統 webpack
pnpm dev:webpack
```

### 編譯生產版本
```bash
# 前端編譯
pnpm build

# Tauri 應用編譯
pnpm tauri build
```

## 緩存管理

### 清除所有緩存
```bash
# 清除所有緩存 (推薦的完整清理)
pnpm run clean:all

# 或手動執行 (跨平台)
pnpm exec rimraf .next node_modules pnpm-lock.yaml src-tauri/target
```

### 清除特定緩存

#### 使用 npm 腳本 (推薦)
```bash
# 清除 Next.js 緩存
pnpm run clean:next

# 清除依賴緩存
pnpm run clean:deps

# 清除 Tauri 緩存
pnpm run clean:tauri
```

#### 手動清理 (如果需要自定義)

#### Next.js 緩存
```bash
# Linux/macOS
rm -rf .next

# Windows PowerShell
Remove-Item -Recurse -Force .next

# Windows Command Prompt
rd /s /q .next
```

#### Node.js 依賴緩存
```bash
# Linux/macOS
rm -rf node_modules pnpm-lock.yaml

# Windows PowerShell
Remove-Item -Recurse -Force node_modules, pnpm-lock.yaml

# Windows Command Prompt
rd /s /q node_modules && del pnpm-lock.yaml
```

#### Turbopack 緩存
```bash
# Linux/macOS
rm -rf .next/cache/turbopack

# Windows PowerShell
Remove-Item -Recurse -Force .next\cache\turbopack

# Windows Command Prompt
rd /s /q .next\cache\turbopack
```

#### Tauri 緩存 (如果適用)
```bash
# Linux/macOS
rm -rf src-tauri/target

# 清除 Cargo 緩存
cargo clean
```

### 常見的緩存問題解決方案

#### 1. 開發伺服器端口被佔用
```bash
# 檢查端口使用情況 (Linux/macOS)
lsof -i :3456

# 檢查端口使用情況 (Windows)
netstat -ano | findstr :3456

# 強制殺死進程 (Linux/macOS)
kill -9 <PID>

# 強制殺死進程 (Windows)
taskkill /PID <PID> /F
```

#### 2. 編譯錯誤或模組解析問題
```bash
# 完整清理並重新安裝
pnpm clean:all
pnpm install
pnpm build
```

#### 3. 熱重載不工作
```bash
# 清除 Next.js 緩存
rm -rf .next

# 重啟開發伺服器
pnpm dev
```

## 編譯和部署流程

### 開發階段
```bash
# 1. 啟動開發伺服器
pnpm dev

# 2. 在瀏覽器中打開 http://localhost:3456
```

### 生產編譯
```bash
# 1. 編譯前端
pnpm build

# 2. 編譯 Tauri 應用 (如果需要)
pnpm tauri build

# 3. 檢查編譯輸出
# Linux/macOS
ls -la out/

# Windows PowerShell
dir out\

# Windows Command Prompt
dir out
```

### 部署到不同平台

#### Web 部署
```bash
# 靜態導出
pnpm export

# 輸出在 out/ 目錄中，可以部署到任何靜態主機
```

#### 桌面應用部署
```bash
# Windows (x64)
pnpm tauri build --target x86_64-pc-windows-msvc

# Windows (ARM64)
pnpm tauri build --target aarch64-pc-windows-msvc

# macOS (Intel)
pnpm tauri build --target x86_64-apple-darwin

# macOS (Apple Silicon)
pnpm tauri build --target aarch64-apple-darwin

# Linux (x64)
pnpm tauri build --target x86_64-unknown-linux-gnu

# Linux (ARM64)
pnpm tauri build --target aarch64-unknown-linux-gnu
```

#### 移動應用部署
```bash
# iOS (需要 macOS)
pnpm tauri build --target aarch64-apple-ios

# Android (需要 Android SDK)
pnpm tauri build --target aarch64-linux-android

# Android (x86模擬器)
pnpm tauri build --target x86_64-linux-android
```

### 編譯目標說明

#### 桌面平台
- **x86_64-pc-windows-msvc**: Windows x64 (MSVC工具鏈)
- **aarch64-pc-windows-msvc**: Windows ARM64 (Surface Pro X等)
- **x86_64-apple-darwin**: macOS Intel 晶片
- **aarch64-apple-darwin**: macOS Apple Silicon (M1/M2/M3)
- **x86_64-unknown-linux-gnu**: Linux x64 (GNU工具鏈)
- **aarch64-unknown-linux-gnu**: Linux ARM64 (Raspberry Pi等)

#### 移動平台
- **aarch64-apple-ios**: iOS 設備 (需要 macOS 主機)
- **aarch64-linux-android**: Android ARM64 設備
- **x86_64-linux-android**: Android x86 模擬器

#### 開發環境要求

**Windows:**
```bash
# 安裝 Visual Studio Build Tools 或 Visual Studio
# 包含 "Desktop development with C++" 工作負載
```

**macOS:**
```bash
# 安裝 Xcode Command Line Tools
xcode-select --install

# 安裝 iOS 開發環境 (可選)
# 需要 Xcode 和 iOS SDK
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf

# Fedora
sudo dnf install webkit2gtk3-devel libappindicator-gtk3 librsvg2-devel patchelf
```

**Android (可選):**
```bash
# 下載 Android SDK
# 設置 ANDROID_HOME 環境變數
# 安裝 NDK 和工具鏈
```

## 故障排除

### 常見問題

#### Q: `pnpm dev` 啟動失敗
**A:**
```bash
# 檢查端口是否被佔用
# Linux/macOS
lsof -i :3456

# Windows
netstat -ano | findstr :3456

# 如果被佔用，殺死進程或使用不同端口
pnpm dev --port 3457
```

#### Q: 編譯時出現模組錯誤
**A:**
```bash
# 清除所有緩存並重新安裝
pnpm run clean:all
pnpm install
pnpm build
```

#### Q: Windows 上清理命令不工作
**A:**
```bash
# 確保已安裝 rimraf
pnpm install

# 然後使用清理腳本
pnpm run clean:all
```

#### Q: Tauri 編譯失敗
**A:**
```bash
# 清除 Rust 緩存
cargo clean

# 重新編譯
pnpm tauri build
```

#### Q: 依賴安裝失敗
**A:**
```bash
# 清除鎖定文件並重新安裝
# Linux/macOS
rm pnpm-lock.yaml

# Windows PowerShell
Remove-Item pnpm-lock.yaml

# Windows Command Prompt
del pnpm-lock.yaml

# 然後重新安裝
pnpm install
```

### 性能優化

#### 開發時的性能提示
```bash
# 使用 Turbopack 加速編譯
pnpm dev

# 啟用 React 開發者工具
# 在瀏覽器中安裝 React DevTools 擴展
```

#### 生產優化
```bash
# 啟用生產模式優化
NODE_ENV=production pnpm build

# 分析包大小
pnpm build --analyze
```

## 腳本說明

### package.json 腳本
- `dev`: 啟動開發伺服器 (Turbopack)
- `build`: 生產編譯
- `start`: 生產模式運行
- `lint`: ESLint 檢查
- `tauri`: Tauri CLI
- `clean:all`: 清除所有緩存 (Next.js + 依賴 + Tauri)
- `clean:next`: 清除 Next.js 緩存
- `clean:deps`: 清除 Node.js 依賴緩存
- `clean:tauri`: 清除 Tauri 編譯緩存
- `docs:build`: 編譯文檔

## 更新日誌

- **2025-01-16**: 創建開發指南文檔
  - 添加完整的緩存清理方法
  - 編譯和部署流程說明
  - 常見問題故障排除
  - 性能優化建議
- **2025-01-16**: 添加跨平台支持
  - 為所有命令提供 Windows/Linux/macOS 版本
  - 添加 rimraf 作為跨平台清理工具
  - 更新 package.json 腳本以支持 Windows
- **2025-01-16**: 完善編譯目標支持
  - 添加完整的桌面平台編譯命令 (Windows x64/ARM64, macOS Intel/Apple Silicon, Linux x64/ARM64)
  - 添加移動平台編譯命令 (iOS, Android)
  - 更新所有故障排除命令為跨平台版本
