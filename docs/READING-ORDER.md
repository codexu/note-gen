# Code Reading Order

Use this order to understand the main app quickly.

## System diagrams

- Text version: `docs/SYSTEM-DIAGRAM-TEXT.md`
- HTML version: `docs/SYSTEM-DIAGRAM.html`

## 1. App bootstrap

1. `src/app/page.tsx`
2. `src/app/layout.tsx`
3. `src/app/core/layout.tsx` and `src/app/mobile/layout.tsx`

This reveals how the app starts, chooses desktop/mobile, and initializes settings, databases, and services.

## 2. Main user workflows

- Desktop workspace: `src/app/core/main/page.tsx`
- Editor stack: `src/app/core/article/editor-wrapper.tsx` + `md-editor.tsx`
- Chat/record flow: `src/app/core/record/chat/index.tsx`
- Mobile chat route: `src/app/mobile/chat/page.tsx`

## 3. State and configuration

- Start with `src/stores/setting.ts`, then inspect feature stores (`article.ts`, `chat.ts`, `sync.ts`, `vector.ts`).
- Check `src/config/*` for constants and behavior flags.

## 4. Data and persistence

- `src/db/index.ts` then each table module in `src/db/*`.
- Trace where stores/lib functions call DB helpers.

## 5. Service layer

- `src/lib/ai/*` for model calls and AI behavior.
- `src/lib/sync/*` for Git/WebDAV sync and conflict logic.
- `src/lib/mcp/*` and `src/lib/skills/*` for tool/server integrations.

## 6. Native capabilities

- `src-tauri/src/lib.rs` command wiring.
- Then command implementations (`webdav.rs`, `mcp.rs`, `backup.rs`, `device.rs`, `skills.rs`).

## 7. Ignore unless needed

- `machinelearning-samples/`
- `YoloDotNet/`

These are standalone embedded projects and not required to understand the main NoteGen runtime.
