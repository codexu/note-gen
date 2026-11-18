import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AGENT_SCHEMA, AGENT_SCHEMA_ROLLBACK, rollbackAgentSchema, type RollbackDb } from './schema'
import { createAgentSettings, getAgentSettings, listAgentSettings, listAgentToolRefusals, recordAgentToolRefusal, updateAgentSettings } from '@/db/agents'
import { initAgentTaskDb, listAgentTasks, saveAgentTask } from '@/db/agent-tasks'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    all(bindings: Bindings): unknown[]
    run(bindings: Bindings): { changes: number }
  }
  close(): void
}

// Node 24 (CI) ships SQLite. The repository still uses Node 20 type declarations.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null>) =>
  Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

vi.mock('@/db/index', () => ({
  getDb: async () => ({
    execute: async (sql: string, values: Array<string | number | null> = []) =>
      ({ rowsAffected: sqlite.prepare(sql).run(bind(values)).changes }),
    select: async (sql: string, values: Array<string | number | null> = []) =>
      sqlite.prepare(sql).all(bind(values)),
  }),
}))

afterAll(() => sqlite.close())

describe('P5 SQLite schema and settings', () => {
  it('upgrades an existing task DB, persists settings and refusals, and rolls back only P5 data', async () => {
    await initAgentTaskDb()
    const report = { id: 'old', kind: 'report', status: 'completed', title: 'Weekly', prompt: 'Report',
      drafts: [], tokens: 4, createdAt: 1, updatedAt: 2 } as const
    await saveAgentTask({ ...report, drafts: [] })
    const before = await listAgentTasks()

    expect(await listAgentSettings()).toEqual([])
    const id = await createAgentSettings({
      name: ' Organizer ', role: 'organizer', enabled: true,
      allowedTools: ['note_read_file', 'note_create_file', 'note_read_file'],
    })
    const created = await getAgentSettings(id)
    expect(created).toMatchObject({
      id, name: 'Organizer', role: 'organizer', enabled: true,
      allowedTools: ['note_read_file', 'note_create_file'],
    })
    await updateAgentSettings(id, { name: 'Organizer 2', role: 'custom', enabled: false, allowedTools: [] })
    expect(await listAgentSettings()).toEqual([
      expect.objectContaining({ id, name: 'Organizer 2', role: 'custom', enabled: false, allowedTools: [], createdAt: created?.createdAt }),
    ])
    await expect(updateAgentSettings('missing', { name: 'A', role: 'custom', enabled: true, allowedTools: [] }))
      .rejects.toThrow('AGENT_NOT_FOUND')

    await saveAgentTask({ ...before[0], id: 'p5', kind: `agent:${id}` })
    const refusal = { agentId: id, taskId: 'p5', toolName: 'note_delete_file', reason: 'not_granted', createdAt: 3 } as const
    await recordAgentToolRefusal(refusal)
    expect(await listAgentToolRefusals('p5')).toEqual([refusal])
    expect(await listAgentToolRefusals('old')).toEqual([])

    sqlite.exec(AGENT_SCHEMA.join(';\n'))
    expect(await listAgentToolRefusals('p5')).toEqual([refusal])
    expect(await getAgentSettings(id)).toMatchObject({ enabled: false })

    sqlite.exec(`begin;\n${AGENT_SCHEMA_ROLLBACK.join(';\n')};\ncommit;`)
    expect(await listAgentTasks()).toEqual(before)
    expect(sqlite.prepare("select name from sqlite_master where name in ('agent_settings', 'agent_tool_refusals')").all({}))
      .toEqual([])
    sqlite.exec(AGENT_SCHEMA.join(';\n'))
    expect(await listAgentSettings()).toEqual([])
    expect(await listAgentToolRefusals('p5')).toEqual([])
  })

  describe('rollbackAgentSchema (review findings 1, 2)', () => {
    const tasks = () => sqlite.prepare('select id, kind from agent_tasks order by id').all({}) as Array<{ id: string, kind: string }>
    const rollbackDb = (failOn?: string): RollbackDb => ({
      select: async <T,>(sql: string) => sqlite.prepare(sql).all({}) as T,
      execute: async (sql: string) => {
        if (failOn && sql.includes(failOn)) throw new Error('simulated failure')
        sqlite.exec(sql)
      },
    })
    const seed = async (status: string) => {
      sqlite.exec(AGENT_SCHEMA.join(';\n'))
      await initAgentTaskDb()
      sqlite.exec('delete from agent_tasks')
      const base = { title: 't', prompt: 'p', drafts: [], tokens: 0, createdAt: 1, updatedAt: 1 } as const
      await saveAgentTask({ ...base, id: 'a', kind: 'agent:x', status } as never)
      await saveAgentTask({ ...base, id: 'b', kind: 'AGENT:legacy', status: 'completed' } as never)
      await saveAgentTask({ ...base, id: 'c', kind: 'report', status: 'completed' } as never)
    }

    it('refuses while agent drafts await review, unless told to discard them', async () => {
      await seed('awaiting_review')
      await expect(rollbackAgentSchema(rollbackDb())).rejects.toThrow('AGENT_ROLLBACK_PENDING_REVIEW')
      expect(tasks().map(t => t.id)).toEqual(['a', 'b', 'c'])
      await rollbackAgentSchema(rollbackDb(), { discardPendingReview: true })
      expect(tasks().map(t => t.id)).toEqual(['b', 'c'])
    })

    it('only removes lowercase agent: kinds (LIKE would also match AGENT:legacy)', async () => {
      await seed('completed')
      await rollbackAgentSchema(rollbackDb())
      expect(tasks()).toEqual([{ id: 'b', kind: 'AGENT:legacy' }, { id: 'c', kind: 'report' }])
    })

    it('rolls back everything when a statement fails midway', async () => {
      await seed('completed')
      await expect(rollbackAgentSchema(rollbackDb('drop table if exists agent_settings'))).rejects.toThrow('simulated failure')
      expect(tasks().map(t => t.id)).toEqual(['a', 'b', 'c'])
      expect(sqlite.prepare("select name from sqlite_master where name in ('agent_settings', 'agent_tool_refusals') order by name").all({}))
        .toEqual([{ name: 'agent_settings' }, { name: 'agent_tool_refusals' }])
    })
  })
})
