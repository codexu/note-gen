# SillyTavern 上下文构成深度分析

## 概述

本文档深入分析 SillyTavern (ST) 的上下文构建机制，包括提示词注入结构、Token 预算管理和群聊机制。

---

## 1. 核心架构

### 1.1 主要入口函数

```
prepareOpenAIMessages()
    ├── preparePromptsForChatCompletion()  // 准备所有提示词
    └── populateChatCompletion()           // 填充到 ChatCompletion
```

### 1.2 ChatCompletion 类

`ChatCompletion` 是 ST 的核心上下文管理类：

```javascript
class ChatCompletion {
    tokenBudget: number;           // Token 预算
    messages: MessageCollection;    // 消息集合
    
    setTokenBudget(context, response)  // 设置预算 = context - response
    add(collection, position)          // 添加消息集合
    insert(message, identifier, pos)   // 插入消息到指定位置
    canAfford(message)                 // 检查是否有足够预算
    reserveBudget(tokens)              // 预留预算
    freeBudget(tokens)                 // 释放预算
}
```

---

## 2. 上下文构建顺序

### 2.1 基础提示词顺序 (populateChatCompletion)

```
1. worldInfoBefore      // World Info (角色前)
2. main                 // 主系统提示词
3. worldInfoAfter       // World Info (角色后)
4. charDescription      // 角色描述
5. charPersonality      // 角色性格
6. scenario             // 场景设定
7. personaDescription   // 用户人设描述
8. nsfw                 // NSFW 提示词
9. jailbreak            // 越狱提示词
10. enhanceDefinitions  // 增强定义
11. bias                // 偏置提示词
```

### 2.2 扩展提示词注入

在 `preparePromptsForChatCompletion` 中处理的扩展提示词：

| 标识符 | 来源 | 说明 |
|--------|------|------|
| `summary` | `1_memory` | 记忆/摘要扩展 |
| `authorsNote` | `2_floating_prompt` | 作者注释 |
| `vectorsMemory` | `3_vectors` | 向量记忆 |
| `vectorsDataBank` | `4_vectors_data_bank` | 向量数据库 |
| `smartContext` | `chromadb` | ChromaDB 智能上下文 |

### 2.3 控制提示词 (最后添加)

```javascript
const controlPrompts = new MessageCollection('controlPrompts');
// 包含:
// - impersonateMessage (扮演模式)
// - quietPromptMessage (静默提示)
// - continueMessage (继续生成)
```

---

## 3. 注入位置系统

### 3.1 注入位置类型

```javascript
const INJECTION_POSITION = {
    RELATIVE: 0,   // 相对位置 (在提示词列表中)
    ABSOLUTE: 1    // 绝对位置 (在聊天历史中按深度)
};
```

### 3.2 深度注入机制 (populationInjectionPrompts)

深度注入按 `injection_depth` 值将提示词插入聊天历史：

```
depth=0: 插入到最新消息之后
depth=1: 插入到倒数第2条消息之后
depth=N: 插入到倒数第N+1条消息之后
```

注入优先级排序：
1. 按 `injection_order` 从高到低排序
2. 同优先级按角色排序: system → user → assistant

```javascript
// 深度注入示例
for (let i = 0; i <= maxDepth; i++) {
    const depthPrompts = prompts.filter(p => p.injection_depth === i);
    // 按 order 分组，按 role 排序后注入
}
```

---

## 4. 聊天历史填充

### 4.1 populateChatHistory 流程

```
1. 预留 newChat 消息预算
2. 预留 groupNudge 消息预算 (群聊)
3. 预留 continueNudge 消息预算 (继续模式)
4. 从最新到最旧遍历消息
5. 检查每条消息是否在预算内
6. 处理媒体附件 (图片/视频/音频)
7. 处理工具调用结果
8. 插入 newChat 标记
9. 插入 groupNudge (群聊)
```

### 4.2 消息格式化 (setOpenAIMessages)

```javascript
// 名称行为模式
const character_names_behavior = {
    NONE: 0,       // 不添加名称
    DEFAULT: 1,    // 群聊或 sendas 时添加
    CONTENT: 2,    // 总是添加到内容
    COMPLETION: 3  // 使用 API 的 name 字段
};
```

---

## 5. 群聊机制

### 5.1 群聊生成模式

```javascript
const group_generation_mode = {
    SWAP: 0,            // 切换模式 - 每次只用当前角色卡
    APPEND: 1,          // 追加模式 - 合并所有启用成员的卡片
    APPEND_DISABLED: 2  // 追加全部 - 合并所有成员(包括禁用的)
};
```

### 5.2 群聊激活策略

```javascript
const group_activation_strategy = {
    NATURAL: 0,  // 自然顺序 - 基于消息内容和提及
    LIST: 1,     // 列表顺序 - 按成员列表顺序
    MANUAL: 2,   // 手动模式 - 随机选择一个
    POOLED: 3    // 池化模式 - 基于最后消息
};
```

### 5.3 generateGroupWrapper 流程

