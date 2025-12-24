# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies (use pnpm)
pnpm install

# Start development server (Tauri + Next.js)
pnpm tauri dev

# Build for production
pnpm tauri build

# Start Next.js development server only (for frontend testing)
pnpm dev  # runs on port 3456

# Lint code
pnpm lint

# Build documentation
pnpm docs:build
```

## Architecture Overview

NoteGen is a hybrid desktop application combining:
- **Frontend**: Next.js 15 with React 19, TypeScript, Tailwind CSS, and shadcn/ui
- **Backend**: Tauri 2 (Rust) for native desktop capabilities
- **Database**: SQLite via Tauri SQL plugin
- **State Management**: Zustand stores with persistence

### Key Architectural Patterns

1. **Feature-based organization** in `/src/app/core/`:
   - `article/` - Markdown editor and file management
   - `record/` - Note capture system (chat, marks, tags)
   - `image/` - Image repository management
   - `search/` - Full-text search
   - `setting/` - Configuration panels

2. **State Management** (`/src/stores/`):
   - Each feature has its own Zustand store
   - Stores handle both UI state and data persistence
   - Key stores: `chat.ts`, `mark.ts`, `article.ts`, `vector.ts`, `setting.ts`

3. **Database Layer** (`/src/db/`):
   - Modular SQLite table management
   - Tables: `notes`, `marks`, `chats`, `tags`, `vector_documents`
   - Tags serve as the primary organizational unit across all entities

4. **AI Integration** (`/src/lib/ai.ts`):
   - Multi-provider support: OpenAI, Google Gemini, Ollama, custom endpoints
   - Streaming responses with abort capability
   - Model-specific configurations for different tasks

5. **RAG System** (`/src/lib/rag.ts`):
   - Vector embeddings stored in SQLite
   - Document chunking and similarity search
   - Reranking for improved relevance

6. **Tauri Integration**:
   - Commands in `/src-tauri/src/`: `screenshot.rs`, `webdav.rs`
   - Plugins: SQL, Store, FS, HTTP, Clipboard, Dialog
   - Native features: tray icon, global shortcuts, window state

### Data Flow

```
User Action → React Component → Zustand Store → Database/Tauri Command
                     ↓
UI Updates ← State Updates ← Store Updates ← Response
```

### Important Integration Points

1. **Markdown Editor**: Uses `vditor` for editing and `md-editor-rt` for rendering
2. **Sync Services**: GitHub/Gitee integration via Octokit, WebDAV support
3. **Internationalization**: Next-intl with messages in `/messages/`
4. **Image Processing**: Cropper.js for image editing, local image hosting
5. **Search**: Fuse.js for fuzzy search, vector search for semantic matching

## Development Guidelines

### Branch Strategy
- All development happens on the `dev` branch
- PRs should target `dev` (not master/main)
- `release` branch triggers GitHub Actions for builds

### Code Style
- TypeScript with strict mode enabled
- ESLint configured with Next.js rules
- Path alias `@/*` maps to `./src/*`
- React hooks exhaustive-deps rule is disabled

### Testing Builds
Always run `pnpm tauri build` before submitting PRs to ensure the application builds correctly.

### Working with Tauri
- White screen on dev? Right-click and reload
- Port 3456 is used for Next.js dev server
- Tauri dev host can be configured via `TAURI_DEV_HOST` env variable

### Database Operations
- All database operations are async
- Use the db modules in `/src/db/` for table operations
- Vector operations require embeddings to be generated first

### AI Model Configuration
- Models are configured per-task in settings
- Support for custom API endpoints and headers
- Temperature and other parameters are model-specific