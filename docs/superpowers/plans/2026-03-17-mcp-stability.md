# MCP Stability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MCP stdio transport standards-compliant and align runtime lifecycle behavior with app startup and settings actions.

**Architecture:** Keep the current MCP client and manager structure, but move lifecycle authority into `MCPServerManager`, remove duplicate startup connects, and make the Rust stdio transport use standard framed MCP messages. Settings actions will call explicit connect, disconnect, and test flows instead of relying on indirect store behavior.

**Tech Stack:** Tauri, Rust, TypeScript, Zustand, Next.js

---

## Chunk 1: Stdio Framing

### Task 1: Add failing Rust tests for MCP stdio framing

**Files:**
- Modify: `src-tauri/src/mcp.rs`
- Test: `src-tauri/src/mcp.rs`

- [ ] **Step 1: Write failing tests for frame encoding and decoding**

Add unit tests for:
- writing a `Content-Length` header plus JSON body
- reading a complete framed message
- rejecting malformed or truncated input

- [ ] **Step 2: Run Rust tests to verify the new framing tests fail**

Run: `cargo test mcp --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because framing helpers do not exist yet

- [ ] **Step 3: Implement minimal framing helpers**

Add small helper functions in `src-tauri/src/mcp.rs` that:
- encode a JSON body into a framed message
- parse headers from a reader
- read the exact byte length advertised by `Content-Length`

- [ ] **Step 4: Refactor stdio request/response to use framing**

Update `send_mcp_message` so it writes framed payloads and reads framed responses instead of newline-delimited JSON.

- [ ] **Step 5: Run Rust tests to verify framing passes**

Run: `cargo test mcp --manifest-path src-tauri/Cargo.toml`
Expected: PASS for framing tests

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp.rs
git commit -m "fix: use framed stdio transport for mcp"
```

## Chunk 2: Single Initialization Path

### Task 2: Remove duplicate auto-connect behavior

**Files:**
- Modify: `src/stores/mcp.ts`
- Modify: `src/lib/mcp/init.ts`
- Modify: `src/lib/mcp/integration.ts`

- [ ] **Step 1: Write a failing lifecycle test or isolate logic for direct verification**

If an existing TS test harness is present, add a test showing enabled servers are connected once on startup. If not, extract the startup path into a function small enough to verify by inspection and command-level validation.

- [ ] **Step 2: Run the targeted verification and confirm the duplicate-connect case is still possible**

Run the smallest available validation command for the chosen test or check path.
Expected: existing logic still shows two startup connect paths in code.

- [ ] **Step 3: Remove store-side delayed auto-connect**

Change `src/stores/mcp.ts` so `initMcpData()` only loads persisted config and marks initialization complete.

- [ ] **Step 4: Keep exactly one startup connection path**

Make `src/lib/mcp/init.ts` the only startup entry point that connects enabled servers through the manager.

- [ ] **Step 5: Run verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/stores/mcp.ts src/lib/mcp/init.ts src/lib/mcp/integration.ts
git commit -m "fix: remove duplicate mcp startup connections"
```

## Chunk 3: Lifecycle Cleanup for Disable and Delete

### Task 3: Ensure settings actions disconnect active servers

**Files:**
- Modify: `src/stores/mcp.ts`
- Modify: `src/lib/mcp/server-manager.ts`
- Modify: `src/app/core/setting/mcp/server-config-dialog.tsx`

- [ ] **Step 1: Add a failing test or verification target for disconnect-on-disable/delete**

Cover or explicitly validate:
- deleting a connected server disconnects it first
- disabling a connected server disconnects it
- editing an enabled connected server reconnects with updated config

- [ ] **Step 2: Run the verification and observe the current failure case**

Expected: existing flow updates config without guaranteed disconnect.

- [ ] **Step 3: Implement explicit lifecycle helpers**

Add or refine `disconnectServer`, `reconnectServer`, and related helpers in `src/lib/mcp/server-manager.ts` so callers can safely perform settings-driven lifecycle actions.

- [ ] **Step 4: Update settings save and store behavior**

Make save, disable, and delete flows explicitly disconnect or reconnect through the manager before finalizing persisted state.

- [ ] **Step 5: Run verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/stores/mcp.ts src/lib/mcp/server-manager.ts src/app/core/setting/mcp/server-config-dialog.tsx
git commit -m "fix: clean up mcp connections on settings changes"
```

## Chunk 4: Non-Destructive Connection Tests

### Task 4: Make single and batch connection tests accurate and non-destructive

**Files:**
- Modify: `src/lib/mcp/server-manager.ts`
- Modify: `src/app/core/setting/mcp/server-list.tsx`
- Modify: `src/app/core/setting/mcp/json-import-dialog.tsx`

- [ ] **Step 1: Write or define the failing verification target for test-all behavior**

Cover:
- test-all does not reconnect active servers
- batch results report failures accurately

- [ ] **Step 2: Run verification to confirm the current destructive behavior**

Expected: current implementation uses `reconnectServer` and unconditional success messaging.

- [ ] **Step 3: Implement non-destructive batch testing**

Add a helper that runs `testConnection` per enabled server and returns counts or per-server results without mutating active connections.

- [ ] **Step 4: Update settings UI messaging**

Make `server-list.tsx` show accurate completion messaging for:
- all success
- partial success
- all failure

- [ ] **Step 5: Run verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/server-manager.ts src/app/core/setting/mcp/server-list.tsx src/app/core/setting/mcp/json-import-dialog.tsx
git commit -m "fix: make mcp connection tests non-destructive"
```

## Chunk 5: Final Verification

### Task 5: Validate the integrated result

**Files:**
- Modify: `docs/superpowers/specs/2026-03-17-mcp-stability-design.md`
- Modify: `docs/superpowers/plans/2026-03-17-mcp-stability.md`

- [ ] **Step 1: Run Rust verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `pnpm lint`
Expected: PASS, or document the existing nested-worktree ESLint conflict if it still blocks execution

- [ ] **Step 3: Review the diff for MCP-only scope**

Run: `git diff --stat`
Expected: changes limited to MCP transport, lifecycle, settings, and docs

- [ ] **Step 4: Commit final polish if needed**

```bash
git add docs/superpowers/specs/2026-03-17-mcp-stability-design.md docs/superpowers/plans/2026-03-17-mcp-stability.md
git commit -m "docs: add mcp stability design and plan"
```
