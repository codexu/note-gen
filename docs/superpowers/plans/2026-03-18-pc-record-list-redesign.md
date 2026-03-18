# PC Record List Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent PC record view modes with redesigned list, compact, and masonry card presentations, controlled from the bottom toolbar without changing existing filtering or multi-select semantics.

**Architecture:** The change extends the mark store with a persisted `recordViewMode`, then routes PC record rendering through a view-mode-aware presentation layer. The bottom toolbar becomes a workspace mode bar in normal state and a batch-action bar in multi-select state, while all three views continue to share the same filtered data, selection state, and type metadata.

**Tech Stack:** Next.js App Router, React, Zustand, Tauri Store, Tailwind CSS, shadcn/ui, next-intl, Node test runner

---

## File Structure

- Modify: `src/stores/mark.ts`
  Responsibility: add persistent PC record view mode state and actions.
- Modify: `src/app/core/main/mark/mark-toolbar.tsx`
  Responsibility: render normal-state view switching and multi-select-only toolbar states.
- Modify: `src/app/core/main/mark/mark-list.tsx`
  Responsibility: choose the active PC list presentation, share filtered marks and summary state.
- Modify: `src/app/core/main/mark/mark-item.tsx`
  Responsibility: support the redesigned default list treatment and expose reusable content helpers if needed.
- Modify: `src/app/core/main/mark/todo-item-content.tsx`
  Responsibility: keep todo presentation aligned across list and card-oriented layouts.
- Create: `src/app/core/main/mark/mark-view-mode-toggle.tsx`
  Responsibility: focused segmented/toggle control for `list`, `compact`, and `cards`.
- Create: `src/app/core/main/mark/mark-list-default-view.tsx`
  Responsibility: render the redesigned default list view.
- Create: `src/app/core/main/mark/mark-list-compact-view.tsx`
  Responsibility: render compact rows with left-aligned type tag and right-aligned time.
- Create: `src/app/core/main/mark/mark-list-card-view.tsx`
  Responsibility: render responsive masonry cards with content-sensitive layouts and six-line text clamp.
- Create: `src/app/core/main/mark/mark-list-item-content.tsx`
  Responsibility: derive shared display primitives for title, subtitle, preview text, and optional media blocks so all views stay consistent.
- Modify: `src/app/core/main/mark/mark-type-meta.ts`
  Responsibility: extend shared type metadata if a view needs shared card/list chip helpers.
- Modify: `messages/zh.json`
  Responsibility: add PC record view mode labels and toolbar summary strings.
- Modify: `messages/en.json`
  Responsibility: add English equivalents for new toolbar/view copy.
- Modify: `src/app/core/main/mark/mark-filters.spec.mjs`
  Responsibility: only if helper coverage needs extension for view-mode-adjacent derived summaries.
- Create: `src/app/core/main/mark/mark-view-mode.spec.mjs`
  Responsibility: cover persisted view mode normalization/persistence helper behavior if logic is extracted into testable utilities.

## Chunk 1: Persisted View Mode State

### Task 1: Add record view mode state to the mark store

**Files:**
- Modify: `src/stores/mark.ts`
- Test: `src/app/core/main/mark/mark-view-mode.spec.mjs`

- [ ] **Step 1: Write the failing test for view mode normalization**

```js
import test from "node:test"
import assert from "node:assert/strict"
import { normalizeRecordViewMode } from "./mark-view-mode.mjs"

test("normalizes persisted record view mode", () => {
  assert.equal(normalizeRecordViewMode("list"), "list")
  assert.equal(normalizeRecordViewMode("compact"), "compact")
  assert.equal(normalizeRecordViewMode("cards"), "cards")
  assert.equal(normalizeRecordViewMode("table"), "list")
  assert.equal(normalizeRecordViewMode(undefined), "list")
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/app/core/main/mark/mark-view-mode.spec.mjs`
Expected: FAIL because `mark-view-mode.mjs` and `normalizeRecordViewMode` do not exist yet.

- [ ] **Step 3: Add a tiny normalization helper**

Create `src/app/core/main/mark/mark-view-mode.mjs`:

```js
export const RECORD_VIEW_MODES = ["list", "compact", "cards"]

export function normalizeRecordViewMode(value) {
  return RECORD_VIEW_MODES.includes(value) ? value : "list"
}
```

- [ ] **Step 4: Re-run the test and verify it passes**

Run: `node --test src/app/core/main/mark/mark-view-mode.spec.mjs`
Expected: PASS.

- [ ] **Step 5: Wire the helper into the Zustand store**

