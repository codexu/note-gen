import type {
  PluginErrorCode,
  PluginManifestV1,
  PluginPermissionName,
  PluginPlatform,
  PluginSettingValue,
  PluginStatusBarUpdate,
} from '@notegen/plugin-api'

export type PluginSource = 'marketplace' | 'development'
export type PluginEnablement = 'disabled' | 'workspace' | 'all-workspaces'
export type PluginRuntimeState =
  | 'inactive'
  | 'activating'
  | 'active'
  | 'stopping'
  | 'failed'
  | 'quarantined'

export interface InstalledPlugin {
  manifest: PluginManifestV1
  source: PluginSource
  activeVersion: string
  previousVersion?: string
  pendingActivation: boolean
  installedAt: string
  contentHash: string
  publisherKeyId?: string
  packagePath?: string
  developmentPath?: string
  verified: boolean
}

function normalizeCanonicalDevelopmentPath(path: string): string {
  // The backend only exposes a filesystem-canonical developmentPath. Keep the
  // identity stable across platform separators and Unicode serialization.
  const slashNormalized = path.normalize('NFC').replace(/\\/g, '/')
  if (slashNormalized === '/' || /^[A-Za-z]:\/$/.test(slashNormalized)) return slashNormalized
  return slashNormalized.replace(/\/+$/, '')
}

export function getPluginSourceIdentity(plugin: InstalledPlugin): string | null {
  if (plugin.source === 'development') {
    if (!plugin.developmentPath) return null
    return JSON.stringify([
      'development',
      normalizeCanonicalDevelopmentPath(plugin.developmentPath),
    ])
  }
  if (!plugin.publisherKeyId) return null
  return JSON.stringify(['marketplace', plugin.publisherKeyId])
}

export function getPluginManifestFingerprint(plugin: InstalledPlugin): string {
  const sourceIdentity = getPluginSourceIdentity(plugin) ?? `@unknown-${plugin.source}-source`

  return JSON.stringify([
    1,
    plugin.manifest.id,
    plugin.manifest.version,
    plugin.contentHash,
    plugin.source,
    sourceIdentity,
  ])
}

export interface PluginPermissionGrant {
  permission: PluginPermissionName
  granted: boolean
  paths?: string[]
  grantedAt?: string
  manifestFingerprint: string
}

export interface PluginWorkspaceState {
  enablement: PluginEnablement
  /** The exact package approved for this workspace, including zero-permission plugins. */
  enabledFingerprint?: string
  permissions: Partial<Record<PluginPermissionName, PluginPermissionGrant>>
  settings: Record<string, PluginSettingValue>
}

export function isPluginEnabledInWorkspace(
  plugin: InstalledPlugin,
  state: PluginWorkspaceState | undefined,
): boolean {
  const fingerprint = getPluginManifestFingerprint(plugin)
  if (!state || (state.enablement !== 'workspace' && state.enablement !== 'all-workspaces')
    || state.enabledFingerprint !== fingerprint) return false
  return Object.entries(plugin.manifest.permissions).every(([permission, declaration]) => {
    const grant = state.permissions[permission as PluginPermissionName]
    return grant?.manifestFingerprint === fingerprint && (declaration.optional || grant.granted)
  })
}

export interface PluginFailureRecord {
  count: number
  lastAt: string
  code: PluginErrorCode
  message: string
}

export interface PluginStatusBarState extends PluginStatusBarUpdate {
  updatedAt: number
}

export interface PluginLogEntry {
  id: string
  pluginId: string
  level: 'info' | 'warning' | 'error'
  message: string
  code?: string
  createdAt: string
}

export interface PluginMarketPublisher {
  id: string
  name: string
  keyId: string
  publicKey: string
  verified?: boolean
  previousKeys?: { keyId: string; publicKey: string }[]
}

export interface PluginMarketRelease {
  publisherKeyId?: string
  revoked?: string
  version: string
  minAppVersion: string
  apiVersion: string
  platforms: PluginPlatform[]
  /** Absent only in legacy indexes; fall back to the entry's permissions. */
  permissions?: PluginPermissionName[]
  packageUrl: string
  packageUrls?: string[]
  packageSha256: string
  signatureUrl?: string
  publishedAt: string
  changelog?: string
}

export interface PluginMarketEntry {
  id: string
  name: string
  description: string
  localizations?: Record<string, { name: string; description: string }>
  author: string
  publisherId: string
  repository?: string
  homepage?: string
  license?: string
  icon?: string
  categories?: string[]
  featured?: boolean
  official?: boolean
  permissions: PluginPermissionName[]
  releases: PluginMarketRelease[]
}

export interface PluginMarketCatalog {
  schemaVersion: 1
  generation: number
  generatedAt: string
  expiresAt: number
  publishers: PluginMarketPublisher[]
  plugins: PluginMarketEntry[]
  source: 'remote' | 'cache'
  stale: boolean
}

export interface PluginWorkspaceBinding {
  workspaceId: string
  workspaceKey: string
}

export function getPluginRevocation(plugin: InstalledPlugin, catalog: PluginMarketCatalog | null): string | undefined {
  if (plugin.source !== 'marketplace') return undefined
  return catalog?.plugins.find(entry => entry.id === plugin.manifest.id)?.releases
    .find(release => release.version === plugin.activeVersion)?.revoked
}
