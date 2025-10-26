# NoteGen CI/CD 設置指南

## GitHub Actions 工作流程

NoteGen 使用 GitHub Actions 進行自動化編譯和發佈。以下是完整的設置指南。

## 現有工作流程分析

### Release Workflow (`release.yml`)

#### 觸發條件
- 推送到 `release` 分支時自動觸發

#### 支持的平台
- **macOS Intel**: `x86_64-apple-darwin`
- **macOS Apple Silicon**: `aarch64-apple-darwin`
- **Ubuntu Linux**: `x86_64-unknown-linux-gnu`
- **Windows**: `x86_64-pc-windows-msvc`

#### 工作流程步驟
1. **環境設置**
   - 安裝 pnpm 和 Node.js
   - 安裝 Rust 工具鏈
   - 安裝平台特定依賴

2. **應用編譯**
   - 使用 Tauri Action 編譯應用
   - 自動代碼簽名
   - 生成安裝包

3. **發佈流程**
   - 創建 GitHub Release
   - 上傳編譯好的應用
   - 更新 UpgradeLink

## 設置到您的 GitHub 倉庫

### 1. 創建必要的 secrets

在您的 GitHub 倉庫中，進入 **Settings > Secrets and variables > Actions**，添加以下 secrets：

#### 必需的 secrets
```bash
# GitHub Token (自動提供)
GITHUB_TOKEN

# Tauri 代碼簽名 (可選，用於應用簽名)
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# UpgradeLink 服務 (可選，用於自動更新)
UPGRADE_LINK_ACCESS_KEY
UPGRADE_LINK_TAURI_KEY
```

### 2. 複製工作流程文件

將 `release.yml` 文件複製到您的倉庫的 `.github/workflows/` 目錄中。

### 3. 修改配置

根據您的需要修改 `release.yml` 中的以下配置：

#### 倉庫信息
```yaml
# 修改應用名稱 (替換所有 YOUR_APP_NAME)
tagName: YOUR_APP_NAME-v__VERSION__
releaseName: 'YOUR_APP_NAME v__VERSION__'

# 修改倉庫 URL (替換 YOUR_USERNAME 和 YOUR_REPO)
source-url: 'https://github.com/YOUR_USERNAME/YOUR_REPO/releases/download/YOUR_APP_NAME-v${{ needs.publish-tauri.outputs.appVersion }}/latest.json'
```

### 具體替換步驟

1. **替換應用名稱**: 將 `YOUR_APP_NAME` 替換為您的應用名稱 (例如: `my-awesome-app`)

2. **替換倉庫信息**: 
   - `YOUR_USERNAME`: 您的 GitHub 用戶名
   - `YOUR_REPO`: 您的倉庫名稱

#### 示例替換

如果您的倉庫是 `https://github.com/johndoe/my-note-app`，則：

```yaml
# 修改前
tagName: YOUR_APP_NAME-v__VERSION__
releaseName: 'YOUR_APP_NAME v__VERSION__'
source-url: 'https://github.com/YOUR_USERNAME/YOUR_REPO/releases/download/YOUR_APP_NAME-v${{ needs.publish-tauri.outputs.appVersion }}/latest.json'

# 修改後
tagName: my-note-app-v__VERSION__
releaseName: 'My Note App v__VERSION__'
source-url: 'https://github.com/johndoe/my-note-app/releases/download/my-note-app-v${{ needs.publish-tauri.outputs.appVersion }}/latest.json'
```

## 工作流程觸發方式

### 自動觸發
```yaml
on:
  push:
    branches:
      - release  # 推送到 release 分支時觸發
```

### 手動觸發
```yaml
on:
  workflow_dispatch:  # 添加此項以支持手動觸發
    inputs:
      version:
        description: 'Release version'
        required: true
        default: 'patch'
```

### 發佈標籤觸發
```yaml
on:
  release:
    types: [published]  # 在 GitHub 上創建 release 時觸發
```

## 分支策略建議

### 開發分支
```
main        - 主開發分支
develop     - 開發分支
release     - 發佈分支 (推送此分支觸發 CI/CD)
```

