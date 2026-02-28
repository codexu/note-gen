# Skills 运行时逻辑修复开发计划

## 背景

当前 NoteGen 的 Skills 功能存在多个运行时逻辑问题，主要集中在脚本执行、路径解析、错误处理等方面。本计划旨在修复这些问题，提升系统的稳定性和可靠性。

---

## 问题分析

### 问题 1: 路径解析重复且不一致

**位置**:
- `src/lib/skills/executor.ts:281-322`
- `src/lib/agent/tools/system-tools.ts:386-399`

**问题描述**:
两处代码各自实现了一套路径解析逻辑，处理方式不同：
- `executor.ts` 使用 `getFilePathOptions` 获取 baseDir
- `system-tools.ts` 使用 `getFilePathOptions` 再拼接 `appDataDir`

对于 `project scope` 的 skill，解析结果可能不一致。

**影响**:
- project scope 的 skill 脚本可能无法正确执行
- 维护困难，容易引入新的不一致

---

### 问题 2: project scope 路径解析错误

**位置**: `src/lib/skills/executor.ts:293-301`

**问题代码**:
```typescript
if (skill.metadata.scope === 'global') {
  workingDirectory = `${appDataPath}/${fileInfo.directory}`
} else {
  const options = await getFilePathOptions(fileInfo.directory)
  if (options.baseDir) {
    const appDataPath = await appDataDir()
    workingDirectory = `${appDataPath}/${options.path}`  // 错误拼接
  }
}
```

**问题分析**:
- `fileInfo.directory` 对于 project scope 可能是 `skills/pdf`
- `getFilePathOptions('skills/pdf')` 返回 `{ path: 'article/skills/pdf', baseDir: BaseDirectory.AppData }`
- 再拼接 `appDataPath` 会变成错误的路径

**影响**:
- project scope 的脚本执行路径错误

---

### 问题 3: executor.ts 的 executeScript 方法是死代码

**位置**: `src/lib/skills/executor.ts:201-243`

**问题描述**:
`executeScript` 方法从未被调用，实际使用的是 `execute_skill_script` 工具。

**建议**:
- 删除死代码，或
- 统一脚本执行入口，让 executor.ts 成为唯一的执行模块

---

### 问题 4: 脚本参数处理问题

**位置**:
- `src/lib/skills/executor.ts:313`
- `src/lib/agent/tools/system-tools.ts:436`

**问题代码**:
```typescript
const shellCommand = `cd "${workingDirectory}" && ${command} "${relativeScriptPath}" ${...}`
```

**问题**:
- 路径中的空格没有正确转义
- 复杂参数（如包含引号、空格）会出错

---

### 问题 5: 缺少依赖安装支持

**问题描述**:
脚本执行没有检查/安装依赖（如 `pip install xxx`），如果脚本需要外部库会直接失败。

**建议**:
- 支持在 SKILL.md 中声明依赖
- 自动检测并安装依赖

---

### 问题 6: 脚本路径正则匹配脆弱

**位置**: `src/lib/skills/executor.ts:310`

**问题代码**:
```typescript
const relativeScriptPath = script.path.replace(new RegExp(`^skills/${skillBaseName}/`), '')
```

**问题**:
- 如果 skill 目录结构不是以 `skills/` 开头，正则会失效
- 对于不同 scope 的 skill，可能有不同前缀

---

### 问题 7: 没有执行超时控制

**问题描述**:
脚本执行没有设置超时，可能导致长时间挂起。

**建议**:
- 添加超时配置
- 支持在 SKILL.md 中声明超时时间

---

### 问题 8: 初始化竞态条件

**位置**: `src/stores/skills.ts:60-86`

**问题代码**:
```typescript
set({ initialized: true })  // 先设置已初始化
await skillManager.initialize()  // 后面才初始化
```

**问题**:
- 如果 `initialize()` 失败，状态显示已初始化但实际未初始化
- 后续调用会直接跳过初始化

---

### 问题 9: 每次对话都重新加载 Skills

**位置**: `src/lib/agent/agent-handler.ts:229`

**问题代码**:
```typescript
await skillsStore.refreshSkills()  // 每次都重新扫描目录
```

**问题**:
- 每次对话开始都重新扫描文件系统
- 性能问题，特别是 skill 数量多的时候

---

### 问题 10: executor.ts 中 fileInfo 为空时静默失败

**位置**: `src/lib/skills/executor.ts:284-321`