Update `src/stores/mark.ts` to add:

```ts
export type RecordViewMode = 'list' | 'compact' | 'cards'
```

Add store state and actions:

```ts
recordViewMode: RecordViewMode
setRecordViewMode: (mode: RecordViewMode) => void
initRecordViewMode: () => Promise<void>
```

Persist under `store.json` key `recordViewMode`, defaulting to `list`, and use `normalizeRecordViewMode` during initialization.

- [ ] **Step 6: Add a guard for invalid persisted values**

Ensure `initRecordViewMode` resets invalid saved values back to `"list"` instead of leaving bad state in memory.

- [ ] **Step 7: Run targeted verification**

Run: `node --test src/app/core/main/mark/mark-view-mode.spec.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/stores/mark.ts src/app/core/main/mark/mark-view-mode.mjs src/app/core/main/mark/mark-view-mode.spec.mjs
git commit -m "feat: persist record view mode"
```

## Chunk 2: Bottom Toolbar Workspace Modes

### Task 2: Replace the bottom toolbar with mode-aware controls

**Files:**
- Modify: `src/app/core/main/mark/mark-toolbar.tsx`
- Create: `src/app/core/main/mark/mark-view-mode-toggle.tsx`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Create the view mode toggle component**

Build `mark-view-mode-toggle.tsx` as a small, reusable control:

```tsx
type Props = {
  value: RecordViewMode
  onChange: (mode: RecordViewMode) => void
}
```

Use shadcn-style toggle buttons with exactly three options:
- `list`
- `compact`
- `cards`

- [ ] **Step 2: Update toolbar normal state**

In `mark-toolbar.tsx`, show:
- left summary text such as visible filtered record count
- right-side `MarkViewModeToggle`
- multi-select entry button

Use `visibleMarkIds.length` when available so the summary matches filtered results.

- [ ] **Step 3: Update toolbar multi-select state**

When `isMultiSelectMode` is true:
- hide the view mode toggle
- show selection summary
- keep select-all / deselect-all
- keep exit multi-select

Do not allow view switching while multi-select is active.

- [ ] **Step 4: Add i18n labels**

Add keys for:
- `record.mark.toolbar.view.list`
- `record.mark.toolbar.view.compact`
- `record.mark.toolbar.view.cards`
- `record.mark.toolbar.visibleCount`

Example:

```json
"visibleCount": "{count, plural, =0 {No records} one {# record} other {# records}}"
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/main/mark/mark-toolbar.tsx src/app/core/main/mark/mark-view-mode-toggle.tsx messages/zh.json messages/en.json
git commit -m "feat: add record view mode toolbar controls"
```

## Chunk 3: Shared Record Presentation Helpers

### Task 3: Extract shared item display data for all PC views

**Files:**
- Create: `src/app/core/main/mark/mark-list-item-content.tsx`
- Modify: `src/app/core/main/mark/mark-item.tsx`
- Modify: `src/app/core/main/mark/todo-item-content.tsx`
- Modify: `src/app/core/main/mark/mark-type-meta.ts`

- [ ] **Step 1: Define the shared presentation contract**

Create a helper shape such as:

```ts
type MarkListItemContent = {
  title: string
  preview?: string
  meta?: string
  imageUrl?: string
  linkUrl?: string
  showTodoState?: boolean
}
```

Keep it focused on view rendering, not mutation or DB logic.

- [ ] **Step 2: Implement per-type derivation**

In `mark-list-item-content.tsx`, derive:
- text title/preview from content
- link title from desc/url
- recording title from desc/content
- image/scan preview text and media path
- todo title/description/completed summary from parsed todo JSON

Keep text preview clamping concerns out of the data helper.

- [ ] **Step 3: Refactor existing list item rendering to use shared data where it simplifies duplication**

Do not rewrite everything at once.
Only extract enough so:
- default list
- compact rows
- cards

can all render from the same source of truth.

- [ ] **Step 4: Keep type badge helpers centralized**

If needed, extend `mark-type-meta.ts` with shared classes for:
- inline list badge
- compact badge
- card badge

