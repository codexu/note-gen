# SillyTavern vs NoteGen Tavern 深度对比分析

## 一、架构对比

### SillyTavern 架构

```
SillyTavern/
├── src/                      # Node.js 后端
│   ├── endpoints/            # REST API 端点 (40+ 个)
│   │   ├── openai.js         # OpenAI/Claude API 代理
│   │   ├── characters.js     # 角色管理
│   │   ├── chats.js          # 聊天管理
│   │   ├── groups.js         # 群组管理
│   │   ├── worldinfo.js      # 世界书
│   │   └── ...
│   ├── tokenizers/           # 多种 tokenizer 支持
│   └── vectors/              # 向量数据库
├── public/
│   ├── scripts/              # 前端 JS (核心逻辑)
│   │   ├── script.js         # 主入口 (7000+ 行)
│   │   ├── openai.js         # AI 生成逻辑 (3000+ 行)
│   │   ├── PromptManager.js  # 提示词管理器
│   │   ├── group-chats.js    # 群聊系统
│   │   ├── world-info.js     # 世界书扫描
│   │   └── extensions/       # 扩展系统
│   │       ├── memory/       # 记忆/摘要
│   │       ├── vectors/      # RAG
│   │       ├── tts/          # 语音合成
│   │       └── ...
│   └── css/                  # 样式
└── data/                     # 用户数据
```

**特点**:
- Express.js 后端 + 原生 JS 前端
- 文件系统存储 (JSON/PNG)
- 插件系统通过 `/plugins` 目录
- 扩展系统通过 `/scripts/extensions`
- 事件驱动架构 (`eventSource`)

### NoteGen Tavern 架构

```
note-gen/
├── src/
│   ├── app/core/tavern/      # UI 组件
│   │   ├── editor/           # 角色编辑器
│   │   ├── groups/           # 群组管理
│   │   ├── world-info/       # 世界书
│   │   └── ...
│   ├── lib/tavern/           # 核心逻辑
│   │   ├── context-builder.ts      # V1 上下文构建
│   │   ├── context-builder-v2.ts   # V2 ST 风格
│   │   ├── chat-completion.ts      # ST ChatCompletion
│   │   ├── group-chat-v2.ts        # 群聊系统
│   │   ├── streaming.ts            # 流式处理
│   │   ├── backends/               # 后端适配器
│   │   └── ...
│   ├── stores/               # Zustand 状态
│   │   ├── tavern-*.ts       # 20+ 专用 store
│   │   └── ...
│   └── db/tavern.ts          # SQLite 数据库
└── src-tauri/src/            # Rust 原生功能
    └── tavern.rs             # PNG 解析
```

**特点**:
- Tauri + Next.js + TypeScript
- SQLite 数据库存储
- Zustand 状态管理
- 无独立后端，AI 调用直连

---

## 二、核心系统对比

### 2.1 上下文构建 (Context Building)

#### SillyTavern 流程

```javascript
// openai.js - generateChatCompletion
1. preparePrompts()           // 准备提示词
2. getPromptOrderForCharacter()  // 获取提示词顺序
3. populateChatCompletion()   // 填充 ChatCompletion
   ├── addToChatCompletion('main')
   ├── addToChatCompletion('charDescription')
   ├── addToChatCompletion('worldInfoBefore')
   ├── populateDialogueExamples()
   ├── populateDepthInjections()
   └── populateChatHistory()
4. depth injections at specific positions
5. extension prompts injection
```

**关键类**:
- `ChatCompletion` - token 预算管理
- `MessageCollection` - 消息集合
- `PromptManager` - 提示词顺序/启用状态

#### NoteGen 流程

```typescript
// context-builder-v2.ts
1. loadWorldInfo()            // 加载世界书
2. scanWorldInfo()            // 扫描触发条目
3. preparePrompts()           // 准备提示词
4. buildMessages()            // 构建消息
   ├── 系统提示词
   ├── 角色描述/人格/场景
   ├── 世界书 (before/after)
   ├── 示例对话
   ├── 聊天历史
   └── 深度注入
```

#### ❌ 差距分析

