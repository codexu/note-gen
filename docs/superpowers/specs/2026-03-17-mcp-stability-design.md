# MCP Stability Design

## Goal

Stabilize the MCP integration so that standard stdio servers can connect reliably, app startup does not reconnect the same servers multiple times, and settings actions such as disable, delete, and connection tests correctly reflect and manage the real server lifecycle.

## Scope

This design covers four problem areas in the current MCP implementation:

1. Standard stdio transport framing for MCP messages
2. Duplicate initialization and repeated auto-connect behavior
3. Missing disconnect and cleanup when servers are disabled, deleted, or reconfigured
4. Destructive and misleading connection test behavior in settings

This design does not attempt a full MCP subsystem rewrite. It keeps the current client and manager structure, but consolidates lifecycle ownership and makes transport behavior conformant.

## Current Problems

### 1. Stdio transport is non-standard

The Rust backend currently writes JSON-RPC payloads as newline-delimited text and reads responses line by line. Standard MCP stdio transport uses HTTP-like framing with `Content-Length` headers followed by a raw JSON body. Many compliant servers will not interoperate correctly with the current implementation.

### 2. Initialization happens twice

App startup currently triggers MCP startup in two places:

- `useMcpStore.initMcpData()` schedules auto-connect for enabled servers
- `mcpIntegration.initialize()` also connects enabled servers

This produces duplicate process starts, reconnect churn, and unstable runtime state.

### 3. Runtime lifecycle is not synchronized with settings changes

Server deletion and disable flows update persisted config, but do not guarantee runtime disconnect. Editing an enabled server may reconnect, but disabling one does not reliably stop it first. This can leave stale clients in memory and stdio child processes alive after the UI says a server is gone or disabled.

### 4. Connection tests are destructive and misleading

The settings "test all" flow uses reconnect logic instead of a non-destructive test path. That means an active server can be disconnected during a test. Because the UI uses `Promise.allSettled`, errors are swallowed and the success message is overly optimistic.

## Design Overview

The implementation will keep the existing `MCPClient` and `MCPServerManager` split, but assign clearer responsibilities:

- Rust backend owns stdio process I/O and standard MCP framing
- `MCPClient` owns protocol requests for one configured server
- `MCPServerManager` becomes the single lifecycle coordinator for connect, disconnect, reconnect, and test actions
- The Zustand store remains responsible for persisted config and UI-visible runtime state, but it does not independently start background connections
- App startup uses one initialization path only

## Architecture

### Transport layer

The Rust Tauri commands in `src-tauri/src/mcp.rs` will be updated to:

- Write outgoing requests as `Content-Length: <bytes>\r\n\r\n<body>`
- Read incoming framed messages from stdout until a full body is available
- Parse headers robustly and reject malformed frames with actionable errors

The existing process map remains in place for this iteration, but message read/write behavior becomes protocol-correct. The manager keeps one child process per MCP stdio server.

### Initialization and lifecycle

`initMcp()` will initialize MCP exactly once:

- Load saved config into the store
- Ask `MCPServerManager` to connect enabled servers

`useMcpStore.initMcpData()` will stop performing delayed background auto-connects. That prevents duplicate startup behavior and keeps the store side-effect free.

### Settings-driven connection management

Settings actions will become explicit lifecycle operations:

- Saving an enabled new or edited server connects it once through the manager
- Disabling a server disconnects it immediately and clears stale runtime state
- Deleting a server disconnects it before removing config
- Editing an already connected server reconnects with the new config

This keeps UI state, in-memory client state, and Rust child process state aligned.

### Non-destructive testing

Connection testing will use dedicated test flows:

- HTTP server test remains an HTTP reachability/protocol probe
- stdio server test uses a temporary `MCPClient` instance with a temporary server ID and tears it down after initialization
- "Test all" aggregates per-server results and reports partial failures accurately
- Tests must not interrupt already connected servers

## File-Level Changes

### Rust backend

- `src-tauri/src/mcp.rs`
  - Add helpers for framed MCP stdio write/read
  - Refactor `send_mcp_message` to use framed transport
  - Keep process management logic, but reduce protocol assumptions

### Client and lifecycle

- `src/lib/mcp/client.ts`
  - Keep request interface stable
  - Adjust stdio error handling for framed transport responses
- `src/lib/mcp/server-manager.ts`
  - Centralize lifecycle actions
  - Add idempotent connect behavior
  - Add non-destructive batch test summary helper if useful
- `src/lib/mcp/init.ts`
  - Remove duplicate initialization path
- `src/lib/mcp/integration.ts`
  - Keep as thin wrapper or simplify usage if redundant after initialization cleanup

### Store

- `src/stores/mcp.ts`
  - Remove delayed auto-connect side effect from `initMcpData`
  - Add cleanup-aware delete/disable helpers, or ensure callers do disconnect before persistence updates

### Settings UI

- `src/app/core/setting/mcp/server-list.tsx`
  - Make "test all" use non-destructive tests
  - Surface accurate success/failure summary
- `src/app/core/setting/mcp/server-config-dialog.tsx`
  - On save, reconnect only when needed
  - On disable while editing, disconnect active server
- `src/app/core/setting/mcp/json-import-dialog.tsx`
  - Continue auto-connect for enabled imports, but through the manager only once

## Error Handling

The new behavior should make these cases explicit:

- Invalid stdio frame from server: report protocol error and mark server state as error
- Server startup failure: preserve store config, set runtime error state, do not leave partial client in map
- Batch test partial failure: show completion with counts rather than unconditional success
- Disable/delete during stale runtime state: disconnect best-effort, then persist removal and clear runtime state

## Testing Strategy

### Rust

Add unit tests around framing helpers in `src-tauri/src/mcp.rs` for:

- Writing correct `Content-Length` frames
- Reading a single valid framed message
- Rejecting malformed headers
- Rejecting truncated bodies

### TypeScript

Add focused tests for lifecycle logic where practical:

- Initialization connects enabled servers once
- Disabling or deleting a server disconnects it
- Batch test summary reports fulfilled and failed servers correctly

If the current repo lacks a formal frontend unit-test harness, keep logic isolated enough to verify through targeted function-level coverage later and rely on command verification for this iteration.

### Verification

Minimum verification for this iteration:

- `cargo test`
- `pnpm lint` if runnable from the worktree context

If lint remains blocked by the nested-worktree ESLint config conflict, note it as an environmental limitation and rely on Rust tests plus focused code review for this pass.

## Risks and Mitigations

### Risk: framed stdio parsing can deadlock

Mitigation:

- Keep implementation strict and minimal
- Read exactly the advertised body length
- Return explicit errors for EOF or malformed headers

### Risk: lifecycle changes can regress current settings UX

Mitigation:

- Keep external UI behavior the same where possible
- Change only the underlying connect/disconnect semantics
- Verify save, disable, delete, and test-all flows manually in code paths

### Risk: existing MCP integration wrapper becomes partially redundant

Mitigation:

- Avoid broad deletion in this pass
- Keep wrapper intact unless cleanup is trivial and low-risk

## Success Criteria

This work is successful when:

- Standard MCP stdio framing is implemented correctly
- App startup connects enabled MCP servers once, not multiple times
- Disabling or deleting a server stops its runtime connection and clears state
- "Test all" no longer reconnects active servers and reports failures accurately
