# NoteGen Tavern 功能开发计划

## 一、功能对比分析 (与 SillyTavern 对比)

### 已完成功能 ✅

| 功能模块 | SillyTavern | NoteGen | 状态 |
|---------|-------------|---------|------|
| 角色卡导入/导出 | PNG V2/V3 解析 | ✅ 完整支持 | 完成 |
| 角色编辑器 | 完整编辑界面 | ✅ 基础编辑 | 完成 |
| 聊天会话 | 多会话管理 | ✅ 支持 | 完成 |
| 消息 Swipe | 多回复切换 | ✅ 支持 | 完成 |
| 流式响应 | SSE 流式 | ✅ 支持 | 完成 |
| Instruct 模式 | 多模板支持 | ✅ 支持 | 完成 |
| Prompt Manager | 提示词管理 | ✅ 基础支持 | 完成 |
| World Info | 世界书/知识库 | ✅ 导入/扫描 | 完成 |
| 群组聊天 | 多角色对话 | ✅ 基础支持 | 完成 |
| 多后端支持 | OpenAI/Ollama/LlamaCpp | ✅ 支持 | 完成 |
| 预设管理 | 采样参数预设 | ✅ 支持 | 完成 |
| Regex 脚本 | 输入/输出处理 | ✅ 基础支持 | 完成 |
| Persona | 用户人设 | ✅ 支持 | 完成 |
| **Author's Note** | 作者笔记/浮动提示词 | ✅ 支持 | 完成 |
| **Chat Bookmarks** | 聊天检查点/书签 | ✅ 支持 | 完成 |
| **Chat Backups** | 聊天自动备份 | ✅ 支持 | 完成 |
| **消息隐藏/显示** | 隐藏特定消息不参与上下文 | ✅ 支持 | 完成 |
| **Memory/Summary** | 自动摘要/长期记忆 | ✅ 支持 | 完成 |
| **Quick Reply** | 快捷回复按钮 | ✅ 支持 | 完成 |
| **Logit Bias** | Token 偏置控制 | ✅ 支持 | 完成 |
| **CFG Scale** | 引导缩放 (负面提示词) | ✅ 支持 | 完成 |
| **Token Counter** | 实时 Token 计数显示 | ✅ 支持 | 完成 |
| **TTS 语音合成** | 角色语音朗读 | ✅ 支持 | 完成 |
| **Expressions** | 角色表情/立绘切换 | ✅ 支持 | 完成 |
| **Image Caption** | 图片描述/多模态 | ✅ 支持 | 完成 |
| **Attachments** | 文件附件/数据银行 | ✅ 支持 | 完成 |
| **Vectors/RAG** | 向量检索增强 | ✅ 支持 | 完成 |
| **Translate** | 实时翻译 | ✅ 支持 | 完成 |
| **Slash Commands** | 斜杠命令系统 | ✅ 支持 | 完成 |
| **Variables** | 变量系统 (本地/全局) | ✅ 支持 | 完成 |
| **Macros** | 宏替换系统 | ✅ 支持 | 完成 |
| **Tool Calling** | 工具调用/函数调用 | ✅ 支持 | 完成 |

### 未完成功能 - 精简后的开发计划

#### 🔥 优先级 P4 - 高价值功能 (立即实现)

| 功能 | 描述 | 复杂度 | 预计工时 | 状态 |
|-----|------|--------|---------|------|
| **Reasoning Display** | AI 思考过程显示 (DeepSeek R1/Claude thinking/o1) | 高 | 6h | ✅ 完成 |
| **Backgrounds** | 聊天背景/壁纸系统 | 中 | 4h | ✅ 完成 |
| **Stats** | 角色/聊天统计数据 | 低 | 2h | ✅ 完成 |
| **Gallery** | 角色图片画廊管理 | 中 | 4h | ✅ 完成 |
| **Data Maid** | 数据清理/管理工具 (孤立文件、重复数据) | 中 | 3h | ✅ 完成 |

