#!/bin/bash

# Android 构建脚本
# 使用方法: ./build-android.sh [dev|release]

set -e

MODE=${1:-release}
PROJECT_ROOT="/Users/xu/code/note-gen"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
KEYSTORE_PATH="$TAURI_DIR/android-app.keystore"

echo "🔨 开始构建 Android 应用 (模式: $MODE)"

# 检查环境
if [ ! -d "$ANDROID_HOME" ]; then
    echo "❌ ANDROID_HOME 环境变量未设置"
    exit 1
fi

if [ ! -f "$KEYSTORE_PATH" ]; then
    echo "❌ 密钥库文件不存在: $KEYSTORE_PATH"
    exit 1
fi

# 设置 NDK 工具路径
export PATH=$PATH:$ANDROID_HOME/ndk/29.0.14206865/toolchains/llvm/prebuilt/darwin-x86_64/bin

# 创建符号链接（如果不存在）
if [ ! -f "$ANDROID_HOME/ndk/29.0.14206865/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android-ranlib" ]; then
    echo "🔗 创建符号链接..."
    ln -sf llvm-ranlib $ANDROID_HOME/ndk/29.0.14206865/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android-ranlib
fi

cd $PROJECT_ROOT

# 构建
if [ "$MODE" = "dev" ]; then
    echo "🔨 开发模式构建..."
    pnpm tauri android dev
else
    echo "🔨 发布模式构建..."
    pnpm tauri android build
    
    echo "📝 签名 APK..."
    cd $TAURI_DIR
    jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA256 -keystore $KEYSTORE_PATH gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk note-gen
    
    echo "✅ 构建完成!"
    echo "📱 APK 文件位置: gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
    echo "📦 AAB 文件位置: gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab"
fi

echo "🎉 Android 构建完成!"
