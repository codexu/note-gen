interface PendingWrite {
  paths: string[]
  started: boolean
  start: () => void
}

const pendingWrites = new Map<string, PendingWrite[]>()

function overlaps(left: string[], right: string[]): boolean {
  return left.some(a => right.some(b => !a || !b || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)))
}

function drain(identity: string, writes: PendingWrite[]): void {
  for (let index = 0; index < writes.length; index++) {
    const write = writes[index]
    if (write.started || writes.some((other, otherIndex) => other !== write
      && (other.started || otherIndex < index) && overlaps(write.paths, other.paths))) continue
    write.started = true
    write.start()
  }
  if (!writes.length && pendingWrites.get(identity) === writes) pendingWrites.delete(identity)
}

/** Order writes to one remote target in this JavaScript runtime. Operations
 * must not acquire the workspace path-move journal while holding this lock. */
export async function withRemoteWriteLock<T>(
  identity: string, operation: () => Promise<T>,
): Promise<T> {
  return withRemotePathWriteLock(identity, [''], operation)
}

/** Related paths share a lock, including both roots of a directory move.
 * Unrelated siblings may proceed; queued conflicting work cannot be overtaken. */
export function withRemotePathWriteLock<T>(
  identity: string, paths: string[], operation: () => Promise<T>,
): Promise<T> {
  const normalized = [...new Set(paths.map(path => path.replace(/^\/+|\/+$/g, '')))]
  if (!normalized.length) throw new Error('A remote write requires at least one path')
  const writes = pendingWrites.get(identity) || []
  pendingWrites.set(identity, writes)
  return new Promise<T>((resolve, reject) => {
    const write: PendingWrite = {
      paths: normalized,
      started: false,
      start: () => {
        void Promise.resolve().then(operation).then(resolve, reject).finally(() => {
          writes.splice(writes.indexOf(write), 1)
          drain(identity, writes)
        })
      },
    }
    writes.push(write)
    drain(identity, writes)
  })
}