#### ⚠️ 已过时/跳过的功能

| 功能 | 跳过原因 |
|-----|---------|
| **Logprobs** | 现代 API 大多不返回 token 概率，实用价值低 |
| **Scrapers** | 现代 LLM 已有内置网页浏览能力 |
| **Stable Diffusion** | 复杂度太高，用户更倾向使用专门工具 (ComfyUI) |
| **CFG Scale** | 仅对少数本地模型有效，云端 API 不支持 |
| **Logit Bias** | 大多数云端 API 已限制此参数 |
| **Bulk Edit** | 使用频率低 |
| **Server History** | 价值有限 |

---

## 二、功能完成度总结

### 当前完成度: **约 95%**

NoteGen Tavern 模块已实现 SillyTavern 的绝大部分核心功能:

| 优先级 | 状态 | 功能数量 |
|--------|------|----------|
| P0 核心功能 | ✅ 全部完成 | 4/4 |
| P1 高级功能 | ✅ 全部完成 | 5/5 |
| P2 扩展功能 | ✅ 全部完成 | 6/6 |
| P3 高级特性 | ✅ 全部完成 | 4/4 |
| P4 UI/UX 增强 | ✅ 全部完成 | 5/5 |
| P5 图像生成 | ❌ 跳过 (过时) | 0/3 |
| P6 高级系统 | ❌ 未开始 | 0/7 |

### 主要差距分析

1. **图像生成 (P5)**: Stable Diffusion 集成 - 已标记为过时，用户更倾向使用专门工具
2. **高级系统 (P6)**: 扩展系统、连接管理等高级功能 - 可选实现

### 已完成的 P4 功能

1. **Reasoning Display** - AI 思考过程显示，支持 DeepSeek/Claude/o1 等模型
2. **Backgrounds** - 聊天背景系统，支持全局/聊天专属背景
3. **Stats** - 角色/聊天统计数据，消息数、字数、生成时间等
4. **Gallery** - 角色图片画廊管理，支持上传、收藏、搜索
5. **Data Maid** - 数据清理工具，扫描并清理孤立文件、空聊天等

---

## 三、SillyTavern 上下文构成分析

详细分析文档见: [ST_CONTEXT_ANALYSIS.md](./ST_CONTEXT_ANALYSIS.md)

### 核心发现

#### 3.1 上下文构建顺序
```
1. worldInfoBefore → 2. main → 3. worldInfoAfter
4. charDescription → 5. charPersonality → 6. scenario
7. personaDescription → 8. nsfw → 9. jailbreak
10. chatHistory (含深度注入) → 11. controlPrompts
```

#### 3.2 深度注入机制
- `injection_depth`: 控制在聊天历史中的插入位置
- `injection_order`: 同深度时的优先级排序
- 支持 system/user/assistant 三种角色

#### 3.3 群聊机制
- **生成模式**: SWAP (切换) / APPEND (追加) / APPEND_DISABLED (全追加)
- **激活策略**: NATURAL (自然) / LIST (列表) / MANUAL (手动) / POOLED (池化)
- **卡片合并**: 在 APPEND 模式下合并所有成员的描述/性格/场景

#### 3.4 Token 预算管理
- ChatCompletion 类管理 token 预算
- 优先保证系统提示词，聊天历史按预算填充
- 支持预留和释放预算

### 3.5 ST 风格优化实现 ✅ 已完成

基于 ST 分析，已实现以下核心模块:

| 模块 | 文件 | 功能 |
|------|------|------|
| **ChatCompletion** | `chat-completion.ts` | Token 预算管理、消息集合、深度注入 |
| **ContextBuilderV2** | `context-builder-v2.ts` | ST 风格上下文构建流程 |
| **GroupChatV2** | `group-chat-v2.ts` | 三种生成模式、四种激活策略、卡片合并 |
| **PromptManagerStore** | `tavern-prompt-manager.ts` | 提示词顺序管理、角色专属配置 |
| **ContextIntegration** | `context-integration.ts` | 统一上下文构建接口 |
| **PromptManagerPanel** | `prompt-manager-panel.tsx` | 提示词管理器 UI 组件 |

