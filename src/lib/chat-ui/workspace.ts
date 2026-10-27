/** Stable opaque source identity; do not sync local absolute workspace paths. */
export async function fingerprintWorkspaceIdentity(identity: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
