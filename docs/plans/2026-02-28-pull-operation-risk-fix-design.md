# Pull 操作风险修复设计方案

****: 2026日期-02-28
**状态**: 已批准
**目标**: 修复编辑器 pull 操作的数据安全风险

---

## 背景

当前 pull 操作存在以下风险：

1. **本地编辑未保存丢失** (P0): 自动拉取在用户停止输入 10 秒后触发，直接覆盖编辑器内容，用户未保存的编辑会丢失
2. **冲突解决选项单一** (P1): 冲突时只有"覆盖本地"或"忽略"两个选项，没有对比视图
3. **网络异常无提示**: 网络错误只打印 console，用户无感知
4. **编辑器状态丢失**: 拉取后 undo/redo 历史被清空

---

## 方案：智能状态检测 + 冲突对比视图

### 核心策略

1. **用户状态检测**: 检测编辑器是否活跃（正在编辑、有选区、最近有输入）
2. **智能延迟拉取**: 用户活跃时延迟拉取，活跃结束后增加等待时间
3. **静默检测 + 明确拉取**: 检测到更新时只提示用户，由用户决定何时拉取
4. **冲突对比视图**: 提供左右 diff 视图，支持选择性合并

### 改动范围

约 4-5 个文件：
- `src/app/core/main/editor/markdown/sync/pull-button.tsx` - 主逻辑
- `src/app/core/main/editor/markdown/sync/conflict-dialog.tsx` - 新增
- `src/lib/sync/auto-sync.ts` - 增加检测函数
- `src/hooks/use-editor-state.ts` - 新增编辑器状态 hook

---

## 详细设计

### 1. 用户状态检测

新增 `useEditorState` hook:

```typescript
interface EditorState {
  isActive: boolean      // 编辑器是否有焦点
  hasSelection: boolean  // 是否有选中文本
  lastInputTime: number  // 最后输入时间
  hasUnsavedChanges: boolean  // 是否有未保存更改（基于 dirty state）
}

function useEditorState(editor: Editor): EditorState
```

修改自动拉取触发逻辑：

```typescript
// 当检测到用户正在编辑时，延迟拉取
const shouldDelayPull = (editorState: EditorState) => {
  const timeSinceInput = Date.now() - editorState.lastInputTime
  return timeSinceInput < 3000  // 3 秒内有输入则延迟
}
```

### 2. 静默检测 + 明确拉取

将"检测到更新"和"执行拉取"分离：

```typescript
// 状态机
type PullState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'update-available', remoteContent: string }
  | { status: 'pulling' }
  | { status: 'conflict', localContent: string, remoteContent: string }
  | { status: 'error', message: string }
```

- `update-available`: 只显示小红点 badge，不自动拉取
- 用户点击按钮后才执行拉取
- 冲突状态打开对比视图

### 3. 冲突对比视图

新增 `ConflictDialog` 组件：

```typescript
interface ConflictDialogProps {
  localContent: string
  remoteContent: string
  onResolve: (choice: 'local' | 'remote' | 'merged', content?: string) => void
  onCancel: () => void
}
```

功能：
- 左右分栏 diff 视图
- 高亮显示差异部分
- 三个按钮："保留本地"、"保留远程"、"取消"
- 未来可扩展：逐块选择、手动编辑

### 4. 错误处理增强

```typescript
// 错误类型
type SyncErrorType =
  | 'NETWORK_OFFLINE'   // 静默
  | 'AUTH_FAILED'       // 提示重新认证
  | 'SERVER_ERROR'      // 可重试
  | 'FILE_NOT_FOUND'    // 提示

// toast 提示
function showSyncError(type: SyncErrorType, message: string)
```

---

## 实施步骤

### Phase 1: 用户状态检测 + 智能延迟

1. 新增 `useEditorState` hook
2. 修改 `PullButton` 中的 `autoPull` 逻辑
3. 添加"正在编辑，延迟拉取"的状态提示

### Phase 2: 静默检测 + 状态分离

1. 分离"检测"和"拉取"逻辑
2. 实现状态机
3. 添加更新可用时的 badge 提示

### Phase 3: 冲突对比视图

1. 新增 `ConflictDialog` 组件
2. 使用 diff 库实现高亮
3. 集成到 pull 流程

### Phase 4: 错误处理

1. 错误分类和 toast 提示
2. 重试机制（可选）

---

## 验收标准

1. ✅ 用户正在编辑时，自动拉取不会覆盖内容
2. ✅ 检测到更新时，显示提示而非直接覆盖
3. ✅ 冲突时提供对比视图，用户可选择保留哪边
4. ✅ 网络异常时有用户友好的错误提示
5. ✅ 拉取后保留基本的编辑器状态（光标位置）

---

## 风险与限制

1. **时间戳比较问题** 未完全解决（需要更大改动）
2. **三向合并** 未实现（未来可扩展）
3. **版本历史** 未实现（需要额外存储）

---

## 依赖

- `diff` 库 - 用于文本差异对比
- 现有 `Editor` API - 状态检测
