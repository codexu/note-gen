# Agent Confirmation Display Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw Agent tool names in confirmation UI with localized, human-readable action summaries plus localized parameter labels and previews.

**Architecture:** Add a confirmation-display registry that maps tool names to localized display metadata and summary rules, then have the confirmation UI render from that registry instead of raw tool identifiers. Keep diff rendering for content edits, and fall back to formatted parameter previews for tools without diffs.

**Tech Stack:** TypeScript, Zustand, Next.js, `next-intl`, existing Agent UI components

---

## File Map

- Create: `src/lib/agent/tool-confirmation-display.ts`
  Purpose: static confirmation display registry, parameter formatting helpers, fallback display helpers.
- Modify: `src/components/ui/agent-plan.tsx`
  Purpose: replace raw tool/param rendering with display registry output and localized labels.
- Modify: `src/app/core/main/chat/agent-panel-with-rag.tsx`
  Purpose: pass richer confirmation props without shape loss.
- Modify: `src/app/core/main/chat/agent-execution-status.tsx`
  Purpose: keep confirmation callbacks compatible with the updated display shape.
- Modify: `src/lib/agent/types.ts`
  Purpose: add typed confirmation display payload if needed by the UI.
- Modify: `messages/zh.json`
  Purpose: Chinese tool titles, descriptions, parameter labels, fallback labels.
- Modify: `messages/en.json`
  Purpose: English tool titles, descriptions, parameter labels, fallback labels.
- Test: `src/lib/agent/tool-confirmation-display.test.mjs`
  Purpose: cover summary generation, parameter labeling, and fallback behavior.

## Chunk 1: Confirmation Display Registry

### Task 1: Add failing tests for display metadata lookup

**Files:**
- Create: `src/lib/agent/tool-confirmation-display.test.mjs`
- Modify: `src/lib/agent/tool-confirmation-display.ts`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getToolConfirmationDisplay,
} from './tool-confirmation-display.ts'