**问题代码**:
```typescript
if (fileInfo) {
  // 执行脚本
}
return { output: '', exitCode: 0 }  // 没有返回错误信息
```

**问题**:
- 当 fileInfo 为空时，静默返回成功
- 调用方无法知道执行失败

---

### 问题 11: stdout/stderr 处理可能丢失数据

**位置**: `src/lib/agent/tools/system-tools.ts:455-456`

**问题代码**:
```typescript
const stdout = stdoutChunks.join('') || r.stdout || ''
const stderr = stdoutChunks.join('') || r.stderr || ''
```

**问题**:
- 如果使用了流式回调，`r.stdout/r.stderr` 可能是空的
- 应该优先使用流式数据，或两者都收集

---

### 问题 12: 缺少日志记录

**问题描述**:
- 脚本执行没有详细的执行日志
- 难以调试问题
- 没有执行历史记录

---

## 修复方案

### 方案 A: 最小改动方案（推荐）

**目标**: 修复核心问题，最小化代码改动

| 优先级 | 问题 | 修复方案 |
|--------|------|----------|
| P0 | 路径解析不一致 | 提取统一路径解析函数 |
| P0 | project scope 路径错误 | 修复路径拼接逻辑 |
| P0 | fileInfo 为空静默失败 | 返回明确错误信息 |
| P1 | stdout/stderr 处理 | 合并流式和返回值 |
| P1 | 参数处理 | 添加参数转义 |
| P2 | 初始化竞态 | 调整初始化顺序 |
| P2 | 每次重新加载 | 改为增量更新 |
| P3 | 超时控制 | 添加超时参数 |

### 方案 B: 完整重构方案

**目标**: 重构脚本执行模块，提供完整解决方案

| 功能 | 实现 |
|------|------|
| 统一路径解析 | 创建 `skills-utils.ts` |
| 依赖管理 | 支持 pip/npm 依赖自动安装 |
| 执行超时 | 添加超时配置 |
| 执行日志 | 完整的执行记录 |
| 调试工具 | 提供测试接口 |

---

## 开发任务

### Phase 1: 核心修复（紧急）

#### Task 1.1: 统一路径解析函数
- 创建 `src/lib/skills/path-utils.ts`
- 提取 `resolveSkillDirectory()` 函数
- 修复 executor.ts 和 system-tools.ts 使用统一函数

#### Task 1.2: 修复 project scope 路径
- 修正 `executor.ts:293-301` 的路径拼接逻辑
- 确保 custom workspace 和默认 workspace 都能正确处理

#### Task 1.3: 修复静默失败
- `executor.ts` 中 fileInfo 为空时返回错误
- 添加统一的错误处理

### Phase 2: 脚本执行改进

#### Task 2.1: 修复 stdout/stderr 处理
- 合并流式数据和返回值
- 确保完整捕获输出

#### Task 2.2: 参数处理
- 添加 shell 参数转义
- 处理包含空格和特殊字符的路径

#### Task 2.3: 添加超时控制
- 添加默认超时时间
- 支持在工具调用时指定超时

### Phase 3: 初始化和加载优化

#### Task 3.1: 修复初始化竞态
- 调整初始化顺序
- 添加失败重试机制

#### Task 3.2: 优化加载逻辑
- 改为增量更新
- 添加缓存机制

### Phase 4: 增强功能（可选）

#### Task 4.1: 依赖管理
- 支持声明依赖
- 自动安装依赖

#### Task 4.2: 执行日志
- 完整的执行记录
- 日志查看界面

---

## 验收标准

1. **路径解析**: project scope 和 global scope 的脚本都能正确执行
2. **错误处理**: 所有失败场景都返回明确错误信息
3. **参数处理**: 包含空格的路径能正确处理
4. **初始化**: 不再出现竞态条件导致的静默失败
5. **性能**: 多次对话不重复扫描文件系统

---

## 相关文件清单

### 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/lib/skills/path-utils.ts` | 新建 - 统一路径解析 |
| `src/lib/skills/executor.ts` | 修复路径逻辑、错误处理 |
| `src/lib/agent/tools/system-tools.ts` | 使用统一路径函数 |
| `src/stores/skills.ts` | 修复初始化逻辑 |
| `src/lib/agent/agent-handler.ts` | 优化加载逻辑 |

### 需要测试的场景

1. global scope skill 的脚本执行
2. project scope skill 的脚本执行（默认 workspace）
3. project scope skill 的脚本执行（自定义 workspace）
4. 包含空格的路径参数
5. 脚本执行超时
6. 脚本执行失败场景
