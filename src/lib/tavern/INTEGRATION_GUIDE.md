# ST 风格上下文系统集成指南

## 概述

本指南说明如何将新的 ST 风格上下文构建系统集成到 `chat-window.tsx` 中。

## 新增模块

### 1. ChatCompletion (`chat-completion.ts`)
Token 预算管理和消息组织类。

```typescript
import { ChatCompletion, createMessage, createCollection } from '@/lib/tavern'

const cc = new ChatCompletion()
cc.setTokenBudget(8192, 1024) // maxContext, maxResponse

// 添加消息集合
const systemCollection = createCollection('system', [
  createMessage('system', '你是一个助手', 'main')
])
cc.add(systemCollection)

// 深度注入
cc.addDepthInjection({
  role: 'system',
  content: '作者笔记内容',
  depth: 4,
  order: 100,
})

// 获取最终消息
const messages = cc.getChat()
```

### 2. ContextBuilderV2 (`context-builder-v2.ts`)
ST 风格的完整上下文构建器。

```typescript
import { ContextBuilderV2, buildContextV2 } from '@/lib/tavern'

// 方式 1: 使用类
const builder = new ContextBuilderV2(card, persona, {
  maxContext: 8192,
  maxResponse: 1024,
  includeExamples: true,
  includeWorldInfo: true,
  extensionPrompts: {
    '1_memory': { identifier: '1_memory', value: '摘要内容', position: 'before' },
    '2_floating_prompt': { identifier: '2_floating_prompt', value: '作者笔记', position: 'in_chat', depth: 4 },
  },
})
const result = await builder.build(messages, userInput)

// 方式 2: 使用快捷函数
const result = await buildContextV2(card, persona, messages, userInput, config)
```

### 3. GroupChatManager (`group-chat-v2.ts`)
ST 风格的群聊管理器。

```typescript
import { 
  createGroupChatManager, 
  GroupGenerationMode, 
  GroupActivationStrategy 
} from '@/lib/tavern'

const manager = await createGroupChatManager(groupId, {
  generationMode: GroupGenerationMode.Append,
  activationStrategy: GroupActivationStrategy.Natural,
})

// 选择下一个发言者
const speaker = manager.selectNextSpeaker(messages, lastSpeakerId)

// 构建群聊上下文
const result = await manager.buildContext(speaker, persona, messages, userInput)
```

### 4. ContextIntegration (`context-integration.ts`)
统一的上下文构建接口。

```typescript
import { buildUnifiedContext, shouldUseV2Builder } from '@/lib/tavern'

// 自动选择构建器
const useV2 = shouldUseV2Builder({
  hasWorldInfo: true,
  hasExtensions: true,
  needsTokenBudget: true,
})

// 统一构建
const result = await buildUnifiedContext(card, persona, messages, userInput, {
  useV2Builder: useV2,
  maxContext: 8192,
  maxResponse: 1024,
  authorsNote: authorsNoteConfig,
})
```

## 在 chat-window.tsx 中集成

### 步骤 1: 导入新模块

```typescript
import { 
  buildUnifiedContext, 
  shouldUseV2Builder,
  ContextBuildOptions,
} from '@/lib/tavern'
import { PromptManagerPanel } from './prompt-manager-panel'
```

### 步骤 2: 修改 handleSend 函数

```typescript
const handleSend = useCallback(async () => {
  // ... 保存用户消息 ...

  // 使用统一接口构建上下文
  const result = await buildUnifiedContext(
    card,
    persona,
    updatedMessages,
    userContent,
    {
      useV2Builder: true, // 或使用 shouldUseV2Builder() 自动判断
      maxContext: 8192,
      maxResponse: 1024,
      authorsNote: authorsNoteConfig,
    }
  )

  // 使用 result.messages 调用 AI
  await streamWithBackend(result.messages, ...)
}, [])
```

### 步骤 3: 添加 Prompt Manager UI

在头部工具栏添加:

```tsx
<PromptManagerPanel cardId={card.id} compact />
```

## 扩展提示词自动收集

`collectExtensionPrompts()` 会自动从以下 store 收集扩展提示词:

1. **Memory/Summary** - `useTavernMemoryStore`
2. **Author's Note** - `useTavernAuthorsNoteStore`  
3. **Vectors/RAG** - `useTavernVectorsStore`

这些会自动注入到上下文中，无需手动处理。

## 群聊集成

```typescript
import { createGroupChatManager, GroupGenerationMode } from '@/lib/tavern'

// 在群聊模式下
if (isGroupChat) {
  const manager = await createGroupChatManager(groupId, {
    generationMode: GroupGenerationMode.Append,
  })
  
  const speaker = manager.selectNextSpeaker(messages)
  const result = await manager.buildContext(speaker, persona, messages, userInput)
  
  // 使用 result.messages
}
```

## 迁移建议

1. **渐进式迁移**: 先在新功能中使用 V2，旧代码保持 V1
2. **使用 `shouldUseV2Builder()`**: 根据功能需求自动选择
3. **测试**: 对比 V1 和 V2 的输出确保一致性
4. **监控 Token 使用**: V2 提供更精确的 token 预算管理