test('create_file resolves a human-readable display config', () => {
  const config = getToolConfirmationDisplay('create_file')

  assert.equal(config.titleKey, 'record.chat.input.agent.confirmation.tools.create_file.title')
  assert.deepEqual(config.summaryFields, ['filePath', 'content'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: FAIL because `tool-confirmation-display.ts` does not exist or does not export the helper.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ToolConfirmationDisplayConfig {
  titleKey: string
  descriptionKey: string
  summaryFields?: string[]
  contentFields?: string[]
  parameterLabels?: Record<string, string>
}

const TOOL_CONFIRMATION_DISPLAY: Record<string, ToolConfirmationDisplayConfig> = {
  create_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.create_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.create_file.description',
    summaryFields: ['filePath', 'content'],
    contentFields: ['content'],
  },
}

export function getToolConfirmationDisplay(toolName: string) {
  return TOOL_CONFIRMATION_DISPLAY[toolName]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tool-confirmation-display.ts src/lib/agent/tool-confirmation-display.test.mjs
git commit -m "feat(agent): add confirmation display registry"
```

### Task 2: Add fallback formatting tests and implementation

**Files:**
- Modify: `src/lib/agent/tool-confirmation-display.test.mjs`
- Modify: `src/lib/agent/tool-confirmation-display.ts`

- [ ] **Step 1: Write the failing test**

```js
test('unknown tools fall back to generic labels and filtered params', () => {
  const summary = formatConfirmationPreview('unknown_tool', {
    filePath: 'notes/guan-yu.md',
    extra: 'value',
  })

  assert.equal(summary.titleKey, 'record.chat.input.agent.confirmation.fallback.title')
  assert.equal(summary.fields[0].labelKey, 'record.chat.input.agent.confirmation.params.filePath')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: FAIL because `formatConfirmationPreview` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function formatConfirmationPreview(toolName: string, params: Record<string, unknown>) {
  const config = getToolConfirmationDisplay(toolName)
  const titleKey = config?.titleKey ?? 'record.chat.input.agent.confirmation.fallback.title'

  return {
    titleKey,
    descriptionKey: config?.descriptionKey ?? 'record.chat.input.agent.confirmation.fallback.description',
    fields: Object.entries(params).map(([name, value]) => ({
      name,
      labelKey: `record.chat.input.agent.confirmation.params.${name}`,
      value,
    })),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tool-confirmation-display.ts src/lib/agent/tool-confirmation-display.test.mjs
git commit -m "feat(agent): add confirmation preview fallbacks"
```

## Chunk 2: i18n Content and Parameter Labels

### Task 3: Add localized tool titles, descriptions, and parameter labels

**Files:**
- Modify: `messages/zh.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/agent/tool-confirmation-display.test.mjs`:

```js
import zh from '../../../messages/zh.json' with { type: 'json' }
import en from '../../../messages/en.json' with { type: 'json' }

test('confirmation i18n includes create_file and shared param labels', () => {
  assert.equal(
    zh.record.chat.input.agent.confirmation.tools.create_file.title,
    '创建文件'
  )
  assert.equal(
    en.record.chat.input.agent.confirmation.params.filePath,
    'File path'
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: FAIL because keys are missing.

- [ ] **Step 3: Write minimal implementation**

Add these key groups to both locale files:

```json
"record": {
  "chat": {
    "input": {
      "agent": {
        "confirmation": {
          "fallback": {
            "title": "即将执行操作",
            "description": "请确认这次操作的目标和内容。"
          },
          "params": {
            "filePath": "文件路径",
            "content": "文件内容",
            "sourcePath": "来源路径",
            "targetPath": "目标路径"
          },
          "tools": {
            "create_file": {
              "title": "创建文件",
              "description": "将在工作区中新建一个文件。"
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add messages/zh.json messages/en.json src/lib/agent/tool-confirmation-display.test.mjs
git commit -m "feat(agent): localize confirmation tool labels"
```

## Chunk 3: Confirmation Card Rendering

### Task 4: Replace raw tool names with localized display content

**Files:**
- Modify: `src/components/ui/agent-plan.tsx`
- Modify: `src/app/core/main/chat/agent-panel-with-rag.tsx`
- Modify: `src/app/core/main/chat/agent-execution-status.tsx`
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/tool-confirmation-display.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/agent/tool-confirmation-display.test.mjs`:

```js
test('create_file preview prioritizes file path and content preview', () => {
  const preview = formatConfirmationPreview('create_file', {
    filePath: 'notes/guan-yu.md',
    content: '# 关羽\\n...',
  })

  assert.deepEqual(
    preview.fields.map((field) => field.name),
    ['filePath', 'content']
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: FAIL because preview ordering and content field handling are not implemented.

- [ ] **Step 3: Write minimal implementation**

Implement preview shaping helpers in `src/lib/agent/tool-confirmation-display.ts`:
- prioritize configured `summaryFields`
- mark long `content`-like fields as preview blocks
- keep unknown params in an "other parameters" bucket

Update `src/components/ui/agent-plan.tsx` to render:
- localized title
- localized description
- labeled summary fields
- content preview block for long text
- existing diff block when available

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/agent-plan.tsx src/app/core/main/chat/agent-panel-with-rag.tsx src/app/core/main/chat/agent-execution-status.tsx src/lib/agent/types.ts src/lib/agent/tool-confirmation-display.ts src/lib/agent/tool-confirmation-display.test.mjs
git commit -m "feat(agent): render localized confirmation previews"
```

## Chunk 4: Initial Tool Coverage

### Task 5: Add first-pass registry entries for all confirmation-relevant tools

**Files:**
- Modify: `src/lib/agent/tool-confirmation-display.ts`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Test: `src/lib/agent/tool-confirmation-display.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('confirmation registry covers common write and destructive tools', () => {
  const toolNames = [
    'create_file',
    'rename_file',
    'move_file',
    'copy_file',
    'delete_markdown_file',
    'execute_skill_script',
  ]

  for (const name of toolNames) {
    assert.ok(getToolConfirmationDisplay(name), `${name} should have display metadata`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: FAIL because only `create_file` is registered.

- [ ] **Step 3: Write minimal implementation**

Add registry entries and i18n strings for:
- file creation and batch creation
- rename/move/copy operations
- editor content replacement / insertion
- delete / clear / execute actions that currently ask for confirmation

Keep parameter labels shared where possible:
- `filePath`
- `targetPath`
- `sourcePath`
- `content`
- `newName`
- `command`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs`
Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `node --experimental-strip-types --test src/lib/agent/tool-confirmation-display.test.mjs && pnpm exec tsc --noEmit`
Expected: all tests pass, typecheck passes

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/tool-confirmation-display.ts messages/zh.json messages/en.json src/lib/agent/tool-confirmation-display.test.mjs
git commit -m "feat(agent): cover confirmation display metadata for core tools"
```
