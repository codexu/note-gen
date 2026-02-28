# 编辑器与Agent交互及同步功能优化实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复编辑器与Agent交互中的严重Bug，改进同步功能的SHA比较和冲突处理

**Architecture:** 采用渐进式修复策略，第一阶段修复编辑器/Agent交互中的严重Bug（行号定位、内容竞态），第二阶段改进同步功能

**Tech Stack:** TypeScript, ProseMirror (TipTap), Tauri, SQLite

---

## 阶段一：编辑器与Agent交互修复

### Task 1: 修复行号定位计算错误

**Files:**
- Modify: `src/app/core/main/editor/markdown/tiptap-editor.tsx:1074-1080`

**Step 1: 理解当前错误代码**

当前使用 `doc.resolve(startLine - 1)` 是错误的，ProseMirror 的 resolve 方法接受绝对位置而非行号。

**Step 2: 实现正确的行号转位置函数**

```typescript
// 在 tiptap-editor.tsx 中添加辅助函数
function lineToPosition(doc: ProseMirrorNode, line: number): number {
  let pos = 0
  let currentLine = 1

  doc.descendants((node, nodePos) => {
    if (currentLine >= line) return false

    if (node.isText && node.text) {
      const lineBreaks = node.text.split('\n').length - 1
      if (currentLine + lineBreaks >= line) {
        // 目标行在这个节点内
        const targetInNode = line - currentLine
        const textBeforeTarget = node.text.split('\n').slice(0, targetInNode).join('\n')
        pos = nodePos + textBeforeTarget.length
        return false
      }
      currentLine += lineBreaks
    } else if (!node.isInline) {
      // 块级节点也占一行
      currentLine++
    }
    return true
  })

  return pos
}
```

**Step 3: 替换错误的定位逻辑**

在 `handleReplace` 函数中，将 `doc.resolve(startLine - 1)` 替换为 `lineToPosition(doc, startLine)` 和 `lineToPosition(doc, endLine + 1)`。

**Step 4: Commit**

```bash
git add src/app/core/main/editor/markdown/tiptap-editor.tsx
git commit -m "fix: 修复行号定位计算错误"
```

---

### Task 2: 添加内容版本号机制解决竞态条件

**Files:**
- Modify: `src/app/core/main/editor/markdown/tiptap-editor.tsx:900-950`
- Modify: `src/lib/agent/tools/editor-tools.ts:60-80`

**Step 1: 在编辑器中添加版本号**

在 tiptap-editor.tsx 中添加 `contentVersionRef` 来追踪内容版本：

```typescript
const contentVersionRef = useRef(0)

// 获取内容时返回版本号
const handleGetContent = ({ resolve }) => {
  if (!editor) {
    resolve({ text: '', version: contentVersionRef.current, from: 0, to: 0, startLine: 1, endLine: 1 })
    return
  }

  // ... 现有逻辑 ...
  resolve({
    text: content,
    version: contentVersionRef.current,  // 返回版本号
    from,
    to,
    startLine,
    endLine
  })
}

// 内容变化时递增版本号
useEffect(() => {
  const handleChange = () => {
    contentVersionRef.current++
  }
  editor.on('update', handleChange)
  return () => editor.off('update', handleChange)
}, [editor])
```

**Step 2: 修改编辑器工具添加版本验证**

在 editor-tools.ts 中，get_editor_content 返回版本号，replace 时验证版本号：

```typescript
// 修改 replace_editor_content 工具
const replace_editor_content: Tool = {
  name: 'replace_editor_content',
  description: 'Replace content in editor by line numbers',
  parameters: {
    type: 'object',
    properties: {
      startLine: { type: 'number', description: 'Start line number (1-based)' },
      endLine: { type: 'number', description: 'End line number (1-based)' },
      newContent: { type: 'string', description: 'New content to replace' },
      version: { type: 'number', description: 'Version number from get_editor_content' }
    },
    required: ['startLine', 'endLine', 'newContent', 'version']
  },
  execute: async (args): Promise<ToolResult> => {
    return new Promise((resolve) => {
      emitter.emit('editor-replace', {
        startLine: args.startLine,
        endLine: args.endLine,
        newContent: args.newContent,
        expectedVersion: args.version,  // 验证版本号
        resolve: (result) => {
          if (result.versionMismatch) {
            resolve({ success: false, error: 'Content has changed, please get editor content again' })
          } else {
            resolve(result)
          }
        }
      })
    })
  }
}
```

**Step 3: 修改 handleReplace 验证版本号**

```typescript
const handleReplace = ({ startLine, endLine, newContent, expectedVersion, resolve }) => {
  if (!editor) {
    resolve({ success: false, error: 'Editor not initialized' })
    return
  }

  // 验证版本号
  if (expectedVersion !== undefined && expectedVersion !== contentVersionRef.current) {
    resolve({ success: false, versionMismatch: true })
    return
  }

  // ... 现有替换逻辑 ...

  // 替换成功后递增版本号
  contentVersionRef.current++
}
```

