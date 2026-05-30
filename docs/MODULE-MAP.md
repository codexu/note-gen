# NoteGen Module Map

This file is a practical “where things live” guide for contributors.

## Top-level map

- `src/app`: Next.js App Router pages/layouts (desktop + mobile)
- `src/components`: shared React UI components
- `src/stores`: Zustand state stores and app settings
- `src/lib`: business logic/services/utilities
- `src/db`: SQLite schema init and query helpers
- `src/config`: static config constants (shortcuts, emitters, exclusions)
- `src/contexts`: React providers/contexts
- `src/hooks`: app hooks
- `src-tauri`: Rust native layer and Tauri configuration
- `messages`: locale JSON files

## `src/app` route modules

- Root:
  - `layout.tsx`: global wrappers/provider composition
  - `page.tsx`: initial redirect logic (desktop/mobile)
- Desktop:
  - `core/layout.tsx`: desktop init lifecycle and shell
  - `core/main/page.tsx`: main 3-pane workspace
  - `core/article/*`: editor stack (markdown/image/folder)
  - `core/record/*`: chat + capture/record flows
  - `core/setting/*`: full desktop settings sections
- Mobile:
  - `mobile/layout.tsx`: mobile shell + hidden capture controls
  - `mobile/chat/page.tsx`, `mobile/record/page.tsx`, `mobile/writing/page.tsx`
  - `mobile/setting/pages/*`: mobile settings sections

## `src/stores` responsibilities

- `setting.ts`: central settings model (AI models, sync, themes, workspace paths, UI scale)
- `article.ts`: file tree/editor selection state
- `chat.ts`, `mark.ts`, `tag.ts`: core domain state
- `sync.ts`, `settingsSync.ts`, `webdav.ts`, `sync-confirm.ts`: sync and conflict UX
- `vector.ts`, `ragSettings.ts`: embedding/vector search settings and state
- `skills.ts`, `mcp.ts`: skill and MCP runtime state

## `src/lib` service modules

- `ai/*`: chat/completion/embedding integration
- `sync/*`: GitHub/Gitee/GitLab/Gitea sync adapters + conflict handling + autosync
- `mcp/*`: MCP init/client/server integration helpers
- `skills/*`: skill parsing/validation/execution helpers
- `rag.ts`, `bm25.ts`, `search-utils.ts`: retrieval/search logic
- `ocr.ts`, `pdf.ts`, `audio.ts`, `audio-converter.ts`: media/IO processing helpers

## `src/db` local persistence

- `index.ts`: single DB load + all-table initialization
- `chats.ts`, `marks.ts`, `notes.ts`, `tags.ts`, `vector.ts`: table creation + CRUD/select helpers

## `src-tauri` native bridge

- `src/lib.rs`: command registration and plugin wiring
- `webdav.rs`: WebDAV connectivity/backup/sync
- `mcp.rs`: stdio MCP process lifecycle and message piping
- `backup.rs`: app data import/export
- `device.rs`: device ID utilities
- `skills.rs`: skill package import
- `tauri.conf.json`: Tauri app/build/bundle/updater config

## External bundled projects

- `machinelearning-samples/`: standalone ML.NET sample repository
- `YoloDotNet/`: standalone .NET YOLO library

These are independent projects and should usually be treated as read-only unless your task explicitly targets them.
