const pendingPreparations = new Map<string, Promise<void>>()

/** Serialize mapping/outbox preparation, independently of the runtime sender.
 * Never await runtime.wake while holding this lock: wake materializes outbox. */
export function withSelfHostedPrepareLock<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingPreparations.get(workspaceId) || Promise.resolve()
  const result = previous.then(operation, operation)
  const settled = result.then(() => undefined, () => undefined)
  pendingPreparations.set(workspaceId, settled)
  void settled.then(() => {
    if (pendingPreparations.get(workspaceId) === settled) pendingPreparations.delete(workspaceId)
  })
  return result
}
