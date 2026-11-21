export const OFFICIAL_SYNC_ORIGIN = 'https://sync.notegen.top'
const OFFICIAL_SYNC_WEBSOCKET_ORIGIN = OFFICIAL_SYNC_ORIGIN.replace(/^https:/, 'wss:')

export function isOfficialSyncOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === OFFICIAL_SYNC_ORIGIN && !url.username && !url.password
  } catch {
    return false
  }
}

export function isOfficialSyncWebSocketUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'wss:' && url.origin === OFFICIAL_SYNC_WEBSOCKET_ORIGIN && !url.username && !url.password
  } catch {
    return false
  }
}
