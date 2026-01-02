# Android 贡献指南

## 重要安全说明

⚠️ **请不要上传任何密钥库文件到 GitHub！**

## 开发者构建

如果你是开发者并需要构建 Android 应用：

### 1. 生成自己的签名密钥

```bash
cd src-tauri
keytool -genkey -v -keystore android-app.keystore -alias note-gen -keyalg RSA -keysize 2048 -validity 10000
```

### 2. 使用构建脚本

```bash
./build-android.sh release
```

### 3. 更新构建配置

修改 `build-android.sh` 中的密钥库信息：
- `KEYSTORE_PATH`: 你的密钥库文件路径
- `KEY_ALIAS`: 你的密钥别名

## 发布流程

### 官方发布

1. **维护者**使用官方密钥库签名发布版本
2. **GitHub Actions** 自动构建和签名（使用加密的密钥库）
3. **Release** 页面提供已签名的 APK

### 社区构建

社区开发者可以：
1. 使用自己的密钥库构建测试版本
2. 在 PR 中展示构建结果
3. **不要**分发自己签名的发布版本

## 密钥库管理

### 官方密钥库

- **位置**: 安全存储，不在代码库中
- **备份**: 多重备份，离线存储
- **访问权限**: 仅限核心维护者

### 个人密钥库

- 自己生成，自己管理
- 用于个人测试和开发
- **绝不**用于公开发布

## 安全最佳实践

1. **永远不要**提交密钥库文件到版本控制
2. **使用强密码**保护密钥库
3. **定期备份**密钥库文件
4. **使用不同的密钥库**用于开发和发布
5. **启用 2FA**保护相关账户

## 故障排除

如果遇到密钥库相关错误：

1. 确认密钥库文件存在且可访问
2. 检查密钥库密码是否正确
3. 验证密钥别名是否匹配
4. 重新生成密钥库（如果忘记密码）

## 更多信息

- [Android 应用签名指南](https://developer.android.com/studio/publish/app-signing)
- [Tauri Android 文档](https://tauri.app/v1/guides/building/android)
- [项目安全政策](SECURITY.md)