```
1. 获取群组成员列表
2. 根据激活策略确定发言顺序
3. 循环处理每个激活的成员:
   a. 设置当前角色 ID 和名称
   b. 触发 GROUP_MEMBER_DRAFTED 事件
   c. 调用 Generate() 生成回复
   d. 处理自动继续 (auto-continue)
4. 触发 GROUP_WRAPPER_FINISHED 事件
```

### 5.4 群聊角色卡合并 (getGroupCharacterCards)

仅在 APPEND 或 APPEND_DISABLED 模式下生效：

```javascript
function getGroupCharacterCards(groupId, characterId) {
    return {
        description: collectField('Description', c => c.description),
        personality: collectField('Personality', c => c.personality),
        scenario: collectField('Scenario', c => c.scenario),
        mesExamples: collectField('Example Messages', c => c.mes_example)
    };
}
```

合并时支持自定义前缀/后缀：
- `generation_mode_join_prefix`
- `generation_mode_join_suffix`

### 5.5 群聊深度提示词 (getGroupDepthPrompts)

收集所有成员的深度提示词（SWAP 模式除外）：

```javascript
function getGroupDepthPrompts(groupId, characterId) {
    for (const member of group.members) {
        const depthPromptText = character.data?.extensions?.depth_prompt?.prompt;
        const depthPromptDepth = character.data?.extensions?.depth_prompt?.depth;
        const depthPromptRole = character.data?.extensions?.depth_prompt?.role;
        depthPrompts.push({ text, depth, role });
    }
    return depthPrompts;
}
```

---

## 6. World Info 系统

### 6.1 World Info 位置

```
worldInfoBefore: 在主提示词之前
worldInfoAfter:  在角色描述之后
WIDepthEntries:  按深度注入聊天历史
```

### 6.2 World Info 激活流程

```
1. checkWorldInfo() - 扫描聊天内容匹配条目
2. 按位置分类条目
3. 返回 { worldInfoBefore, worldInfoAfter, WIDepthEntries, ... }
```

---

## 7. Token 预算管理

### 7.1 预算计算

```javascript
tokenBudget = maxContext - maxTokens - 3  // 3 tokens for assistant priming
```

### 7.2 预算分配优先级

```
1. 系统提示词 (必须)
2. 控制提示词 (预留)
3. 工具调用数据 (预留)
4. 新聊天标记 (预留)
5. 群聊提示 (预留)
6. 聊天历史 (填充剩余)
7. 对话示例 (可选)
```

### 7.3 预算不足处理

```javascript
if (!chatCompletion.canAfford(message)) {
    break;  // 停止添加更多历史消息
}
```

---

## 8. 完整上下文结构示例

```
┌─────────────────────────────────────────┐
│ [System] World Info Before              │
├─────────────────────────────────────────┤
│ [System] Main System Prompt             │
├─────────────────────────────────────────┤
│ [System] World Info After               │
├─────────────────────────────────────────┤
│ [System] Character Description          │
├─────────────────────────────────────────┤
│ [System] Character Personality          │
├─────────────────────────────────────────┤
│ [System] Scenario                       │
├─────────────────────────────────────────┤
│ [System] Persona Description            │
├─────────────────────────────────────────┤
│ [System] NSFW Prompt                    │
├─────────────────────────────────────────┤
│ [System] Jailbreak Prompt               │
├─────────────────────────────────────────┤
│ [System] New Chat Marker                │
├─────────────────────────────────────────┤
│ [User] Message 1                        │
├─────────────────────────────────────────┤
│ [Assistant] Message 2                   │
├─────────────────────────────────────────┤
│ [System] Depth Injection @ 2            │
├─────────────────────────────────────────┤
│ [User] Message 3                        │
├─────────────────────────────────────────┤
│ [System] Depth Injection @ 1            │
├─────────────────────────────────────────┤
│ [Assistant] Message 4                   │
├─────────────────────────────────────────┤
│ [System] Author's Note @ 0              │
├─────────────────────────────────────────┤
│ [User] Message 5 (Latest)               │
├─────────────────────────────────────────┤
│ [System] Group Nudge (群聊)              │
└─────────────────────────────────────────┘
```

---

## 9. 关键代码文件

| 文件 | 功能 |
|------|------|
| `openai.js` | ChatCompletion 类、消息准备、上下文填充 |
| `PromptManager.js` | 提示词管理、排序、UI |
| `group-chats.js` | 群聊生成、成员管理、卡片合并 |
| `world-info.js` | World Info 激活和注入 |
| `authors-note.js` | 作者注释扩展 |
| `script.js` | 主生成流程、扩展提示词 |

---

## 10. 对 Note-Gen Tavern 模块的启示

### 10.1 需要实现的核心功能

1. **ChatCompletion 类** - Token 预算管理
2. **提示词排序系统** - 可配置的提示词顺序
3. **深度注入** - 按深度插入聊天历史
4. **群聊支持** - 多角色卡片合并和轮流发言

### 10.2 建议的实现优先级

1. P0: 基础上下文构建 (系统提示 + 角色卡 + 聊天历史)
2. P1: Author's Note 深度注入
3. P2: World Info 系统
4. P3: 群聊基础支持
5. P4: 完整的 Prompt Manager UI