| 功能 | SillyTavern | NoteGen | 状态 |
|-----|------------|---------|------|
| Token 预算管理 | ✅ 精确管理 | ⚠️ 简单估算 | 需改进 |
| 动态预算调整 | ✅ reserve/free | ❌ 缺失 | 需实现 |
| 提示词禁用检查 | ✅ isPromptDisabledForActiveCharacter | ⚠️ 基础支持 | 需完善 |
| 扩展提示词位置 | ✅ BEFORE/IN/AFTER + 深度 | ⚠️ 部分支持 | 需扩展 |
| 消息媒体内联 | ✅ 图片/视频/音频 | ⚠️ 仅图片 | 需扩展 |
| Tool 调用消息 | ✅ 完整支持 | ⚠️ 基础支持 | 需完善 |

### 2.2 群聊系统 (Group Chat)

#### SillyTavern

```javascript
// group-chats.js
group_activation_strategy = {
  NATURAL: 0,    // 自然对话 - 基于提及
  LIST: 1,       // 列表顺序
  MANUAL: 2,     // 手动选择
  POOLED: 3,     // 池化模式
}

group_generation_mode = {
  SWAP: 0,           // 切换 - 仅当前角色卡
  APPEND: 1,         // 追加 - 合并启用成员
  APPEND_DISABLED: 2 // 全追加 - 包括禁用成员
}

// 关键函数
getGroupDepthPrompts()       // 收集群组深度提示词
getGroupCharacterCards()     // 合并角色卡 (lazy)
generateGroupWrapper()       // 群组生成包装
```

#### NoteGen

```typescript
// group-chat-v2.ts
enum GroupGenerationMode { Swap, Append, AppendDisabled }
enum GroupActivationStrategy { Natural, List, Manual, Pooled }

class GroupChatManager {
  selectNextSpeaker()         // 选择发言者
  getCombinedCards()          // 合并角色卡
  getGroupDepthPrompts()      // 群组深度提示词
}
```

#### ❌ 差距分析

| 功能 | SillyTavern | NoteGen | 状态 |
|-----|------------|---------|------|
| 生成模式 | ✅ 3 种 | ✅ 3 种 | 完成 |
| 激活策略 | ✅ 4 种 | ✅ 4 种 | 完成 |
| 自动模式 | ✅ autoModeWorker | ❌ 缺失 | 需实现 |
| 发言顺序队列 | ✅ groupChatQueueOrder | ❌ 缺失 | 需实现 |
| 角色卡惰性加载 | ✅ lazy evaluation | ❌ 缺失 | 建议实现 |

### 2.3 世界书 (World Info)

#### SillyTavern

```javascript
// world-info.js
class WorldInfoBuffer {
  scanChat()                  // 扫描聊天
  scanEntry()                 // 扫描单条
  isExternallyActivated()     // 外部激活检查
  getScore()                  // 计算得分
}

// 扫描状态
scan_state = {
  NONE: 0,
  INITIAL: 1,
  RECURSION: 2,
  MIN_ACTIVATIONS: 3,
}

// 高级功能
- Timed Effects (sticky/cooldown/delay)
- Selective Logic (AND_ANY, NOT_ALL, etc.)
- Position scanning (personaDescription, etc.)
- Recursive scanning
- Min activations depth skew
```

#### NoteGen

```typescript
// world-info-scanner.ts
class WorldInfoScanner {
  scan()                      // 主扫描方法
  matchEntry()                // 匹配单条
  checkSelectiveLogic()       // 选择逻辑
}

// 支持功能
- SelectiveLogic 枚举
- TimedEffects (sticky/cooldown/delay)
- ScanState 状态
```

#### ❌ 差距分析

| 功能 | SillyTavern | NoteGen | 状态 |
|-----|------------|---------|------|
| 基础扫描 | ✅ | ✅ | 完成 |
| 递归扫描 | ✅ | ⚠️ 部分 | 需完善 |
| 位置扫描 | ✅ 6 种位置 | ⚠️ 有限 | 需扩展 |
| 时间效果 | ✅ | ✅ | 完成 |
| 最小激活数 | ✅ | ❌ | 需实现 |
| 组评分 | ✅ useGroupScoring | ❌ | 需实现 |
| 装饰器 | ✅ @@activate, @@dont_activate | ❌ | 需实现 |

