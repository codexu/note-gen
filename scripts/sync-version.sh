#!/bin/bash

# 同步版本号脚本
# 从 tauri.conf.json 读取版本号并更新 iOS Info.plist

# 获取当前版本号
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")

echo "同步版本号: $VERSION"

# 更新 iOS Info.plist
PLIST_PATH="src-tauri/gen/apple/note-gen_iOS/Info.plist"

if [ -f "$PLIST_PATH" ]; then
    # 更新版本号 - 使用更精确的匹配模式
    sed -i '' '/CFBundleShortVersionString/,/<string>/s/<string>.*<\/string>/<string>'$VERSION'<\/string>/' "$PLIST_PATH"
    sed -i '' '/CFBundleVersion/,/<string>/s/<string>.*<\/string>/<string>'$VERSION'<\/string>/' "$PLIST_PATH"
    
    echo "iOS 版本号已更新为: $VERSION"
else
    echo "Info.plist 文件不存在，请先运行构建命令"
fi