**Step 4: Commit**

```bash
git add src/app/core/main/editor/markdown/tiptap-editor.tsx src/lib/agent/tools/editor-tools.ts
git commit -m "fix: 添加内容版本号机制解决竞态条件"
```

---

### Task 3: 修复 searchContent 格式不匹配

**Files:**
- Modify: `src/app/core/main/editor/markdown/tiptap-editor.tsx:1024-1072`

**Step 1: 使用 ProseMirror 内部文本搜索**

将 `editor.getMarkdown()` 改为使用 `editor.state.doc.textContent`：

```typescript
// Mode 2: Text-based search
else if (searchContent) {
  const doc = editor.state.doc
  const content = doc.textContent  // 使用纯文本而非 Markdown
  // ... 搜索逻辑保持不变，但比较时使用纯文本 ...
}
```

**Step 4: Commit**

```bash
git add src/app/core/main/editor/markdown/tiptap-editor.tsx
git commit -m "fix: 修复searchContent使用Markdown格式搜索的问题"
```

---

### Task 4: 修复插入后光标位置计算

**Files:**
- Modify: `src/app/core/main/editor/markdown/tiptap-editor.tsx:960-990`

**Step 1: 使用事务完成后的光标位置**

```typescript
const handleInsert = ({ content, resolve }) => {
  const { from } = editor.state.selection

  setTimeout(() => {
    const tr = editor.state.tr.insertContent(content, { contentType: 'markdown' })
    editor.dispatch(tr)

    // 使用事务后的实际光标位置
    const newPosition = editor.state.selection.from

    resolve({
      success: true,
      insertedLength: content.length,
      newCursorPosition: newPosition,
    })
  }, 0)
}
```

**Step 2: Commit**

```bash
git add src/app/core/main/editor/markdown/tiptap-editor.tsx
git commit -m "fix: 修复插入后光标位置计算错误"
```

---

## 阶段二：同步功能修复

### Task 5: 改进SHA比较逻辑

**Files:**
- Modify: `src/lib/sync/auto-sync.ts:186-291`

**Step 1: 记录每次同步的commit SHA**

在本地存储中保存每个文件的最近同步SHA：

```typescript
// 添加辅助函数
async function getLocalFileSha(filePath: string): Promise<string | null> {
  const localShas = await store.get<Record<string, string>>('syncedFileShas') || {}
  return localShas[filePath] || null
}

async function setLocalFileSha(filePath: string, sha: string): Promise<void> {
  const localShas = await store.get<Record<string, string>>('syncedFileShas') || {}
  localShas[filePath] = sha
  await store.set('syncedFileShas', localShas)
}
```

**Step 2: 修改版本比较逻辑**

```typescript
// 在 compareFileVersions 中
const localSha = await getLocalFileSha(path)
const remoteSha = remoteFile.sha

if (localSha && localSha !== remoteSha) {
  // SHA 不一致，触发冲突处理
  return { hasConflict: true, ... }
}

// 更新本地记录的 SHA
await setLocalFileSha(path, remoteSha)
```

**Step 3: Commit**

```bash
git add src/lib/sync/auto-sync.ts
git commit -m "fix: 改进SHA比较逻辑，使用commit SHA而非修改时间"
```

---

### Task 6: 改进冲突处理策略

**Files:**
- Modify: `src/lib/sync/conflict-resolution.ts:163-184`

**Step 1: 添加三种冲突解决策略**

```typescript
export type ConflictResolutionStrategy = 'local' | 'remote' | 'manual'

export async function resolveConflict(
  filePath: string,
  localContent: string,
  remoteContent: string,
  strategy: ConflictResolutionStrategy
): Promise<string> {
  switch (strategy) {
    case 'local':
      return localContent
    case 'remote':
      return remoteContent
    case 'manual':
      // 返回 null 表示需要用户手动处理
      return await promptUserForManualMerge(filePath, localContent, remoteContent)
  }
}
```

**Step 2: 修改冲突检测流程**

```typescript
async function detectAndResolveConflict(
  filePath: string,
  localContent: string,
  remoteContent: string,
  autoResolve: boolean = false
): Promise<{ content: string; resolved: boolean; strategy?: ConflictResolutionStrategy }> {
  const conflictType = analyzeConflictType(localContent, remoteContent)

  if (conflictType === 'simple_addition' && autoResolve) {
    return { content: remoteContent, resolved: true, strategy: 'remote' }
  }

  if (conflictType === 'no_conflict') {
    return { content: remoteContent, resolved: true }
  }

  // 需要用户决策
  return { content: localContent, resolved: false }
}
```

**Step 3: Commit**

```bash
git add src/lib/sync/conflict-resolution.ts
git commit -m "fix: 改进冲突处理策略，支持保留本地/远程/手动合并"
```