### 2.4 记忆/摘要 (Memory/Summary)

#### SillyTavern

```javascript
// extensions/memory/index.js
summary_sources = {
  extras: 'extras',
  main: 'main',
  webllm: 'webllm',
}

prompt_builders = {
  DEFAULT: 0,
  RAW_BLOCKING: 1,
  RAW_NON_BLOCKING: 2,
}

// 功能
- 自动摘要生成
- 手动冻结摘要
- 强制字数控制
- 摘要模板
- WI 扫描整合
- 多来源支持
```

#### NoteGen

```typescript
// memory-service.ts + tavern-memory store
interface MemoryConfig {
  enabled: boolean
  insertPosition: 'before_system' | 'after_system' | 'before_examples' | 'in_chat'
  insertDepth: number
  // ...
}

// 功能
- generateSummary()
- autoSummarizeIfNeeded()
- injectSummaryToContext()
```

#### ❌ 差距分析

| 功能 | SillyTavern | NoteGen | 状态 |
|-----|------------|---------|------|
| 自动摘要 | ✅ | ✅ | 完成 |
| 摘要冻结 | ✅ | ✅ | 完成 |
| 多来源 | ✅ 3 种 | ⚠️ 仅 main | 需扩展 |
| 强制字数 | ✅ | ❌ | 需实现 |
| RAW 生成模式 | ✅ | ❌ | 需实现 |
| WI 扫描整合 | ✅ | ❌ | 需实现 |

### 2.5 工具调用 (Tool Calling)

#### SillyTavern

```javascript
// tool-calling.js
class ToolDefinition {
  toFunctionOpenAI()          // 转 OpenAI 格式
}

class ToolManager {
  registerTool()              // 注册工具
  invokeTool()                // 调用工具
  getToolsForRequest()        // 获取请求工具列表
}

// 特性
- Stealth tools (隐形工具)
- Tool result formatting
- Slash command integration
```

#### NoteGen

```typescript
// tool-calling-service.ts + tavern-tool-calling store
executeToolCall()             // 执行工具调用
executeBuiltinTool()          // 内置工具

// 内置工具
- search_notes
- search_world_info (TODO)
- calculate
- get_current_time
- roll_dice
- random_choice
```

#### ❌ 差距分析

| 功能 | SillyTavern | NoteGen | 状态 |
|-----|------------|---------|------|
| 工具注册 | ✅ 动态注册 | ⚠️ 硬编码 | 需重构 |
| Stealth 工具 | ✅ | ❌ | 需实现 |
| OpenAI 格式 | ✅ | ⚠️ 部分 | 需完善 |
| 工具结果格式化 | ✅ | ⚠️ 基础 | 需完善 |
| 自定义工具 | ✅ | ❌ | 需实现 |

---

## 三、扩展系统对比

### SillyTavern 扩展

```
extensions/
├── assets/           # 资源管理
├── attachments/      # 附件/数据银行
├── caption/          # 图片描述
├── expressions/      # 表情/立绘
├── gallery/          # 画廊
├── memory/           # 记忆/摘要
├── quick-reply/      # 快捷回复
├── regex/            # 正则处理
├── stable-diffusion/ # 图片生成
├── token-counter/    # Token 计数
├── translate/        # 翻译
├── tts/              # 语音合成
└── vectors/          # RAG/向量
```

### NoteGen 对应实现

| ST 扩展 | NoteGen 实现 | 状态 |
|--------|-------------|------|
| memory | tavern-memory store | ✅ |
| quick-reply | tavern-quick-reply store | ✅ |
| expressions | tavern-expressions store | ✅ |
| tts | tavern-tts store | ✅ |
| vectors | tavern-vectors store + lib/rag | ✅ |
| translate | tavern-translate store | ✅ |
| attachments | tavern-attachments store | ✅ |
| caption | tavern-image-caption store | ✅ |
| gallery | tavern-gallery store | ✅ |
| regex | regex-processor.ts | ✅ |
| stable-diffusion | ❌ | 跳过 |
| connection-manager | ❌ | 不需要 |

---

## 四、需要修复/调整的问题

### 4.1 高优先级 (P0) - 核心功能

