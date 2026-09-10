# `@notegen/plugin-api`

UI lifecycle: forms retain values by field ID until removed, closed, or explicitly
reset with a new `resetKey`. `ui.openDialog(options)` returns `{ id }`;
`ui.closeDialog(id)` only closes that instance. To replace an existing dialog,
pass its ID as `replaceId`. Another plugin's dialog cannot be replaced.
`ui.onDidCloseDialog` reports `{ id, reason }`. Form commands inside dialogs
also receive `dialogId` alongside `formId` and `values`; capture it before
awaiting work so a stale submission cannot close a newer dialog.

> Bootstrap mirror: the independent `codexu/note-gen-plugin-sdk` repository is
> the source of truth for this package. This private workspace copy exists only
> to keep the NoteGen feature branch installable before the first npm release.
> Do not publish or develop the contract from this directory. Delete it when
> NoteGen switches to the registry package.

The public TypeScript contract for NoteGen plugins. It contains the manifest,
permission, contribution, lifecycle, and runtime context types implemented by
NoteGen's plugin host. The package has no runtime dependencies and does not
require DOM types.

> Distribution status: the first npm release is not part of this change. The
> install command below becomes available after that release is published.

## Install

```bash
pnpm add -D @notegen/plugin-api
```

Use a type-only import so the import is removed from the generated plugin entry:

```ts
import type { PluginActivate } from '@notegen/plugin-api'

export const activate: PluginActivate = async (context) => {
  context.commands.handle('com.example.hello.open', async () => {
    await context.ui.showNotice('Hello from NoteGen')
  })
}
```

The current community runtime loads one self-contained ESM entry file. It does
not resolve package imports at runtime, so any non-type imports must be bundled
into that entry before packaging the plugin.

Values crossing the runtime boundary use `PluginJsonValue`. Command arguments
and results, storage values, and declarative UI action arguments therefore use
finite JSON-compatible data rather than class instances or cyclic objects.

Set the plugin manifest's `apiVersion` to a SemVer range compatible with the
exported `PLUGIN_API_VERSION`. NoteGen currently implements API `0.1.0`, so a
typical v1 plugin uses `"apiVersion": "^0.1.0"`.

Plugins using the new forms, tables, trees, editor-area tabs, view lifecycle,
source-range editing, saved-note search, or attachment APIs must require
`"apiVersion": "^0.1.0"`. Range edits currently require source mode. Attachment
reads and creation need separate permissions and are capped at 1 MiB decoded.

See the [NoteGen plugin documentation](https://notegen.top/en/docs/plugins/developers/plugin-api)
for the full development, permission, packaging, and publishing guides.

This package is licensed under MIT independently of the NoteGen application.

## Local diagnostics and folder permission bindings

`context.log.info/warning/error(message)` writes local diagnostics. The QuickJS
host truncates messages to 1,000 characters and drops entries beyond 50 per
10 seconds. Use `error.stack` explicitly when a stack trace helps; do not log
credentials or note contents. The developer panel can export its filtered log.
The in-process test host records these calls but does not emulate the quota.

One `string` setting with `scope: "workspace"` may declare
`permissionPaths: ["notes.create", "notes.open"]`. Each listed permission must
be declared, required, unique and use `workspace-folder` scope (at most 20).
The permission dialog uses the setting's fixed folder prefix, lets the user
choose another folder, and preserves `{{...}}` date subfolders. This is a UI
suggestion only: permissions still require explicit user approval. Plugins
without this declaration use the normal per-permission inputs.

Production KV storage now follows the installed package content fingerprint.
A new package starts with a copy of the current package's data; rollback returns
to the old data branch. Reinstalling an existing fingerprint reuses its branch.
This does not roll back note writes, attachments, settings or remote effects.
Use explicit data schema versions and idempotent migration steps. The test host
does not simulate package installation or versioned storage.
