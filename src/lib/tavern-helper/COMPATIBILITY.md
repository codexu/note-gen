# TavernHelper 兼容性跟踪

本文档跟踪 tavern-helper 模块与 SillyTavern JS-Slash-Runner 的兼容性状态。

## 参考项目

- **JS-Slash-Runner**: https://github.com/N0VI028/JS-Slash-Runner
- **参考版本**: v1.x (2026-02-03 检查)
- **SillyTavern**: https://github.com/SillyTavern/SillyTavern

## 实现状态

### 核心模块 (Core)

| 功能 | 状态 | 说明 |
|------|------|------|
| EventBus | ✅ 已实现 | 支持优先级 (first/high/normal/low/last) |
| Logger | ✅ 已实现 | 支持 debug/info/warn/error |
| ErrorHandler | ✅ 已实现 | 统一错误处理和错误码 |

### 变量系统 (Variables)

| 功能 | 状态 | 说明 |
|------|------|------|
| getvar | ✅ 已实现 | 获取变量 |
| setvar | ✅ 已实现 | 设置变量 |
| getglobalvar | ✅ 已实现 | 全局变量 |
| setglobalvar | ✅ 已实现 | 全局变量 |
| getchatvar | ✅ 已实现 | 聊天变量 |
| setchatvar | ✅ 已实现 | 聊天变量 |
| 多作用域 | ✅ 已实现 | global/preset/character/chat/message/script |
| 优先级解析 | ✅ 已实现 | script > message > chat > character > preset > global |
| 持久化 | ✅ 已实现 | localStorage |

### 消息系统 (Messages)

| 功能 | 状态 | 说明 |
|------|------|------|
| getMessages | ✅ 已实现 | 获取消息列表 |
| getMessage | ✅ 已实现 | 按索引获取 |
| getLastMessage | ✅ 已实现 | 获取最后一条 |
| addMessage | ✅ 已实现 | 添加消息 |
| deleteMessage | ✅ 已实现 | 删除消息 |
| editMessage | ✅ 已实现 | 编辑消息 |
| hideMessage | ✅ 已实现 | 隐藏消息 |
| Swipe 管理 | ✅ 已实现 | addSwipe/switchSwipe/nextSwipe/prevSwipe |

### 生成系统 (Generate)

| 功能 | 状态 | 说明 |
|------|------|------|
| generate | ✅ 已实现 | 使用预设生成 |
| generateRaw | ✅ 已实现 | 原始 prompt 生成 |
| 流式输出 | ✅ 已实现 | streaming support |
| 中止生成 | ✅ 已实现 | abort control |
| AIProvider | ✅ 已实现 | 可插拔的 AI 提供者接口 |

### 宏系统 (Macros)

| 功能 | 状态 | 说明 |
|------|------|------|
| {{getvar::}} | ✅ 已实现 | 获取变量 |
| {{setvar::}} | ✅ 已实现 | 设置变量 |
| {{getglobalvar::}} | ✅ 已实现 | 全局变量 |
| {{setglobalvar::}} | ✅ 已实现 | 全局变量 |
| {{random::}} | ✅ 已实现 | 随机数 |
| {{roll::}} | ✅ 已实现 | 骰子 |
| {{pick::}} | ✅ 已实现 | 随机选择 |
| {{if::}} | ✅ 已实现 | 条件判断 |
| {{time}} | ✅ 已实现 | 当前时间 |
| {{date}} | ✅ 已实现 | 当前日期 |
| {{weekday}} | ✅ 已实现 | 星期几 |
| {{user}} | ✅ 已实现 | 用户名 |
| {{char}} | ✅ 已实现 | 角色名 |
| {{trim::}} | ✅ 已实现 | 去除空白 |
| {{calc::}} | ✅ 已实现 | 数学计算 |
| {{lower::}} | ✅ 已实现 | 转小写 |
| {{upper::}} | ✅ 已实现 | 转大写 |
| 自定义宏 | ✅ 已实现 | register/unregister |

### 注入系统 (Inject)

| 功能 | 状态 | 说明 |
|------|------|------|
| inject before | ✅ 已实现 | 注入到开头 |
| inject after | ✅ 已实现 | 注入到末尾 |
| inject in_chat | ✅ 已实现 | 按深度注入 |
| 一次性注入 | ✅ 已实现 | once option |
| 过滤器 | ✅ 已实现 | character/chat filter |
| 宏处理 | ✅ 已实现 | 自动处理注入内容中的宏 |

### 兼容层 (Compat)

| API | 状态 | 说明 |
|-----|------|------|
| STCompat 全局对象 | ✅ 已实现 | ST 风格 API |
| eventSource | ✅ 已实现 | 事件源兼容 |

## 待跟进功能

以下功能可能需要在后续版本中实现：

| 功能 | 优先级 | 说明 |
|------|--------|------|
| Slash Commands | 中 | /command 命令系统 |
| Quick Reply | 低 | 快捷回复集成 |
| World Info API | 中 | 世界书 API |
| Character API | 中 | 角色卡 API |
| Group Chat API | 低 | 群聊 API |

## 更新日志

### 2026-02-03 - 初始版本 (v1.0.0)
- 实现核心模块: EventBus, Logger, ErrorHandler
- 实现变量系统: 多作用域存储和优先级解析
- 实现消息系统: CRUD 和 Swipe 管理
- 实现生成系统: 流式输出和中止控制
- 实现宏系统: 15+ 内置宏和自定义宏支持
- 实现注入系统: 位置控制和过滤器
- 实现兼容层: ST 风格 API 适配器

## 注意事项

1. **独立实现**: tavern-helper 是原生实现，不直接依赖 JS-Slash-Runner 代码
2. **API 兼容**: 兼容层提供与 ST 风格相似的 API，但内部实现可能不同
3. **功能差异**: 部分功能根据 NoteGen 架构进行了调整
4. **更新策略**: 定期检查上游变化，评估后选择性移植