1. **Token 预算管理重构**
   - 实现精确的 `reserve/free` 机制
   - 添加 `canAfford()` 检查
   - 支持动态预算调整
   
   ```typescript
   // 参考 ST 的 ChatCompletion 类
   class ChatCompletion {
     private budget: number
     private reserved: Map<string, number>
     
     reserveBudget(message: Message): void
     freeBudget(message: Message): void
     canAfford(message: Message): boolean
   }
   ```

2. **扩展提示词位置完善**
   - 支持所有注入位置: `BEFORE_PROMPT`, `IN_PROMPT`, `AFTER_PROMPT`, `IN_CHAT`
   - 支持深度注入 (`injection_depth`)
   - 支持注入顺序 (`injection_order`)

3. **群聊自动模式**
   - 实现 `autoModeWorker` 定时器
   - 支持自动模式延迟配置
   
   ```typescript
   // 参考实现
   let autoModeWorker: NodeJS.Timer | null = null
   
   function setAutoModeWorker() {
     const delay = group.auto_mode_delay ?? 5
     autoModeWorker = setInterval(groupChatAutoModeWorker, delay * 1000)
   }
   ```

### 4.2 中优先级 (P1) - 功能完善

1. **世界书扫描增强**
   - 实现最小激活数 (`world_info_min_activations`)
   - 实现组评分 (`world_info_use_group_scoring`)
   - 支持装饰器 (`@@activate`, `@@dont_activate`)

2. **工具调用系统重构**
   - 实现动态工具注册
   - 支持 Stealth 工具
   - 完善 OpenAI function calling 格式

3. **记忆系统增强**
   - 支持 RAW 生成模式
   - 实现强制字数控制
   - 添加 WI 扫描整合选项

### 4.3 低优先级 (P2) - 体验优化

1. **媒体内联扩展**
   - 支持视频内联
   - 支持音频内联

2. **性能优化**
   - 角色卡惰性加载
   - 世界书缓存优化

3. **调试工具**
   - Token 使用可视化
   - 上下文构建日志

---

## 五、代码迁移建议

### 5.1 可直接参考的 ST 代码

1. **ChatCompletion 类** (`PromptManager.js`)
   - Token 预算管理逻辑
   - 消息集合管理

2. **Group Chat Worker** (`group-chats.js`)
   - 自动模式实现
   - 发言者选择算法

3. **World Info Buffer** (`world-info.js`)
   - 扫描状态机
   - 递归扫描逻辑

### 5.2 需要重写的功能

1. **事件系统**
   - ST 使用 `eventSource` 事件总线
   - NoteGen 应使用 Zustand + mitt

2. **存储层**
   - ST 使用文件系统
   - NoteGen 使用 SQLite，需要适配查询逻辑

3. **UI 渲染**
   - ST 使用 jQuery + 模板
   - NoteGen 使用 React，需要重构组件

---

## 六、实施计划

### Phase 1 (1-2 周)
- [ ] Token 预算管理重构
- [ ] 扩展提示词位置完善
- [ ] 群聊自动模式

### Phase 2 (2-3 周)
- [ ] 世界书扫描增强
- [ ] 工具调用系统重构
- [ ] 记忆系统增强

### Phase 3 (1 周)
- [ ] 媒体内联扩展
- [ ] 性能优化
- [ ] 调试工具

---

## 七、附录

### A. ST 关键文件参考

| 功能 | ST 文件 | 行数 |
|-----|--------|-----|
| 主入口 | `script.js` | ~7000 |
| AI 生成 | `openai.js` | ~3500 |
| 提示词管理 | `PromptManager.js` | ~1500 |
| 群聊 | `group-chats.js` | ~2500 |
| 世界书 | `world-info.js` | ~4000 |
| 记忆 | `extensions/memory/index.js` | ~800 |
| 工具调用 | `tool-calling.js` | ~600 |

### B. NoteGen 关键文件参考

| 功能 | 文件 | 行数 |
|-----|------|-----|
| 上下文 V2 | `context-builder-v2.ts` | ~400 |
| 群聊 V2 | `group-chat-v2.ts` | ~350 |
| 流式处理 | `streaming.ts` | ~300 |
| 记忆服务 | `memory-service.ts` | ~250 |
| 工具调用 | `tool-calling-service.ts` | ~250 |
