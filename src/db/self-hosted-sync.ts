import { executeRecordTransaction, getDb, type RecordStatement } from './index'
import { appDataDir, join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { copyFile, exists, lstat, mkdir } from '@tauri-apps/plugin-fs'
import { ensureWorkspaceDirectory, managedWorkspaceLocation, normalizeManagedWorkspacePath, resolveManagedWorkspacePath } from '@/lib/managed-workspace'

const SYNC_TABLES = `
  create table if not exists self_hosted_sync_profiles (
    id text primary key,
    server_url text not null,
    instance_id text,
    account_id text,
    device_id text,
    access_expires_at integer,
    state text not null default 'disconnected',
    insecure_http integer not null default 0,
    domain_toggles text not null default '{}',
    created_at integer not null,
    updated_at integer not null
  );

  create unique index if not exists idx_self_hosted_sync_profiles_server
    on self_hosted_sync_profiles(server_url);

  create table if not exists self_hosted_workspace_bindings (
    workspace_id text primary key,
    profile_id text not null references self_hosted_sync_profiles(id) on delete cascade,
    workspace_type text not null check(workspace_type in ('account-data', 'library')),
    local_root text,
    binding_state text not null default 'pending',
    access_mode text not null default 'read-write',
    sync_epoch text,
    bootstrap_id text,
    created_at integer not null,
    updated_at integer not null
  );

  create unique index if not exists idx_self_hosted_workspace_bindings_root
    on self_hosted_workspace_bindings(local_root) where local_root is not null;

  create table if not exists self_hosted_workspace_names (
    workspace_id text primary key references self_hosted_workspace_bindings(workspace_id) on delete cascade,
    name_ciphertext text not null,
    key_version integer not null
  );

  create table if not exists self_hosted_workspace_keys (
    workspace_id text not null references self_hosted_workspace_bindings(workspace_id) on delete cascade,
    key_version integer not null,
    secure_storage_key text not null,
    created_at integer not null,
    primary key(workspace_id, key_version)
  );

  create table if not exists self_hosted_object_mappings (
    workspace_id text not null references self_hosted_workspace_bindings(workspace_id) on delete cascade,
    object_id text not null,
    kind text not null,
    local_identity text not null,
    relative_path text,
    path_casefold text,
    content_hash text,
    blob_refs text not null default '[]',
    deleted_at integer,
    updated_at integer not null,
    primary key(workspace_id, object_id),
    unique(workspace_id, kind, local_identity)
  );

  create unique index if not exists idx_self_hosted_object_mapping_path
    on self_hosted_object_mappings(workspace_id, path_casefold)
    where path_casefold is not null and deleted_at is null;

  create table if not exists self_hosted_tag_identities (
    local_tag_id integer primary key,
    stable_id text not null unique
  );

  create table if not exists self_hosted_revisions (
    workspace_id text not null,
    object_id text not null,
    revision text not null,
    sequence text not null,
    content_hash text not null,
    snapshot text,
    created_at integer not null,
    primary key(workspace_id, object_id, revision)
  );

  create table if not exists self_hosted_local_changes (
    id integer primary key autoincrement,
    workspace_id text,
    domain text not null,
    local_key text not null,
    operation text not null check(operation in ('upsert', 'delete')),
    reason text not null,
    state text not null default 'pending',
    attempt_count integer not null default 0,
    next_attempt_at integer not null default 0,
    last_error_code text,
    created_at integer not null,
    updated_at integer not null
  );

  create index if not exists idx_self_hosted_local_changes_pending
    on self_hosted_local_changes(state, domain, local_key, id);

  create table if not exists self_hosted_outbox (
    command_id text primary key,
    workspace_id text not null,
    source_change_ids text not null,
    command_type text not null,
    payload text not null,
    state text not null default 'pending',
    attempt_count integer not null default 0,
    next_attempt_at integer not null default 0,
    last_error_code text,
    restore_local_snapshot integer not null default 0,
    created_at integer not null,
    updated_at integer not null
  );

  create index if not exists idx_self_hosted_outbox_pending
    on self_hosted_outbox(state, next_attempt_at, created_at);

  create table if not exists self_hosted_inbox (
    workspace_id text not null,
    event_id text not null,
    sequence text not null,
    payload text not null,
    state text not null default 'pending',
    received_at integer not null,
    applied_at integer,
    error_code text,
    primary key(workspace_id, event_id),
    unique(workspace_id, sequence)
  );

  create index if not exists idx_self_hosted_inbox_pending
    on self_hosted_inbox(workspace_id, state, received_at);

  create table if not exists self_hosted_cursors (
    workspace_id text primary key,
    pulled_sequence text not null default '0',
    applied_sequence text not null default '0',
    acknowledged_sequence text not null default '0',
    updated_at integer not null
  );

  create table if not exists self_hosted_conflicts (
    id text primary key,
    workspace_id text not null,
    object_id text,
    conflict_type text not null,
    local_snapshot text,
    remote_snapshot text,
    base_snapshot text,
    local_copy_path text,
    state text not null default 'unresolved',
    created_at integer not null,
    resolved_at integer
  );

  create index if not exists idx_self_hosted_conflicts_open
    on self_hosted_conflicts(state, created_at);

  create table if not exists self_hosted_blob_uploads (
    workspace_id text not null,
    blob_id text not null,
    upload_id text,
    local_path text not null,
    expected_size text not null,
    ciphertext_hash text not null,
    uploaded_parts text not null default '[]',
    state text not null default 'pending',
    expires_at integer,
    updated_at integer not null,
    primary key(workspace_id, blob_id)
  );

  create table if not exists self_hosted_file_journal (
    id integer primary key autoincrement,
    workspace_id text not null,
    operation text not null,
    object_id text,
    source_path text,
    target_path text,
    temp_path text,
    expected_hash text,
    state text not null default 'prepared',
    error_code text,
    created_at integer not null,
    updated_at integer not null
  );

  create index if not exists idx_self_hosted_file_journal_recovery
    on self_hosted_file_journal(state, created_at);

  create table if not exists self_hosted_remote_objects (
    workspace_id text not null,
    object_id text not null,
    kind text not null,
    revision text not null,
    payload text not null,
    updated_at integer not null,
    primary key(workspace_id, object_id)
  );

  create table if not exists self_hosted_yjs_updates (
    workspace_id text not null,
    document_id text not null,
    document_sequence text not null,
    object_id text,
    key_version integer,
    event_type text not null default 'update',
    update_id text,
    payload text not null,
    applied integer not null default 0,
    created_at integer not null,
    primary key(workspace_id, document_id, document_sequence)
  );

  create table if not exists self_hosted_sync_context (
    id integer primary key check(id = 1),
    suppress_triggers integer not null default 0
  );

  insert or ignore into self_hosted_sync_context(id, suppress_triggers) values (1, 0);
`

const TRIGGER_DOMAINS = [
  { table: 'tags', domain: 'tag', key: 'cast(NEW.id as text)', oldKey: 'cast(OLD.id as text)' },
  {
    table: 'marks', domain: 'mark',
    key: "coalesce(NEW.sourceId, cast(NEW.id as text))",
    oldKey: "coalesce(OLD.sourceId, cast(OLD.id as text))",
    updateOperation: "case when NEW.deleted = 1 then 'delete' else 'upsert' end",
  },
  { table: 'conversations', domain: 'conversation', key: "coalesce(NEW.syncId, cast(NEW.id as text))", oldKey: "coalesce(OLD.syncId, cast(OLD.id as text))" },
  { table: 'chats', domain: 'message', key: "coalesce(NEW.syncId, cast(NEW.id as text))", oldKey: "coalesce(OLD.syncId, cast(OLD.id as text))" },
  { table: 'memories', domain: 'memory', key: 'NEW.id', oldKey: 'OLD.id' },
] as const

async function preservePendingWorkspaceFiles(workspaceId: string, sourceRoot: string, targetRoot: string) {
  const pending = await (await getDb()).select<Array<{ path: string; domain: string }>>(
    `select local_key as path, domain from self_hosted_local_changes
     where id in (
       select max(id) from self_hosted_local_changes
       where workspace_id = $1 and state = 'pending' and domain in ('file', 'asset', 'folder')
       group by domain, local_key
     ) and operation = 'upsert'`, [workspaceId],
  )
  if (!pending.length) return
  await ensureWorkspaceDirectory(sourceRoot)
  await ensureWorkspaceDirectory(targetRoot)
  for (const change of pending) {
    const portable = await invoke<{ normalized: string }>('self_hosted_portable_path', { relativePath: change.path })
    let source = sourceRoot
    let missing = false
    for (const segment of portable.normalized.split('/')) {
      source = await join(source, segment)
      if (!await exists(source)) { missing = true; break }
      if ((await lstat(source)).isSymlink) throw new Error('Symbolic-link workspace files are not synchronized')
    }
    if (missing) continue
    const segments = portable.normalized.split('/')
    const target = await join(targetRoot, ...segments)
    if (change.domain === 'folder') await mkdir(target, { recursive: true })
    else {
      await mkdir(await join(targetRoot, ...segments.slice(0, -1)), { recursive: true })
      await copyFile(source, target)
    }
  }
}

/** Rebase device-local paths together, including collisions left by older iOS containers. */
export async function restoreSelfHostedWorkspaceRoots() {
  const database = await getDb()
  const rows = await database.select<Array<{
    workspaceId: string; localRoot: string; bindingState: string; profileState: string
  }>>(
    `select b.workspace_id as workspaceId, b.local_root as localRoot,
       b.binding_state as bindingState, p.state as profileState
     from self_hosted_workspace_bindings b
     join self_hosted_sync_profiles p on p.id = b.profile_id
     where b.workspace_type = 'library' and b.local_root is not null
     order by b.created_at`,
  )
  const plans = await Promise.all(rows.map(async row => {
    const location = await managedWorkspaceLocation(row.localRoot)
    const root = await resolveManagedWorkspacePath(row.localRoot)
    const active = row.profileState === 'connected'
      && ['bound', 'bootstrapping', 'epoch-changed'].includes(row.bindingState)
    const leaf = location?.split('/').at(-1) ?? ''
    const suffix = leaf.match(/--([a-f0-9]{8}(?:[a-f0-9]{4}){0,6})$/i)?.[1]
    const ownsDirectory = leaf.toLowerCase() === row.workspaceId.toLowerCase()
      || Boolean(suffix && row.workspaceId.replace(/-/g, '').toLowerCase().startsWith(suffix.toLowerCase()))
    return { ...row, root: root as string | null, location, active,
      priority: (active ? 100 : 0) + (ownsDirectory ? 10 : 0) }
  }))
  const groups = new Map<string, typeof plans>()
  for (const plan of plans) {
    const key = normalizeManagedWorkspacePath(plan.root!)
    const group = groups.get(key) ?? []
    group.push(plan)
    groups.set(key, group)
  }
  const reserved = new Set(groups.keys())
  for (const group of groups.values()) {
    if (group.length < 2 || !group.some(plan => plan.location !== null)) continue
    group.sort((a, b) => b.priority - a.priority)
    for (const plan of group.slice(1)) {
      if (!plan.active) {
        // Old revoked/disconnected bindings must not reserve the live container.
        plan.root = null
        continue
      }
      // Keep the original directory with its owner. An accidentally aliased
      // workspace receives a separate replica and an authoritative bootstrap.
      let root = await join(await appDataDir(), 'workspaces', 'self-hosted', plan.workspaceId)
      if (reserved.has(normalizeManagedWorkspacePath(root)) || await exists(root)) {
        root = await join(await appDataDir(), 'restored-workspaces', `self-hosted-${Date.now()}-${crypto.randomUUID()}`)
      }
      reserved.add(normalizeManagedWorkspacePath(root))
      await preservePendingWorkspaceFiles(plan.workspaceId, group[0].root!, root)
      plan.root = root
      plan.bindingState = 'epoch-changed'
    }
  }
  const changed = plans.filter(plan => plan.root !== plan.localRoot
    || plan.bindingState !== rows.find(row => row.workspaceId === plan.workspaceId)?.bindingState)
  if (!changed.length) return
  const now = Date.now()
  const statements: RecordStatement[] = []
  // Release every affected unique key before claiming canonical paths. This
  // also handles swaps; either the complete repair commits or none of it does.
  for (const plan of changed) statements.push({
    sql: 'update self_hosted_workspace_bindings set local_root = null where workspace_id = $1 and local_root = $2',
    values: [plan.workspaceId, plan.localRoot], expectedRows: 1,
  })
  for (const plan of changed) statements.push({
    sql: 'update self_hosted_workspace_bindings set local_root = $1, binding_state = $2, updated_at = $3 where workspace_id = $4 and local_root is null',
    values: [plan.root, plan.bindingState, now, plan.workspaceId], expectedRows: 1,
  })
  await executeRecordTransaction(statements)
}

export async function initSelfHostedSyncDb() {
  const database = await getDb()
  for (const statement of SYNC_TABLES.split(';').map(value => value.trim()).filter(Boolean)) {
    await database.execute(statement)
  }
  await database.execute(
    `create index if not exists idx_self_hosted_local_changes_pending
     on self_hosted_local_changes(state, workspace_id, domain, local_key, id)`
  )
  await database.execute(
    `create index if not exists idx_self_hosted_outbox_ready
     on self_hosted_outbox(workspace_id, state, next_attempt_at, created_at)`
  )
  const localChangeColumns = await database.select<Array<{ name: string }>>(
    'pragma table_info(self_hosted_local_changes)'
  )
  const profileColumns = await database.select<Array<{ name: string }>>(
    'pragma table_info(self_hosted_sync_profiles)'
  )
  const outboxColumns = await database.select<Array<{ name: string }>>('pragma table_info(self_hosted_outbox)')
  if (!outboxColumns.some(column => column.name === 'restore_local_snapshot')) {
    await database.execute('alter table self_hosted_outbox add column restore_local_snapshot integer not null default 0')
  }
  if (!profileColumns.some(column => column.name === 'access_expires_at')) {
    await database.execute('alter table self_hosted_sync_profiles add column access_expires_at integer')
  }
  if (!localChangeColumns.some(column => column.name === 'workspace_id')) {
    await database.execute('alter table self_hosted_local_changes add column workspace_id text')
  }
  for (const [name, definition] of [
    ['attempt_count', 'integer not null default 0'],
    ['next_attempt_at', 'integer not null default 0'],
    ['last_error_code', 'text'],
  ] as const) {
    if (!localChangeColumns.some(column => column.name === name)) {
      await database.execute(`alter table self_hosted_local_changes add column ${name} ${definition}`)
    }
  }
  await database.execute(`create index if not exists idx_self_hosted_local_changes_retry
    on self_hosted_local_changes(state, workspace_id, next_attempt_at, attempt_count, id)`)
  await database.execute(`
    insert or ignore into self_hosted_tag_identities(local_tag_id, stable_id)
    select id, lower(hex(randomblob(16))) from tags
  `)
  await database.execute(`
    create trigger if not exists self_hosted_tag_identity_insert after insert on tags
    begin
      insert or ignore into self_hosted_tag_identities(local_tag_id, stable_id)
      values (NEW.id, lower(hex(randomblob(16))));
    end
  `)
  await database.execute(`
    create trigger if not exists self_hosted_tag_identity_delete after delete on tags
    begin delete from self_hosted_tag_identities where local_tag_id = OLD.id; end
  `)
  const mappingColumns = await database.select<Array<{ name: string }>>(
    'pragma table_info(self_hosted_object_mappings)'
  )
  if (!mappingColumns.some(column => column.name === 'blob_refs')) {
    await database.execute("alter table self_hosted_object_mappings add column blob_refs text not null default '[]'")
  }
  const yjsColumns = await database.select<Array<{ name: string }>>(
    'pragma table_info(self_hosted_yjs_updates)'
  )
  for (const [name, definition] of [
    ['object_id', 'text'], ['key_version', 'integer'], ['event_type', "text not null default 'update'"],
  ] as const) {
    if (!yjsColumns.some(column => column.name === name)) {
      await database.execute(`alter table self_hosted_yjs_updates add column ${name} ${definition}`)
    }
  }
  for (const operation of ['insert', 'update', 'delete']) {
    await database.execute(`drop trigger if exists self_hosted_canvases_${operation}`)
    await database.execute(`drop trigger if exists self_hosted_notes_${operation}`)
  }

  await restoreSelfHostedWorkspaceRoots()
  await migrateUnsyncedMarkIdentities(database)

  for (const trigger of TRIGGER_DOMAINS) {
    const updateOperation = 'updateOperation' in trigger ? trigger.updateOperation : "'upsert'"
    for (const operation of ['insert', 'update', 'delete']) {
      await database.execute(`drop trigger if exists self_hosted_${trigger.table}_${operation}`)
    }
    await database.execute(`
      create trigger if not exists self_hosted_${trigger.table}_insert
      after insert on ${trigger.table}
      when (select suppress_triggers from self_hosted_sync_context where id = 1) = 0
      begin
        insert into self_hosted_local_changes(domain, local_key, operation, reason, created_at, updated_at)
        values ('${trigger.domain}', ${trigger.key}, 'upsert', '${trigger.table}:insert', cast((julianday('now') - 2440587.5) * 86400000 as integer), cast((julianday('now') - 2440587.5) * 86400000 as integer));
      end
    `)
    await database.execute(`
      create trigger if not exists self_hosted_${trigger.table}_update
      after update on ${trigger.table}
      when (select suppress_triggers from self_hosted_sync_context where id = 1) = 0
      begin
        insert into self_hosted_local_changes(domain, local_key, operation, reason, created_at, updated_at)
        values ('${trigger.domain}', ${trigger.key}, ${updateOperation}, '${trigger.table}:update', cast((julianday('now') - 2440587.5) * 86400000 as integer), cast((julianday('now') - 2440587.5) * 86400000 as integer));
      end
    `)
    await database.execute(`
      create trigger if not exists self_hosted_${trigger.table}_delete
      after delete on ${trigger.table}
      when (select suppress_triggers from self_hosted_sync_context where id = 1) = 0
      begin
        insert into self_hosted_local_changes(domain, local_key, operation, reason, created_at, updated_at)
        values ('${trigger.domain}', ${trigger.oldKey}, 'delete', '${trigger.table}:delete', cast((julianday('now') - 2440587.5) * 86400000 as integer), cast((julianday('now') - 2440587.5) * 86400000 as integer));
      end
    `)
  }
}

async function migrateUnsyncedMarkIdentities(database: Awaited<ReturnType<typeof getDb>>) {
  const marks = await database.select<Array<{ id: number }>>(
    `select m.id from marks m
     where m.deleted = 0 and m.sourceId is null
       and exists (
         select 1 from self_hosted_local_changes c
         where c.domain = 'mark' and c.local_key = cast(m.id as text)
           and c.state = 'pending'
       )
       and not exists (
         select 1 from self_hosted_object_mappings mapping
         where mapping.kind = 'mark'
           and mapping.local_identity = 'mark:' || cast(m.id as text)
           and mapping.deleted_at is null
       )`,
  )
  if (marks.length === 0) return
  await database.execute('update self_hosted_sync_context set suppress_triggers = 1 where id = 1')
  try {
    for (const mark of marks) {
      const sourceId = crypto.randomUUID()
      await database.execute('update marks set sourceId = $1 where id = $2', [sourceId, mark.id])
      await database.execute(
        `update self_hosted_local_changes set local_key = $1, updated_at = $2
         where domain = 'mark' and local_key = $3 and state = 'pending'`,
        [sourceId, Date.now(), String(mark.id)],
      )
    }
  } finally {
    await database.execute('update self_hosted_sync_context set suppress_triggers = 0 where id = 1')
  }
}

export async function enqueueSelfHostedSettingChange(settingKey: string) {
  const database = await getDb()
  const now = Date.now()
  await database.execute(
    `insert into self_hosted_local_changes(domain, local_key, operation, reason, created_at, updated_at)
     values ('setting', 'all', 'upsert', $1, $2, $2)`,
    [`setting:${settingKey}`, now]
  )
}
