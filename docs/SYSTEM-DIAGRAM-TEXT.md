# NoteGen System Diagram (Text)

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                               note-gen repo                              │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────────── Main App ────────────────────────────┐  │
│  │                                                                     │  │
│  │  UI / Routing Layer                                                 │  │
│  │  src/app                                                            │  │
│  │   ├─ page.tsx  (desktop/mobile entry redirect)                      │  │
│  │   ├─ core/*   (desktop routes and layouts)                          │  │
│  │   └─ mobile/* (mobile routes and layouts)                           │  │
│  │                                                                     │  │
│  │              │ uses                                                  │  │
│  │              ▼                                                       │  │
│  │  State Layer                                                        │  │
│  │  src/stores (Zustand)                                               │  │
│  │   ├─ setting/article/chat/sync/vector...                            │  │
│  │   └─ orchestrates app behavior and user preferences                 │  │
│  │                                                                     │  │
│  │              │ calls                                                 │  │
│  │              ▼                                                       │  │
│  │  Service Layer                                                      │  │
│  │  src/lib                                                            │  │
│  │   ├─ ai/*      (chat/completion/embedding)                          │  │
│  │   ├─ sync/*    (GitHub/Gitee/GitLab/Gitea/WebDAV helpers)           │  │
│  │   ├─ mcp/*     (MCP integration)                                    │  │
│  │   ├─ skills/*  (skill parsing/execution)                            │  │
│  │   └─ rag/pdf/ocr/audio/search utilities                             │  │
│  │                                                                     │  │
│  │         ┌───────────────┴────────────────┐                           │  │
│  │         ▼                                ▼                           │  │
│  │  Local Data                       Native Capabilities               │  │
│  │  src/db                           src-tauri/src                     │  │
│  │   ├─ chats/marks/notes/tags       ├─ lib.rs (command registration) │  │
│  │   ├─ vector table                 ├─ webdav.rs                      │  │
│  │   └─ sqlite note.db               ├─ mcp.rs                         │  │
│  │                                   ├─ backup.rs                      │  │
│  │                                   └─ device/skills modules          │  │
│  │                                                                     │  │
│  │  Cross-cutting                                                         │  │
│  │   ├─ messages/*.json (i18n)                                          │  │
│  │   ├─ src/components/* (UI components)                                │  │
│  │   └─ Tauri plugins (store/fs/sql/http/shortcut/updater/...)         │  │
│  │                                                                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  Standalone bundled subprojects (normally not part of main runtime):     │
│   - machinelearning-samples/                                              │
│   - YoloDotNet/                                                           │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

## Legend

- Top-to-bottom flow: UI → Store → Service → (DB / Tauri Commands)
- `src-tauri` commands are invoked by frontend code through Tauri invoke APIs.
- `machinelearning-samples` and `YoloDotNet` are independent projects in this repo.