### 工作流程
1. **功能開發**: 在 `develop` 分支上開發
2. **測試通過**: 合併到 `main` 分支
3. **發佈準備**: 從 `main` 合併到 `release` 分支
4. **自動發佈**: 推送 `release` 分支自動觸發 CI/CD

## 自定義工作流程選項

### 添加測試階段
```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - name: Install dependencies
        run: pnpm install
      - name: Run tests
        run: pnpm test
      - name: Build check
        run: pnpm build

  publish-tauri:
    needs: test  # 測試通過後才發佈
    # ... 其他配置
```

### 添加代碼質量檢查
```yaml
- name: Run ESLint
  run: pnpm lint

- name: Run TypeScript check
  run: pnpm tsc --noEmit

- name: Run Prettier check
  run: pnpm prettier --check .
```

### 添加不同環境的編譯
```yaml
strategy:
  matrix:
    include:
      - platform: 'macos-latest'
        args: '--target aarch64-apple-darwin'
      - platform: 'macos-latest'
        args: '--target x86_64-apple-darwin'
      - platform: 'ubuntu-24.04'
        args: '--target x86_64-unknown-linux-gnu'
      - platform: 'ubuntu-24.04'
        args: '--target aarch64-unknown-linux-gnu'
      - platform: 'windows-latest'
        args: '--target x86_64-pc-windows-msvc'
      - platform: 'windows-latest'
        args: '--target aarch64-pc-windows-msvc'
```

## 故障排除

### 常見問題

#### Q: Tauri 編譯失敗
**A:**
```yaml
# 檢查 Rust 版本
- name: install Rust stable
  uses: dtolnay/rust-toolchain@stable
  with:
    targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
```

#### Q: 依賴安裝失敗
**A:**
```yaml
# 確保使用正確的 pnpm 版本
- uses: pnpm/action-setup@v4
  with:
    version: 9  # 或您使用的版本
```

#### Q: 代碼簽名失敗
**A:**
```yaml
# 確保正確設置了簽名 secrets
env:
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

## 監控和日誌

### 查看工作流程運行
1. 進入 GitHub 倉庫的 **Actions** 標籤
2. 選擇對應的工作流程運行
3. 查看每個步驟的日誌

### 調試失敗的編譯
```bash
# 在本地測試編譯
pnpm tauri build --target x86_64-pc-windows-msvc --verbose
```

## 最佳實踐

### 安全考慮
- 不要在代碼中硬編碼敏感信息
- 使用 GitHub secrets 存儲密鑰
- 定期輪換 access tokens

### 性能優化
- 使用 matrix 策略並行編譯多平台
- 合理設置 cache 以加速重複編譯
- 定期清理舊的 release

### 版本管理
- 使用語義化版本控制
- 在發佈前標記版本
- 保持 changelog 更新

## 完整的工作流程示例

```yaml
name: 'publish'

on:
  push:
    branches:
      - release

jobs:
  publish-tauri:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'macos-latest'
            args: '--target aarch64-apple-darwin'
          - platform: 'macos-latest'
            args: '--target x86_64-apple-darwin'
          - platform: 'ubuntu-24.04'
            args: ''
          - platform: 'windows-latest'
            args: ''

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9
          run_install: true

      - name: setup node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: 'pnpm'

      - name: install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: install dependencies (ubuntu only)
        if: matrix.platform == 'ubuntu-24.04'
        run: |
          sudo apt-get update
          sudo apt-get install pkg-config libclang-dev libxcb1-dev libxrandr-dev libdbus-1-dev libpipewire-0.3-dev libwayland-dev libegl-dev libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libgbm-dev libappindicator3-dev librsvg2-dev patchelf

      - name: install frontend dependencies
        run: pnpm install

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: note-gen-v__VERSION__
          releaseName: 'NoteGen v__VERSION__'
          releaseBody: 'See the assets to download this version and install.'
          releaseDraft: false
          prerelease: false
          args: ${{ matrix.args }}
```

## 更新日誌

- **2025-01-16**: 創建 CI/CD 設置指南
  - 添加完整的 GitHub Actions 配置說明
  - 包含多平台編譯設置
  - 提供故障排除指南
  - 添加最佳實踐建議
  - 模板化倉庫和應用名稱替換
