# 编辑器与Agent交互及同步功能优化设计

**日期**: 2026-02-28
**分支**: feat/editor-agent-optimization
**状态**: 已批准

## 一、目标

优化 NoteGen 编辑器与 Agent 之间的交互，修复同步功能的潜在 bug，提升用户体验和数据安全性。

---

## 二、需要修复的问题

### 2.1 同步功能 (Push/Pull)

| 问题 | 严重程度 | 描述 |
|------|----------|------|
| SHA比较不可靠 | 高 | 使用修改时间比较而非Git SHA，可能导致数据覆盖 |
| 冲突处理过于简单 | 高 | 自动合并策略太弱，可能丢失用户修改 |
| 网络检测形同虚设 | 中 | 只检查token是否存在，没有真正检测网络 |
| 文件删除不同步 | 中 | 本地删除不会同步到远程 |
| 硬编码main分支 | 低 | GitLab/Gitea不支持自定义分支 |
| 文件锁机制有缺陷 | 中 | 锁存在本地，多设备无法感知 |

### 2.2 编辑器与Agent交互

| 问题 | 严重程度 | 描述 |
|------|----------|------|
| 行号定位计算错误 | 严重 | `doc.resolve(startLine - 1)` 使用错误，导致替换位置完全错误 |
| 内容获取竞态条件 | 严重 | get_content 和 replace 之间无锁定，可能替换错误内容 |
| searchContent格式不匹配 | 中 | Markdown格式搜索与ProseMirror内部表示不一致 |
| 插入后光标位置计算错误 | 中 | 简单使用 `from + content.length` |
| 快速连续操作无队列 | 中 | 无操作队列，可能产生竞态 |
| 特殊内容处理不完善 | 中 | 公式、图表、Mermaid等可能操作失败 |
| 远程同步与Agent操作冲突 | 中 | 同步更新可能覆盖Agent修改 |

### 2.3 其他问题

| 问题 | 严重程度 | 描述 |
|------|----------|------|
| 聊天竞态条件 | 中 | maybeCondense异步任务可能导致状态不一致 |
| 录音计时器 | 低 | pause时无法清除计时器 |
| 数据库批量插入 | 中 | 中途失败无法回滚 |
| MCP JSON解析 | 中 | 参数错误会导致工具调用直接失败 |

---

## 三、解决方案

### 3.1 同步功能修复

#### 3.1.1 SHA比较改进
- 每次同步时记录远程文件的 commit SHA
- 拉取时比较本地记录的 SHA 与远程 SHA
- 如不一致，触发冲突检测流程

#### 3.1.2 冲突处理改进
- 提供三种冲突解决策略：
  1. 保留本地版本
  2. 保留远程版本
  3. 手动合并（三路合并视图）
- 冲突时暂停自动同步，等待用户决策

#### 3.1.3 网络检测改进
- 实现真正的网络检测：发送 HEAD 请求到 API 端点
- 添加请求超时（10秒）
- 超时后提示用户检查网络

#### 3.1.4 文件删除同步
- 本地删除文件时，push 前检测并删除远程对应文件
- 拉取时检测远程已删除的文件，提示用户处理

#### 3.1.5 分支配置
- 从同步配置中读取分支名称
- 支持 GitLab/Gitea 自定义分支

### 3.2 编辑器与Agent交互修复

#### 3.2.1 行号定位修复
```typescript
// 错误用法
const startPos = doc.resolve(startLine - 1)

// 正确用法：计算行号对应的文档位置
function lineToPosition(doc: ProseMirrorNode, line: number): number {
  let pos = 0
  let currentLine = 1
  doc.descendants((node, nodePos) => {
    if (currentLine >= line) return false
    if (node.isText) {
      const lineBreaks = (node.text || '').split('\n').length - 1
      currentLine += lineBreaks
      if (currentLine >= line) {
        const targetInNode = line - (currentLine - lineBreaks)
        pos = nodePos + targetInNode - 1
        return false
      }
    }
    return true
  })
  return pos
}
```

#### 3.2.2 内容竞态条件修复 - 版本号机制
- 获取编辑器内容时，返回内容 + 版本号
- 替换内容时，验证版本号是否变化
- 如版本号变化，返回错误并提示 Agent 重新获取内容

```typescript
// 获取内容时返回版本号
emitter.emit('editor-get-content', {
  resolve: (data) => {
    resolve({
      text: data.text,
      version: data.version,  // 新增
      ...
    })
  }
})

// 替换内容时验证版本号
emitter.emit('editor-replace', {
  version: currentVersion,  // 验证版本号
  ...
})
```

#### 3.2.3 searchContent 修复
- 使用 `editor.state.doc.textContent` 进行搜索
- 获取位置时使用相同的文本内容

#### 3.2.4 插入光标位置修复
- 使用 ProseMirror 事务完成后的光标位置
- 通过 `editor.state.selection` 获取实际位置

#### 3.2.5 远程同步与Agent操作冲突
- 同步更新内容前，检查 Agent 是否正在操作
- 如正在操作，延迟同步或提示用户

### 3.3 其他修复

#### 3.3.1 聊天竞态条件
- 使用锁机制确保 maybeCondense 原子性执行
- 添加版本号防止重复处理

#### 3.3.2 录音计时器
- 保存 timerId 到 ref
- pause 时正确清理计时器

#### 3.3.3 数据库批量插入
- 使用事务处理批量插入
- 失败时自动回滚

#### 3.3.4 MCP JSON解析
- 增加 try-catch 错误处理
- 解析失败时返回友好的错误信息

---

## 四、影响范围

### 4.1 需要修改的文件

#### 同步功能
- `src/lib/sync/sync-manager.ts`
- `src/lib/sync/auto-sync.ts`
- `src/lib/sync/conflict-resolution.ts`
- `src/lib/sync/sync-push-queue.ts`
- `src/lib/sync/github.ts`
- `src/lib/sync/gitlab.ts`
- `src/lib/sync/gitee.ts`
- `src/lib/sync/gitea.ts`

#### 编辑器与Agent交互
- `src/app/core/main/editor/markdown/tiptap-editor.tsx`
- `src/lib/agent/tools/editor-tools.ts`
- `src/lib/agent/react.ts`

#### 其他
- `src/stores/chat.ts`
- `src/stores/recording.ts`
- `src/db/chats.ts`
- `src/lib/ai/chat.ts`

---

## 五、测试计划

### 5.1 同步功能测试
1. 模拟并发修改，验证冲突检测
2. 模拟网络超时，验证错误处理
3. 测试文件删除同步

### 5.2 编辑器与Agent交互测试
1. 使用行号替换内容，验证位置正确性
2. 快速连续操作，验证无竞态条件
3. 特殊内容（公式、代码块）操作测试

---

## 六、风险评估

| 风险 | 缓解措施 |
|------|----------|
| 修改同步逻辑可能引入新bug | 先在开发环境充分测试 |
| 版本号机制可能影响性能 | 使用简单的计数器而非hash |
| 冲突处理UI可能复杂 | 提供简单默认选项 |
