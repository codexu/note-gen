# NoteGen Codebase Overview

This repository contains **three separate codebases**:

1. **`note-gen` (primary app)**: Tauri + Next.js markdown note application with AI, sync, and local-first data.
2. **`machinelearning-samples`**: Upstream ML.NET sample repository (vendored).
3. **`YoloDotNet`**: Upstream .NET YOLO inference library (vendored).

---

## 1) Primary App (`note-gen`)

### Tech stack

- UI/runtime: Next.js 15, React 19, TypeScript
- Desktop/mobile shell: Tauri v2 + Rust
- State management: Zustand stores in `src/stores`
- Persistence:
  - SQLite via `@tauri-apps/plugin-sql` (`src/db`)
  - App settings via `@tauri-apps/plugin-store` (`store.json`)
  - Markdown/image files via Tauri FS APIs
- i18n: `next-intl` + `messages/*.json`
- UI primitives: Radix + custom components in `src/components/ui`

### Runtime entry flow

1. `src/app/page.tsx` decides initial route (`/core/main` for desktop, `/mobile/chat` for mobile).
2. `src/app/layout.tsx` sets global providers, CSS, i18n wrapper, and markdown-it compatibility shim.
3. `src/app/core/layout.tsx` or `src/app/mobile/layout.tsx` performs app initialization:
   - settings init
   - DB init (`initAllDatabases`)
   - vector init
   - image hosting init
   - MCP init
   - shortcut/init hooks

### Core functional areas

- **Recording/Chat**: `src/app/core/record/chat/*`, mirrored mobile routes under `src/app/mobile/*`
- **Writing/Editor**: `src/app/core/article/*` (`editor-wrapper.tsx` chooses markdown/image/folder views)
- **Main desktop workspace**: `src/app/core/main/page.tsx` (resizable left/editor/right panels)
- **Settings**: desktop and mobile settings routes under `src/app/core/setting/*` and `src/app/mobile/setting/*`

### Data model (SQLite)

Database initialization in `src/db/index.ts` sets up:

- `chats`
- `marks`
- `notes`
- `tags`
- `vector`

These tables support chat history, captured marks/snippets, note records, tagging, and embedding/search data.

### Native (Rust/Tauri) side

`src-tauri/src/lib.rs` registers plugins and command handlers.

Main command groups:

- WebDAV test/sync/backup (`webdav.rs`)
- MCP server process management (`mcp.rs`)
- Device ID and backup import/export
- Skill package import

This means most heavy OS/system integration is intentionally placed in Rust commands, while UI logic stays in TypeScript.

---

## 2) `machinelearning-samples`

- This is a full ML.NET samples repository (C#/F#/CLI datasets and docs).
- It is not part of the NoteGen runtime path.
- Treat it as a standalone reference or bundled dependency tree unless your task explicitly targets it.

---

## 3) `YoloDotNet`

- This is a standalone .NET 8 YOLO inference library with its own solution and demos.
- It is not part of the `note-gen` app routing/runtime.
- Treat it as an independent subproject unless explicitly working on computer-vision integration tasks.

---

## Recommended way to navigate this repo

If your goal is to modify the NoteGen application, focus in this order:

1. `src/app` (routes/layouts/pages)
2. `src/stores` (state + settings + app behavior)
3. `src/lib` (AI/sync/skill/MCP/business utilities)
4. `src/db` (local data schema and persistence functions)
5. `src-tauri/src` (native bridge commands)

Ignore `machinelearning-samples` and `YoloDotNet` unless a feature directly references them.