---

### Task 7: 改进网络检测

**Files:**
- Modify: `src/lib/sync/auto-sync.ts:664-689`

**Step 1: 实现真正的网络检测**

```typescript
export async function hasNetworkConnection(config: SyncConfig): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒超时

    const baseUrl = getBaseUrl(config)
    const response = await fetch(`${baseUrl}/user`, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${config.token}`
      }
    })

    clearTimeout(timeoutId)
    return response.ok
  } catch (error) {
    console.error('Network check failed:', error)
    return false
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/sync/auto-sync.ts
git commit -m "fix: 实现真正的网络连接检测"
```

---

### Task 8: 修复GitLab/Gitea硬编码分支

**Files:**
- Modify: `src/lib/sync/auto-sync.ts:227-234`
- Modify: `src/lib/sync/sync-push-queue.ts:291-319`

**Step 1: 从配置读取分支**

```typescript
case 'gitlab': {
  const branch = config.branch || 'main'  // 从配置读取，默认 main
  const gitlabFile = await getGitlabFile({ path, ref: branch, repo })
  // ...
}
case 'gitea': {
  const branch = config.branch || 'main'
  const giteaFile = await getGiteaFile({ path, ref: branch, repo })
  // ...
}
```

**Step 2: Commit**

```bash
git add src/lib/sync/auto-sync.ts src/lib/sync/sync-push-queue.ts
git commit -m "fix: 支持GitLab/Gitea自定义分支配置"
```

---

## 阶段三：其他问题修复

### Task 9: 修复聊天竞态条件

**Files:**
- Modify: `src/stores/chat.ts:109-161`

**Step 1: 使用版本号防止重复处理**

```typescript
const maybeCondense = async (conversationId: string) => {
  const versionRef = { current: 0 }

  const doCondense = async () => {
    const currentVersion = ++versionRef.current

    // 检查是否被其他调用覆盖
    if (currentVersion !== versionRef.current) {
      return // 已被新版本覆盖，跳过
    }

    const chats = await getChatsByConversation(conversationId)
    // ... 压缩逻辑 ...
  }

  doCondense()
}
```

**Step 2: Commit**

```bash
git add src/stores/chat.ts
git commit -m "fix: 修复聊天压缩竞态条件"
```

---

### Task 10: 修复录音计时器

**Files:**
- Modify: `src/stores/recording.ts:83-90`

**Step 1: 保存timerId**

```typescript
const timerIdRef = useRef<NodeJS.Timeout | null>(null)

const startTimer = () => {
  timerIdRef.current = setInterval(() => {
    setRecordingTime(t => t + 1)
  }, 1000)
}

const pauseRecording = () => {
  if (timerIdRef.current) {
    clearInterval(timerIdRef.current)
    timerIdRef.current = null
  }
  // ... 现有逻辑 ...
}
```

**Step 2: Commit**

```bash
git add src/stores/recording.ts
git commit -m "fix: 修复录音计时器未正确清理的问题"
```

---

### Task 11: 数据库批量插入添加事务

**Files:**
- Modify: `src/db/chats.ts:202-209`

**Step 1: 使用事务处理批量插入**

```typescript
async function insertChats(chats: Chat[]): Promise<void> {
  const db = await getDb()

  await db.exec('BEGIN TRANSACTION')
  try {
    for (const chat of chats) {
      await db.execute(
        'INSERT INTO chats (id, role, content, conversationId, createdAt) VALUES (?, ?, ?, ?, ?)',
        [chat.id, chat.role, chat.content, chat.conversationId, chat.createdAt]
      )
    }
    await db.exec('COMMIT')
  } catch (error) {
    await db.exec('ROLLBACK')
    throw error
  }
}
```

**Step 2: Commit**

```bash
git add src/db/chats.ts
git commit -m "fix: 数据库批量插入添加事务处理"
```

---

### Task 12: MCP JSON解析错误处理

**Files:**
- Modify: `src/lib/ai/chat.ts:243`

**Step 1: 增加错误处理**

```typescript
let toolArgs = {}
try {
  toolArgs = JSON.parse(toolCall.function.arguments)
} catch (error) {
  return {
    success: false,
    error: `Invalid JSON in tool arguments: ${error.message}`
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/ai/chat.ts
git commit -m "fix: MCP工具参数JSON解析增加错误处理"
```

---

## 测试计划

### 编辑器与Agent交互测试
1. 创建测试文件，调用行号替换验证位置正确性
2. 快速连续调用 get_content 和 replace 验证版本号机制
3. 测试特殊内容（公式、代码块）操作

### 同步功能测试
1. 模拟并发修改，验证冲突检测
2. 模拟网络超时，验证错误处理
3. 测试不同分支配置

---

## 执行顺序

1. Task 1-4: 编辑器与Agent交互修复（严重Bug）
2. Task 5-8: 同步功能修复
3. Task 9-12: 其他问题修复
