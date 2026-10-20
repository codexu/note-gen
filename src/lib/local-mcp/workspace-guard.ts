let activeWrites = 0
const waiters = new Set<() => void>()

export function beginLocalMcpWorkspaceWrite(): () => void {
  activeWrites += 1
  let released = false
  return () => {
    if (released) return
    released = true
    activeWrites = Math.max(0, activeWrites - 1)
    if (activeWrites === 0) {
      waiters.forEach(resolve => resolve())
      waiters.clear()
    }
  }
}

export async function waitForLocalMcpWorkspaceWrites(): Promise<void> {
  if (activeWrites === 0) return
  await new Promise<void>(resolve => waiters.add(resolve))
}
