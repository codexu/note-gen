import type { SyncObjectKind } from './protocol'

const DOMAIN_TOGGLES: Record<string, string> = {
  tag: 'tags', mark: 'marks', note: 'marks', canvas: 'marks',
  conversation: 'conversations', message: 'messages', memory: 'memories',
  setting: 'settings', asset: 'attachments',
}

/** A child cannot be transferred safely while its device-local references are paused. */
export function isDomainEnabled(domain: string, toggles: Record<string, boolean>) {
  const toggle = DOMAIN_TOGGLES[domain]
  if (toggle && toggles[toggle] === false) return false
  if (['mark', 'note', 'canvas', 'message'].includes(domain) && toggles.tags === false) return false
  if (domain === 'message' && toggles.conversations === false) return false
  return true
}

export function isPersonalSyncKindEnabled(
  kind: string,
  toggles: Record<string, boolean>,
  deleting = false,
) {
  if (!(kind in DOMAIN_TOGGLES) || !isDomainEnabled(kind, toggles)) return false
  // Applying a parent tombstone also changes its children in the local database.
  // Preserve paused domains and replay the deletion when those domains resume.
  if (deleting && kind === 'tag') {
    return isDomainEnabled('mark', toggles) && isDomainEnabled('message', toggles)
  }
  if (deleting && kind === 'conversation') return isDomainEnabled('message', toggles)
  return true
}

export function enabledPersonalSyncKinds(toggles: Record<string, boolean>, deleting = false): SyncObjectKind[] {
  return Object.keys(DOMAIN_TOGGLES).filter(kind => (
    isPersonalSyncKindEnabled(kind, toggles, deleting)
  )) as SyncObjectKind[]
}
