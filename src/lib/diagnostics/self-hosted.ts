import { getDb, initAllDatabases } from '@/db'

export interface SelfHostedDiagnosticSummary {
  available: boolean
  diagnosticError: string | null
  configured: boolean
  profileState: string | null
  bindingStates: Record<string, number>
  pendingSend: number
  pendingReceive: number
  unresolvedConflicts: number
  recentErrorCode: string | null
}

const EMPTY_SUMMARY: SelfHostedDiagnosticSummary = {
  available: false,
  diagnosticError: 'self-hosted-diagnostics-unavailable',
  configured: false,
  profileState: null,
  bindingStates: {},
  pendingSend: 0,
  pendingReceive: 0,
  unresolvedConflicts: 0,
  recentErrorCode: null,
}

interface CountRow {
  count: number
}

interface StateCountRow extends CountRow {
  state: string
}

export async function hasConfiguredSelfHostedSync(): Promise<boolean> {
  try {
    await initAllDatabases()
    const database = await getDb()
    const rows = await database.select<CountRow[]>(
      'select count(*) as count from self_hosted_sync_profiles',
    )
    return Number(rows[0]?.count ?? 0) > 0
  } catch {
    return false
  }
}

export async function getSelfHostedDiagnosticSummary(): Promise<SelfHostedDiagnosticSummary> {
  try {
    await initAllDatabases()
    const database = await getDb()
    const [profiles, bindings, pendingChanges, pendingOutbox, pendingInbox, conflicts, outboxError, inboxError] = await Promise.all([
      database.select<Array<{ state: string }>>(
        'select state from self_hosted_sync_profiles order by updated_at desc limit 1',
      ),
      database.select<StateCountRow[]>(
        'select binding_state as state, count(*) as count from self_hosted_workspace_bindings group by binding_state',
      ),
      database.select<CountRow[]>(
        "select count(*) as count from self_hosted_local_changes where state = 'pending'",
      ),
      database.select<CountRow[]>(
        "select count(*) as count from self_hosted_outbox where state in ('pending', 'retry', 'blocked')",
      ),
      database.select<CountRow[]>(
        "select count(*) as count from self_hosted_inbox where state in ('pending', 'failed')",
      ),
      database.select<CountRow[]>(
        "select count(*) as count from self_hosted_conflicts where state = 'unresolved'",
      ),
      database.select<Array<{ code: string | null }>>(
        'select last_error_code as code from self_hosted_outbox where last_error_code is not null order by updated_at desc limit 1',
      ),
      database.select<Array<{ code: string | null }>>(
        'select error_code as code from self_hosted_inbox where error_code is not null order by received_at desc limit 1',
      ),
    ])

    return {
      available: true,
      diagnosticError: null,
      configured: profiles.length > 0,
      profileState: profiles[0]?.state ?? null,
      bindingStates: Object.fromEntries(bindings.map(row => [row.state, Number(row.count)])),
      pendingSend: Number(pendingChanges[0]?.count ?? 0) + Number(pendingOutbox[0]?.count ?? 0),
      pendingReceive: Number(pendingInbox[0]?.count ?? 0),
      unresolvedConflicts: Number(conflicts[0]?.count ?? 0),
      recentErrorCode: outboxError[0]?.code ?? inboxError[0]?.code ?? null,
    }
  } catch {
    return { ...EMPTY_SUMMARY }
  }
}
