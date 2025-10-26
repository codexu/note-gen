# 倉庫遷移指南

## 概述

當您將 NoteGen 專案遷移到自己的 GitHub 倉庫時，需要替換所有硬編碼的帳號和倉庫信息。以下是完整的替換指南。

## 需要替換的文件

### 1. GitHub Actions 工作流程
**文件**: `.github/workflows/release.yml`
```yaml
# 替換內容
tagName: YOUR_APP_NAME-v__VERSION__
releaseName: 'YOUR_APP_NAME v__VERSION__'
source-url: 'https://github.com/YOUR_USERNAME/YOUR_REPO/releases/download/YOUR_APP_NAME-v${{ needs.publish-tauri.outputs.appVersion }}/latest.json'
```

### 2. Issue 模板配置
**文件**: `.github/ISSUE_TEMPLATE/config.yml`
```yaml
contact_links:
  - name: 💬 讨论问题
    url: https://github.com/YOUR_USERNAME/YOUR_REPO/discussions
    about: 提出问题并与其他 YOUR_APP_NAME 用户或维护者交谈
```

### 3. Tauri 配置
**文件**: `src-tauri/tauri.conf.json`
```json
{
  "identifier": "com.YOUR_USERNAME.YOUR_APP_NAME",
  "productName": "YOUR_APP_NAME"
}
```

### 4. Cargo.toml
**文件**: `src-tauri/Cargo.toml`
```toml
name = "YOUR_APP_NAME"
```

### 5. GitHub 相關文件
**文件**: `src/lib/github.ts`
```typescript
// 替換倉庫 URL
const GITHUB_REPO = 'YOUR_USERNAME/YOUR_APP_NAME'
```

### 6. 設定文件
**文件**: `src/app/core/setting/about/setting-about.tsx` 和 `updater.tsx`
```typescript
// 替換倉庫鏈接
const REPO_URL = 'https://github.com/YOUR_USERNAME/YOUR_REPO'
```

### 7. README.md
**文件**: `README.md`
```markdown
<!-- 替換所有鏈接 -->
[GitHub](https://github.com/YOUR_USERNAME/YOUR_REPO)
[Issues](https://github.com/YOUR_USERNAME/YOUR_REPO/issues)
[Discussions](https://github.com/YOUR_USERNAME/YOUR_REPO/discussions)
```

## 替換占位符

### 占位符說明

| 占位符 | 說明 | 示例 |
|--------|------|------|
| `YOUR_USERNAME` | 您的 GitHub 用戶名 | `johndoe` |
| `YOUR_REPO` | 您的倉庫名稱 | `my-note-app` |
| `YOUR_APP_NAME` | 您的應用名稱 | `My Note App` |

### 示例替換

假設您的信息是：
- GitHub 用戶名: `johndoe`
- 倉庫名稱: `awesome-note-app`
- 應用名稱: `Awesome Note App`

則替換為：
- `YOUR_USERNAME` → `johndoe`
- `YOUR_REPO` → `awesome-note-app`
- `YOUR_APP_NAME` → `awesome-note-app` (用於技術名稱) 或 `Awesome Note App` (用於顯示名稱)

## 自動替換腳本

### PowerShell 腳本 (Windows)
```powershell
# 替換變數
$oldUsername = "codexu"
$oldRepo = "note-gen"
$oldAppName = "NoteGen"

$newUsername = "YOUR_USERNAME"
$newRepo = "YOUR_REPO"
$newAppName = "YOUR_APP_NAME"

# 獲取所有文件
Get-ChildItem -Path "." -Recurse -File | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match $oldUsername -or $content -match $oldRepo -or $content -match $oldAppName) {
        $content = $content -replace $oldUsername, $newUsername
        $content = $content -replace $oldRepo, $newRepo
        $content = $content -replace $oldAppName, $newAppName
        Set-Content $_.FullName $content -NoNewline
        Write-Host "Updated: $($_.FullName)"
    }
}
```

### Bash 腳本 (Linux/macOS)
```bash
#!/bin/bash

# 替換變數
OLD_USERNAME="codexu"
OLD_REPO="note-gen"
OLD_APP_NAME="NoteGen"

NEW_USERNAME="YOUR_USERNAME"
NEW_REPO="YOUR_REPO"
NEW_APP_NAME="YOUR_APP_NAME"

# 遞歸替換所有文件
find . -type f -not -path './node_modules/*' -not -path './.git/*' -exec sed -i "s/$OLD_USERNAME/$NEW_USERNAME/g; s/$OLD_REPO/$NEW_REPO/g; s/$OLD_APP_NAME/$NEW_APP_NAME/g" {} \;
```

## 手動替換檢查清單

### ✅ 已處理的文件
- [x] `.github/workflows/release.yml`
- [x] `.github/ISSUE_TEMPLATE/config.yml`
- [x] `.github/ISSUE_TEMPLATE/bug_report.yml`

### 🔄 需要手動處理的文件
- [ ] `README.md` - 更新鏈接和描述
- [ ] `src-tauri/tauri.conf.json` - 更新應用標識符
- [ ] `src-tauri/Cargo.toml` - 更新包名稱
- [ ] `src/lib/github.ts` - 更新倉庫引用
- [ ] `src/app/core/setting/about/setting-about.tsx` - 更新關於頁面
- [ ] `src/app/core/setting/about/updater.tsx` - 更新更新鏈接
- [ ] `LICENSE` - 更新版權信息

## 測試替換結果

替換完成後，運行以下命令確保一切正常：

```bash
# 清理並重新安裝
pnpm run clean:all
pnpm install

# 編譯測試
pnpm build

# Tauri 編譯測試
pnpm tauri build --target x86_64-pc-windows-msvc
```

## 注意事項

1. **保持大小寫一致性**: 注意 `note-gen` vs `NoteGen` vs `NOTE-GEN`
2. **測試所有功能**: 替換後要測試 GitHub 集成、更新功能等
3. **更新文檔鏈接**: 確保所有文檔中的鏈接都已更新
4. **檢查隱藏引用**: 有些地方可能通過變數間接引用

## 更新日誌

- **2025-01-16**: 創建倉庫遷移指南
  - 列出所有需要替換的文件
  - 提供自動替換腳本
  - 添加詳細的手動替換說明
  - 包含測試和驗證步驟
