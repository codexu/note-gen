# PC Record List Redesign

## Goal

Redesign the PC record list so it feels better for organizing records, not just browsing them. The new design should improve visual hierarchy, support multiple working modes, and stay aligned with the existing shadcn-style toolbar and filter work.

## Confirmed Direction

- The redesign applies to the PC record list first.
- The default record view remains `list`.
- View switching moves to the bottom record toolbar instead of the header.
- Multi-select mode and view switching do not coexist.
  - When multi-select is active, the view switcher is hidden.
  - The toolbar becomes a batch-action toolbar.
- The PC flow keeps the top area lighter.
  - Top actions remain focused on context actions like organize, filter, and trash.
  - View mode becomes a workspace-level control in the bottom toolbar.

## View Model

The PC record area will support three views:

### 1. List View

The default, most complete view.

Characteristics:

- Keeps the current rich record structure with type badge, time, title/summary, and type-specific supporting content.
- Best for normal browsing and review.
- Should feel more polished than the current version through spacing, grouping, and card treatment, but it should remain the most stable and readable layout.

### 2. Compact View

A dense view optimized for organizing and scanning many records quickly.

Characteristics:

- Each row becomes a tighter scan line.
- Type tag stays on the left.
- Time stays on the right.
- The center primarily shows the main title or main content line.
- Secondary description and attachments are minimized or hidden.

Intent:

- Help users sort, scan, and prepare for batch actions faster.
- Feel like an “organizing mode”, not just a squeezed list view.

### 3. Card View

A visually richer layout for mixed-content records.

Characteristics:

- Uses a masonry-style responsive layout instead of a uniform grid.
- Column count changes with available width.
  - Narrow widths show fewer columns.
  - Wider widths show more columns.
- Cards are content-sensitive:
  - Images and screenshots get stronger visual blocks.
  - Links can show title/domain/summary.
  - Text remains restrained, not overdesigned.
  - Todo remains task-like, not forced into a heavy media card.
- Text preview is capped at 6 lines.

Intent:

- Let content with different heights feel natural instead of forcing every record into the same card box.
- Make the view useful for mixed media without hurting text readability.

## Bottom Toolbar Behavior

The bottom toolbar becomes the record workspace mode bar.

### Normal State

The toolbar shows:

- Record state summary on the left, such as filtered result count.
- View mode switcher on the right:
  - `List`
  - `Compact`
  - `Cards`
- Multi-select entry remains available.

### Multi-select State

When multi-select is active:

- The view mode switcher is hidden.
- The toolbar switches to batch actions only.
- Typical actions:
  - Select all
  - Clear selection / deselect all
  - Exit multi-select

This keeps the interface stable and avoids changing layout mode in the middle of a batch-selection workflow.

## Visual Design Notes

- Continue using the current shadcn-aligned visual direction.
- Keep type colors and labels consistent across:
  - record list badges
  - filter type chips
  - compact rows
  - card view tags
- Avoid nested or heavy panels.
- Prefer lighter surfaces, softer borders, and cleaner spacing over dense boxed UI.
- Preserve the existing type color system introduced in `mark-type-meta.ts`.

## Data and Behavior Expectations

- All three views share the same filtering, sorting, selection, and persistence logic.
- Switching views only changes presentation, not record behavior.
- The selected view should be persisted so the PC record area can reopen in the user’s last-used mode.
- Multi-select operations should continue to respect the currently visible filtered record set.

## Technical Shape

Expected implementation direction:

- Introduce a persistent record view mode in the mark store.
- Refactor the PC record list to render through a view-mode-aware presentation layer.
- Keep item-level type metadata shared through the existing mark type meta module.
- Rework the bottom toolbar so it can render:
  - normal mode controls
  - multi-select controls
- Implement card view with a responsive masonry approach suitable for React/Tailwind in the current app structure.

## Risks and Checks

Main risks:

- Masonry card layout may complicate selection affordances and keyboard behavior.
- Compact view can become too stripped down if title extraction is inconsistent across record types.
- Different record types must still feel related even when their card layouts diverge.

Verification focus:

- Visual consistency across all record types
- Stable multi-select behavior in all views
- Correct persistence of the last-selected view
- Acceptable responsive behavior for wider and narrower PC sidebar widths

## Out of Scope

- Mobile redesign beyond keeping existing mobile behavior intact
- Reworking filtering behavior again
- New sorting systems or advanced bulk actions beyond current multi-select flow
