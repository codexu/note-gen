# Android 构建指南

## 环境要求

1. **Android SDK** - 已安装在 `/Users/xu/Library/Android/sdk`
2. **Android NDK** - 版本 29.0.14206865
3. **Rust 和 Cargo** - 用于编译 Tauri 项目
4. **pnpm** - 包管理器

## 密钥库信息

- **密钥库文件**: `src-tauri/android-app.keystore`
- **别名**: `note-gen`
- **算法**: RSA 2048位
- **有效期**: 10000天
- **创建日期**: 2026-01-02

## 快速构建

### 使用构建脚本（推荐）

```bash
# 发布模式构建
./build-android.sh release

# 开发模式构建
./build-android.sh dev
```

### 手动构建

```bash
# 1. 设置环境变量
export PATH=$PATH:$ANDROID_HOME/ndk/29.0.14206865/toolchains/llvm/prebuilt/darwin-x86_64/bin

# 2. 创建符号链接（如果不存在）
ln -sf llvm-ranlib $ANDROID_HOME/ndk/29.0.14206865/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android-ranlib

# 3. 构建
pnpm tauri android build

# 4. 签名 APK
cd src-tauri
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA256 -keystore android-app.keystore gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk note-gen
```

## 输出文件

构建完成后，会生成以下文件：

- **APK**: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`
- **AAB**: `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`

## 重要说明

1. **密钥库密码**: 需要在构建时输入，请妥善保管
2. **签名算法**: 使用 SHA256withRSA，安全性较高
3. **多架构支持**: 支持 arm64-v8a, armeabi-v7a, x86, x86_64 架构
4. **NDK版本**: 当前使用 NDK 29.0.14206865，如需更新请修改构建脚本

## 故障排除

### 常见问题

1. **`aarch64-linux-android-ranlib: command not found`**
   - 解决方案: 创建符号链接到 `llvm-ranlib`

2. **OpenSSL 编译失败**
   - 确保安装了完整的 Android NDK
   - 检查环境变量设置

3. **密钥库密码错误**
   - 重新生成密钥库或使用正确的密码

## 重新生成密钥库

如果需要重新生成密钥库：

```bash
cd src-tauri
keytool -genkey -v -keystore android-app.keystore -alias note-gen -keyalg RSA -keysize 2048 -validity 10000
```

## 发布到 Google Play

1. 使用 AAB 文件上传到 Google Play Console
2. AAB 文件位置: `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`
3. 确保签名信息正确
