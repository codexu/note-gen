# Android CI/CD 设置步骤

## 📋 完整操作流程

### 第一步：在测试仓库配置 GitHub Secrets

1. **进入你的测试仓库**
   - 访问测试仓库的 GitHub 页面

2. **添加 Secrets**
   - 点击 **Settings** → **Secrets and variables** → **Actions**
   - 点击 **New repository secret**
   - 依次添加以下 3 个 Secrets：

#### Secret 1: ANDROID_KEYSTORE_BASE64
```
名称: ANDROID_KEYSTORE_BASE64
值: (见 GITHUB_SECRETS_SETUP.md 文件中的完整 base64 字符串)
```

#### Secret 2: ANDROID_KEYSTORE_PASSWORD
```
名称: ANDROID_KEYSTORE_PASSWORD
值: 你创建密钥库时设置的密码
```

#### Secret 3: ANDROID_KEY_PASSWORD
```
名称: ANDROID_KEY_PASSWORD
值: 你创建密钥时设置的密码（通常与密钥库密码相同）
```

---

### 第二步：推送代码到测试仓库

```bash
# 1. 确认当前在 test-android-action 分支
git branch

# 2. 提交更改
git commit -m "feat: add Android CI/CD workflow with tauri-action"

# 3. 推送到测试仓库
# 假设你的测试仓库 remote 名称是 test-repo
git push test-repo test-android-action

# 或者如果是推送到 origin
git push origin test-android-action
```

---

### 第三步：触发构建

推送代码后，GitHub Actions 会自动触发构建。

**查看构建进度：**
1. 进入测试仓库页面
2. 点击 **Actions** 标签
3. 找到 "Android Release" 工作流
4. 点击查看构建日志

**预计构建时间：** 20-40 分钟（首次构建会更久，因为需要下载依赖）

---

### 第四步：检查构建结果

#### 成功的情况：
- ✅ 所有步骤都显示绿色勾号
- ✅ 在 **Artifacts** 中可以看到：
  - `android-apk` - APK 文件
  - `android-aab` - AAB 文件
- ✅ 在 **Releases** 中创建了草稿版本（如果配置了）

#### 失败的情况：
查看失败的步骤日志，常见问题：
1. **Secrets 未配置** - 检查是否正确添加了 3 个 Secrets
2. **密码错误** - 确认密钥库密码是否正确
3. **依赖问题** - 查看具体错误日志

---

### 第五步：下载和测试 APK

1. 进入 Actions 页面
2. 点击成功的构建记录
3. 在 **Artifacts** 部分下载 `android-apk`
4. 解压后得到 APK 文件
5. 传输到 Android 设备安装测试

---

## 🔧 手动触发构建

如果需要手动触发构建（不推送代码）：

1. 进入 **Actions** 标签
2. 选择 "Android Release" 工作流
3. 点击 **Run workflow** 按钮
4. 选择 `test-android-action` 分支
5. 点击 **Run workflow**

---

## 📝 工作流配置说明

### 触发条件
```yaml
on:
  push:
    branches:
      - test-android-action  # 推送到此分支时触发
  workflow_dispatch:  # 支持手动触发
```

### 构建架构
默认构建 4 个架构：
- `aarch64` (ARM64) - 主流设备
- `armv7` (ARM32) - 旧设备
- `x86_64` - 模拟器
- `i686` - 旧模拟器

### 输出文件
- **APK**: 可直接安装的应用包
- **AAB**: Google Play 上传格式

---

## ⚠️ 注意事项

1. **首次构建时间长**
   - 需要下载 Android SDK/NDK
   - 需要编译 Rust 依赖
   - 后续构建会利用缓存，速度更快

2. **Release 设置**
   - 当前配置为创建草稿版本（`releaseDraft: true`）
   - 预发布版本（`prerelease: true`）
   - 可以在工作流文件中修改

3. **密钥安全**
   - 构建完成后会自动删除解码的密钥库文件
   - Secrets 永远不会出现在日志中

4. **存储限制**
   - GitHub Actions Artifacts 保留 90 天
   - APK 文件约 150MB，注意存储配额

---

## 🎯 成功后的下一步

测试成功后：

1. **合并到主仓库**
   ```bash
   # 切换到主分支
   git checkout main
   
   # 合并 test-android-action 分支
   git merge test-android-action
   
   # 推送到主仓库
   git push origin main
   ```

2. **在主仓库添加 Secrets**
   - 在 `codexu/note-gen` 仓库中添加相同的 3 个 Secrets

3. **调整触发条件**
   - 修改工作流文件，改为在 tag 推送时触发
   - 或者保持在特定分支触发

4. **发布正式版本**
   - 修改 `releaseDraft: false`
   - 修改 `prerelease: false`

---

## 🆘 故障排除

### 问题 1: "Keystore file not found"
**原因**: ANDROID_KEYSTORE_BASE64 未正确配置
**解决**: 检查 Secret 名称和值是否正确

### 问题 2: "Incorrect password"
**原因**: 密码错误
**解决**: 确认 ANDROID_KEYSTORE_PASSWORD 和 ANDROID_KEY_PASSWORD 正确

### 问题 3: "NDK not found"
**原因**: NDK 安装失败
**解决**: 查看 "Install Android NDK" 步骤的日志

### 问题 4: "Build timeout"
**原因**: 构建时间超过限制
**解决**: 
- 检查是否有网络问题
- 考虑减少构建的架构数量

---

## 📞 需要帮助？

如果遇到问题：
1. 查看完整的构建日志
2. 检查 GITHUB_SECRETS_SETUP.md 中的配置
3. 参考 ANDROID_BUILD.md 中的本地构建说明