Avoid drifting colors or text labels between views.

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/main/mark/mark-list-item-content.tsx src/app/core/main/mark/mark-item.tsx src/app/core/main/mark/todo-item-content.tsx src/app/core/main/mark/mark-type-meta.ts
git commit -m "refactor: share pc record item presentation data"
```

## Chunk 4: Three PC Record Views

### Task 4: Build the redesigned default list view

**Files:**
- Create: `src/app/core/main/mark/mark-list-default-view.tsx`
- Modify: `src/app/core/main/mark/mark-list.tsx`
- Modify: `src/app/core/main/mark/mark-item.tsx`

- [ ] **Step 1: Introduce a dedicated default list view component**

Move the current PC list mapping into `mark-list-default-view.tsx` so `mark-list.tsx` stops owning all rendering details.

- [ ] **Step 2: Redesign spacing and surface treatment**

Update the default list view to:
- use lighter grouped surfaces
- improve vertical rhythm
- keep richer summaries
- preserve type-specific details

Do not change interaction semantics.

- [ ] **Step 3: Keep selection and queue behavior intact**

Verify queued items and empty states still render in the same places as before.

- [ ] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/main/mark/mark-list-default-view.tsx src/app/core/main/mark/mark-list.tsx src/app/core/main/mark/mark-item.tsx
git commit -m "feat: redesign default pc record list view"
```

### Task 5: Add the compact record view

**Files:**
- Create: `src/app/core/main/mark/mark-list-compact-view.tsx`
- Modify: `src/app/core/main/mark/mark-list.tsx`

- [ ] **Step 1: Build compact row rendering**

Each row should render:
- type chip on the left
- primary title in the center
- time on the right

Keep it to a single compact scan line.

- [ ] **Step 2: Reuse shared content derivation**

Use `mark-list-item-content.tsx` to avoid per-view heuristic drift.

- [ ] **Step 3: Preserve selection and click behavior**

The compact row must still support opening details and multi-select checkbox handling through the existing `MarkItem` / wrapper path or an extracted compatible path.

- [ ] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/main/mark/mark-list-compact-view.tsx src/app/core/main/mark/mark-list.tsx
git commit -m "feat: add compact pc record view"
```

### Task 6: Add the masonry card view

**Files:**
- Create: `src/app/core/main/mark/mark-list-card-view.tsx`
- Modify: `src/app/core/main/mark/mark-list.tsx`

- [ ] **Step 1: Build a responsive masonry container**

Implement a CSS-column-based masonry layout or another lightweight responsive masonry approach already compatible with the codebase.

Behavior target:
- fewer columns at narrower widths
- more columns at wider widths

- [ ] **Step 2: Render content-sensitive cards**

Per card:
- image/scan: media block + title
- text: restrained card + preview clamped to 6 lines
- link: title + URL/domain summary
- todo: task-like card, not media-heavy
- recording/file: concise metadata-first card

- [ ] **Step 3: Preserve record actions and accessibility**

Cards must still allow:
- opening detail views
- entering multi-select
- consistent keyboard focus behavior

- [ ] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/main/mark/mark-list-card-view.tsx src/app/core/main/mark/mark-list.tsx
git commit -m "feat: add masonry pc record card view"
```

## Chunk 5: Integration and Regression Checks

### Task 7: Route `mark-list.tsx` by active view mode

**Files:**
- Modify: `src/app/core/main/mark/mark-list.tsx`

- [ ] **Step 1: Replace inline rendering with a mode switch**

Render one of:
- `MarkListDefaultView`
- `MarkListCompactView`
- `MarkListCardView`

based on `recordViewMode`.

- [ ] **Step 2: Keep summary and empty-state rules shared**

The filter summary chips, queue rendering, and empty-state messaging should remain consistent across all three views.

- [ ] **Step 3: Verify filtered visible IDs still track correctly**

`setVisibleMarkIds` must continue to receive the same filtered list regardless of active view mode.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test src/app/core/main/mark/mark-filters.spec.mjs
node --test src/app/core/main/mark/mark-view-mode.spec.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/main/mark/mark-list.tsx
git commit -m "refactor: switch pc record list by view mode"
```

### Task 8: Full verification

**Files:**
- Modify: only if verification reveals issues

- [ ] **Step 1: Run full typecheck**

Run: `pnpm exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test src/app/core/main/mark/mark-filters.spec.mjs
node --test src/app/core/main/mark/mark-view-mode.spec.mjs
```

Expected: PASS.

- [ ] **Step 3: Run the desktop app for manual verification**

Run: `pnpm tauri dev`

Manual checks:
- default view is `list`
- switching views updates the PC list immediately
- selected view persists after reload/reopen
- compact view keeps type left and time right
- card view uses responsive masonry and clamps text previews to six lines
- multi-select hides the view switcher
- select-all still respects the filtered visible set
- trash mode does not regress

- [ ] **Step 4: Commit any final fixes**

```bash
git add <changed-files>
git commit -m "fix: polish pc record list redesign"
```
