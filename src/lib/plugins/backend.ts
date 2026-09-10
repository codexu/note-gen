import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import {
  PLUGIN_ERROR_CODES,
  PluginError,
  type PluginErrorCode,
  type PluginPlatform,
} from '@notegen/plugin-api'
import { checkIsTauri } from '@/lib/check'
import type {
  InstalledPlugin,
  PluginMarketCatalog,
} from '@/lib/plugins/internal-types'

export interface PluginInstallResult {
  plugin: InstalledPlugin
  replacedVersion?: string
  permissionsChanged: boolean
}

export interface PluginUninstallResult {
  pluginId: string
  removedVersions: string[]
  cleanupWarning?: {
    code: string
    message: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mapNativeErrorCode(code: string): PluginErrorCode {
  if ((PLUGIN_ERROR_CODES as readonly string[]).includes(code)) return code as PluginErrorCode
  if (code === 'DeveloperModeRequired') return 'PermissionDenied'
  if (code === 'PackageTooLarge') return 'QuotaExceeded'
  if (code === 'UnsafePath') return 'InvalidPath'
  if (code === 'MarketTrustUnavailable') return 'SignatureInvalid'
  if (['InvalidJson', 'InvalidMarket', 'InvalidPackage', 'InvalidState', 'InvalidDigest', 'UnsafeArchive'].includes(code)) {
    return 'InvalidManifest'
  }
  return 'RuntimeFailure'
}

export async function invokePluginBackend<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    if (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
      throw new PluginError(mapNativeErrorCode(error.code), error.message, { nativeCode: error.code })
    }
    throw error
  }
}

export async function getPluginPlatform(): Promise<PluginPlatform> {
  if (!checkIsTauri()) return 'desktop'
  const current = platform()
  if (current === 'ios') return 'ios'
  if (current === 'android') return 'android'
  return 'desktop'
}

export async function getAppVersion(): Promise<string> {
  if (!checkIsTauri()) return '0.0.0'
  return getVersion()
}

export async function listInstalledPluginPackages(): Promise<InstalledPlugin[]> {
  if (!checkIsTauri()) return []
  const current = platform()
  if (current === 'ios' || current === 'android') return []
  return invokePluginBackend<InstalledPlugin[]>('plugin_list_installed')
}

export async function readPluginHostState(): Promise<unknown> {
  return invokePluginBackend<unknown>('plugin_read_host_state')
}

export async function commitPluginHostState(
  expectedRevision: number,
  nextState: unknown,
): Promise<void> {
  return invokePluginBackend<void>('plugin_commit_host_state', { expectedRevision, nextState })
}

export async function fetchPluginMarketCatalog(options?: {
  force?: boolean
}): Promise<PluginMarketCatalog> {
  if (!checkIsTauri()) {
    throw new PluginError('UnavailableOnPlatform', 'The plugin marketplace is available in the desktop app')
  }
  return invokePluginBackend<PluginMarketCatalog>('plugin_fetch_market', {
    force: options?.force ?? false,
  })
}

export async function installPluginFromMarket(
  pluginId: string,
  version?: string,
): Promise<PluginInstallResult> {
  return invokePluginBackend<PluginInstallResult>('plugin_install_market', { pluginId, version })
}

export async function importDevelopmentPlugin(
  path: string,
  developerMode: boolean,
  expectedPluginId?: string,
): Promise<PluginInstallResult> {
  return invokePluginBackend<PluginInstallResult>('plugin_import_local', { path, developerMode, expectedPluginId })
}

export async function uninstallPluginPackage(
  pluginId: string,
  options: { removeData?: boolean } = {},
): Promise<PluginUninstallResult> {
  return invokePluginBackend<PluginUninstallResult>('plugin_uninstall', {
    pluginId,
    removeData: options.removeData ?? false,
  })
}

export async function rollbackPluginPackage(pluginId: string): Promise<InstalledPlugin> {
  return invokePluginBackend<InstalledPlugin>('plugin_rollback', { pluginId })
}

export async function confirmPluginPackageActivation(
  pluginId: string,
  version: string,
  expectedContentHash: string,
): Promise<InstalledPlugin> {
  return invokePluginBackend<InstalledPlugin>('plugin_confirm_activation', { pluginId, version, expectedContentHash })
}

export interface PluginReadIdentity {
  version: string
  contentHash: string
}

export async function readPluginEntry(pluginId: string, identity: PluginReadIdentity): Promise<string> {
  return invokePluginBackend<string>('plugin_read_entry', {
    pluginId,
    expectedVersion: identity.version,
    expectedContentHash: identity.contentHash,
  })
}

export async function readPluginLocale(
  pluginId: string,
  locale: string,
  identity: PluginReadIdentity,
): Promise<Record<string, string> | null> {
  return invokePluginBackend<Record<string, string> | null>('plugin_read_locale', {
    pluginId,
    locale,
    expectedVersion: identity.version,
    expectedContentHash: identity.contentHash,
  })
}

export async function readPluginUsage(pluginId: string, locale: string, identity: PluginReadIdentity): Promise<string | null> {
  return invokePluginBackend<string | null>('plugin_read_usage', {
    pluginId, locale, expectedVersion: identity.version, expectedContentHash: identity.contentHash,
  })
}