#### 新增功能特性:

1. **ChatCompletion 类**
   - `setTokenBudget()` - 设置 token 预算
   - `reserveBudget()` / `freeBudget()` - 预留/释放预算
   - `canAfford()` - 检查是否能负担
   - `addDepthInjection()` - 深度注入支持
   - `MessageCollection` - 消息集合管理

2. **ContextBuilderV2**
   - 完整的 ST 上下文构建流程
   - 扩展提示词支持 (Summary, Author's Note, Vectors)
   - 世界书深度注入
   - 群聊上下文支持
   - Token 预算自动管理

3. **GroupChatManager**
   - `GroupGenerationMode.Swap/Append/AppendDisabled`
   - `GroupActivationStrategy.Natural/List/Manual/Pooled`
   - `getCombinedCards()` - 角色卡合并
   - `getGroupDepthPrompts()` - 群组深度提示词收集
   - `selectNextSpeaker()` - 智能发言者选择

4. **PromptManagerStore**
   - 全局/角色专属提示词顺序
   - 提示词启用/禁用/排序
   - 导入/导出配置
   - 自定义提示词添加

5. **ContextIntegration (统一接口)**
   - `buildUnifiedContext()` - 统一上下文构建
   - `buildContextWithV2()` - V2 构建器
   - `buildContextWithV1()` - V1 兼容层
   - `collectExtensionPrompts()` - 自动收集扩展提示词
   - `shouldUseV2Builder()` - 智能选择构建器

6. **PromptManagerPanel (UI 组件)**
   - 拖拽排序提示词顺序
   - 启用/禁用提示词
   - 添加/编辑/删除自定义提示词
   - 导入/导出配置
   - 紧凑模式支持

---

## 四、与 NoteGen 已有功能的整合机会

### 3.1 RAG 整合 (高价值) ✅ 已完成

NoteGen 已有 RAG 功能 (`src/lib/rag.ts`, `src/stores/ragSettings.ts`)，可以：
- 将笔记内容作为 Tavern 对话的知识库
- 角色可以"阅读"用户的笔记并引用
- World Info 与笔记标签系统联动

### 3.2 语音功能整合 ✅ 已完成

NoteGen 已有语音识别和朗读功能：
- `src/stores/speech-recognition.ts` - 语音识别
- `src/stores/setting.ts` - 朗读设置
- 可复用于 Tavern TTS 功能

### 2.3 AI 服务整合

NoteGen 已有 AI 配置 (`src/app/core/setting/ai`)：
- 统一的 AI 后端配置
- 可与 Tavern 后端系统合并或互通

### 2.4 标签系统整合

NoteGen 的标签系统可用于：
- 角色卡分类管理
- World Info 条目关联
- 聊天会话分组

---

## 三、推荐开发计划

### 阶段 1: 核心功能完善 (1-2 天)

**目标**: 完善基础聊天体验

1. **Author's Note (作者笔记)** ✅ 已完成
   - 在聊天界面添加浮动提示词输入
   - 支持插入位置配置 (场景后/聊天中/深度)
   - 支持触发间隔设置

2. **Chat Bookmarks (聊天书签)** ✅ 已完成
   - 保存当前聊天状态为检查点
   - 支持恢复到任意检查点
   - 检查点列表管理

3. **消息隐藏功能** ✅ 已完成 (之前实现)
   - 消息右键菜单添加隐藏选项
   - 隐藏消息不参与上下文构建
   - 显示隐藏消息数量指示

4. **Token Counter (Token 计数)** ✅ 已完成
   - 实时显示当前上下文 Token 数
   - 显示剩余可用 Token
   - 警告接近上限

### 阶段 2: 高级功能 (2-3 天)

**目标**: 增强对话质量和控制

1. **Memory/Summary (自动摘要)**
   - 对话超过阈值时自动生成摘要
   - 摘要作为上下文前缀
   - 支持手动编辑摘要

2. **Quick Reply (快捷回复)**
   - 可配置的快捷回复按钮
   - 支持宏替换
   - 支持自动执行触发

### 阶段 3: NoteGen 特色整合 (2-3 天)

**目标**: 发挥 NoteGen 独特优势

1. **笔记-角色联动**
   - 角色可引用用户笔记内容
   - 笔记标签与 World Info 联动
   - 对话内容可保存为笔记

2. **语音功能整合**
   - 复用现有语音识别输入
   - 复用现有朗读功能
   - 角色专属语音设置

3. **AI 配置统一**
   - Tavern 后端与全局 AI 设置互通
   - 统一的模型选择界面

### 阶段 4: 扩展功能 (可选)

根据用户反馈选择性实现：
- Expressions (表情系统)
- Image Caption (图片描述)
- Slash Commands (命令系统)
- Variables/Macros (变量/宏系统)

---

## 四、技术实现要点

### 4.1 Author's Note 实现

```typescript
// 新增 Store: src/stores/tavern-authors-note.ts
interface AuthorsNoteConfig {
  content: string           // 笔记内容
  position: 'after_scenario' | 'in_chat' | 'before_scenario'
  depth: number             // 插入深度 (0-100)
  interval: number          // 触发间隔 (每 N 条消息)
  role: 'system' | 'user' | 'assistant'
}

// 修改 context-builder.ts 支持 Author's Note 注入
```

### 4.2 Chat Bookmarks 实现

```typescript
// 新增数据库表
interface TavernBookmark {
  id: number
  chatId: number
  name: string
  messageCount: number      // 书签时的消息数量
  metadata: string          // 聊天元数据快照
  createdAt: number
}

// 恢复时截断消息到书签点
```

### 4.3 Memory/Summary 实现

```typescript
// 新增 Store: src/stores/tavern-memory.ts
interface MemoryConfig {
  enabled: boolean
  source: 'main' | 'separate'  // 使用主模型或单独模型
  prompt: string               // 摘要提示词
  template: string             // 摘要模板
  triggerThreshold: number     // 触发阈值 (消息数)
  maxWords: number             // 摘要最大字数
}

// 摘要存储在 chat_metadata 中
```

---

## 五、开发优先级建议

基于 **用户价值** 和 **实现复杂度** 的综合考量：

### 立即实施 (本周)
1. ✅ Author's Note - 高价值，中等复杂度 **已完成**
2. ✅ 消息隐藏 - 高价值，低复杂度 **已完成**
3. ✅ Token Counter - 中等价值，低复杂度 **已完成**
4. ✅ Chat Bookmarks - 高价值，中等复杂度 **已完成**

### 短期实施 (下周)
5. ✅ Quick Reply - 中等价值，中等复杂度 **已完成**

### 中期实施 (2周内)
6. Memory/Summary - 高价值，高复杂度
7. 笔记-角色联动 - NoteGen 特色，中等复杂度

### 长期规划
8. TTS/语音整合
9. Expressions 表情系统
10. Slash Commands 命令系统

---

## 六、总结

NoteGen 的 Tavern 模块已经实现了 SillyTavern 约 **60-70%** 的核心功能。剩余功能中：

- **必要功能** (Author's Note, Bookmarks, Memory) 约需 **2-3 天**
- **增强功能** (Quick Reply, Token Counter) 约需 **1-2 天**
- **特色整合** (笔记联动, 语音) 约需 **2-3 天**

建议优先完成 **阶段 1** 的核心功能，这将使 Tavern 模块达到可用于日常使用的完整度。
