import { z } from 'zod'
import {
  PLUGIN_API_VERSION,
  isValidPluginMenuCondition,
  PluginError,
  type PluginManifestV1,
  type PluginPermissionName,
  type PluginPlatform,
} from '@notegen/plugin-api'

const PLUGIN_ID_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const SEMVER_RANGE_PATTERN = /^(?:(?:\^|~|>=|>|<=|<) *)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const RELATIVE_FILE_PATTERN = /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*\\)[^\u0000-\u001f\u007f]+$/
const TRANSLATION_PATTERN = /^%([A-Za-z0-9][A-Za-z0-9._-]*)%$/

const pluginIdSchema = z.string().min(3).max(160).regex(PLUGIN_ID_PATTERN)
const semverSchema = z.string().max(80).regex(SEMVER_PATTERN)
  .refine((value) => parseSemver(value) !== null, 'Invalid semantic version')
const semverRangeSchema = z.string().max(80).regex(SEMVER_RANGE_PATTERN)
  .refine((value) => parseSemver(value.replace(/^(?:\^|~|>=|>|<=|<) */, '')) !== null, 'Invalid semantic version range')
const localizedTextSchema = z.string().min(1).max(240)
const namespacedIdSchema = z.string().min(3).max(220)

const relativeFileSchema = z.string().min(1).max(240).regex(RELATIVE_FILE_PATTERN)

const permissionDeclarationSchema = z.object({
  scope: z.enum([
    'active-editor',
    'workspace-file',
    'workspace-files',
    'workspace-folder',
    'network-origins',
  ]),
  optional: z.boolean().optional(),
  description: localizedTextSchema.optional(),
}).strict()

const commandSchema = z.object({
  id: namespacedIdSchema,
  title: localizedTextSchema,
  description: localizedTextSchema.optional(),
  icon: z.string().min(1).max(80).optional(),
  keywords: z.array(z.string().min(1).max(80)).max(20).optional(),
  suggestedShortcut: z.string().min(1).max(80).optional(),
}).strict()

const settingBase = {
  key: namespacedIdSchema,
  scope: z.enum(['device', 'workspace']),
  title: localizedTextSchema,
  description: localizedTextSchema.optional(),
}

const settingSchema = z.discriminatedUnion('type', [
  z.object({
    ...settingBase,
    type: z.literal('boolean'),
    default: z.boolean(),
  }).strict(),
  z.object({
    ...settingBase,
    type: z.literal('string'),
    default: z.string(),
    placeholder: localizedTextSchema.optional(),
    maxLength: z.number().int().positive().max(65_536).optional(),
  }).strict(),
  z.object({
    ...settingBase,
    type: z.literal('number'),
    default: z.number().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().finite().optional(),
  }).strict(),
  z.object({
    ...settingBase,
    type: z.literal('select'),
    default: z.string(),
    options: z.array(z.object({
      label: localizedTextSchema,
      value: z.string().min(1).max(160),
    }).strict()).min(1).max(100),
  }).strict(),
  z.object({
    ...settingBase,
    type: z.literal('workspace-file'),
    scope: z.literal('workspace'),
    default: z.string(),
  }).strict(),
  z.object({
    ...settingBase,
    type: z.literal('workspace-folder'),
    scope: z.literal('workspace'),
    default: z.string(),
  }).strict(),
])

const statusBarSchema = z.object({
  id: namespacedIdSchema,
  alignment: z.enum(['left', 'right']),
  priority: z.number().int().min(-10_000).max(10_000).optional(),
  command: namespacedIdSchema.optional(),
}).strict()

const menuSchema = z.object({
  location: z.enum([
    'editor/slash',
    'editor/context',
    'editor/selection',
    'editor/toolbar',
    'tab/context',
    'file/context',
    'mobile/writing/overflow',
  ]),
  command: namespacedIdSchema,
  when: z.string().min(1).max(240).optional(),
  group: z.string().min(1).max(80).optional(),
  order: z.number().int().min(-10000).max(10000).optional(),
  icon: z.string().regex(/^[A-Za-z0-9-]+$/).max(80).optional(),
  enableWhen: z.string().refine(isValidPluginMenuCondition).optional(),
}).strict()

const viewSchema = z.object({
  id: namespacedIdSchema,
  title: localizedTextSchema,
  location: z.enum(['left-sidebar', 'right-sidebar', 'editor-tab']),
  icon: z.string().min(1).max(80).optional(),
}).strict()

const manifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: pluginIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500).optional(),
  version: semverSchema,
  apiVersion: semverRangeSchema,
  minAppVersion: semverSchema,
  platforms: z.array(z.enum(['desktop', 'ios', 'android'])).min(1).max(3),
  entry: relativeFileSchema.refine((entry) => entry.endsWith('.js'), {
    message: 'entry must be a JavaScript file',
  }),
  activationEvents: z.array(z.string()).max(100),
  permissions: z.object({
    'editor.read': permissionDeclarationSchema.optional(),
    'editor.write': permissionDeclarationSchema.optional(),
    'notes.read': permissionDeclarationSchema.optional(),
    'attachments.read': permissionDeclarationSchema.optional(),
    'attachments.create': permissionDeclarationSchema.optional(),
    'notes.create': permissionDeclarationSchema.optional(),
    'notes.open': permissionDeclarationSchema.optional(),
    'notes.list': permissionDeclarationSchema.optional(),
    'notes.write': permissionDeclarationSchema.optional(),
    'notes.delete': permissionDeclarationSchema.optional(),
    'notes.move': permissionDeclarationSchema.optional(),
    'network.fetch': permissionDeclarationSchema.optional(),
  }).strict(),
  contributes: z.object({
    commands: z.array(commandSchema).max(100).optional(),
    settings: z.array(settingSchema).max(100).optional(),
    statusBar: z.array(statusBarSchema).max(30).optional(),
    menus: z.array(menuSchema).max(100).optional(),
    views: z.array(viewSchema).max(30).optional(),
  }).strict(),
  defaultLocale: z.string().min(2).max(35).optional(),
  locales: z.record(z.string().min(2).max(35), relativeFileSchema).optional(),
  author: z.object({
    name: z.string().min(1).max(120),
    url: z.string().url().max(500).optional(),
  }).strict().optional(),
  repository: z.string().url().max(500).optional(),
  license: z.string().min(1).max(80).optional(),
}).strict()

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

function parseSemver(version: string): ParsedSemver | null {
  if (version.length > 80) return null
  const match = version.match(SEMVER_PATTERN)
  if (!match || match[0] !== version) return null
  const core = [Number(match[1]), Number(match[2]), Number(match[3])]
  const prerelease = match[4]?.split('.') ?? []
  if (core.some((part) => !Number.isSafeInteger(part))
    || prerelease.some((part) => /^0\d+$/.test(part))) return null

  return {
    major: core[0],
    minor: core[1],
    patch: core[2],
    prerelease,
  }
}

function compareIdentifiers(left: string, right: string): number {
  if (left === right) return 0
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  // Compare numeric identifiers without rounding large values through Number.
  if (leftNumeric && rightNumeric && left.length !== right.length) {
    return left.length - right.length
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : 1
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) throw new PluginError('InvalidManifest', 'Invalid semantic version')

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }

  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1

  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index]
    const bPart = b.prerelease[index]
    if (aPart === undefined) return -1
    if (bPart === undefined) return 1
    const comparison = compareIdentifiers(aPart, bPart)
    if (comparison !== 0) return comparison
  }

  return 0
}

export function satisfiesSemverRange(version: string, range: string): boolean {
  if (range.length > 80 || range.match(SEMVER_RANGE_PATTERN)?.[0] !== range) return false
  const operator = range.match(/^(\^|~|>=|>|<=|<)/)?.[1] ?? '='
  const target = range.replace(/^(?:\^|~|>=|>|<=|<) */, '')
  const parsedTarget = parseSemver(target)
  const parsedVersion = parseSemver(version)
  if (!parsedTarget || !parsedVersion) return false

  const comparison = compareSemver(version, target)
  if (operator === '=') return comparison === 0
  if (operator === '>=') return comparison >= 0
  if (operator === '>') return comparison > 0
  if (operator === '<=') return comparison <= 0
  if (operator === '<') return comparison < 0
  if (comparison < 0) return false

  if (operator === '~') {
    return parsedVersion.major === parsedTarget.major
      && parsedVersion.minor === parsedTarget.minor
  }

  if (parsedTarget.major > 0) return parsedVersion.major === parsedTarget.major
  if (parsedTarget.minor > 0) {
    return parsedVersion.major === 0 && parsedVersion.minor === parsedTarget.minor
  }
  return parsedVersion.major === 0
    && parsedVersion.minor === 0
    && parsedVersion.patch === parsedTarget.patch
}

function isNamespaced(value: string, pluginId: string): boolean {
  return value.startsWith(`${pluginId}.`) && value.length > pluginId.length + 1
}

function validatePermissionScopes(manifest: PluginManifestV1): void {
  const allowedScopes: Record<PluginPermissionName, readonly string[]> = {
    'editor.read': ['active-editor'],
    'editor.write': ['active-editor'],
    'notes.read': ['workspace-file', 'workspace-files', 'workspace-folder'],
    'attachments.read': ['workspace-file', 'workspace-files', 'workspace-folder'],
    'attachments.create': ['workspace-folder'],
    'notes.create': ['workspace-folder'],
    'notes.open': ['workspace-folder'],
    'notes.list': ['workspace-folder'],
    'notes.write': ['workspace-file', 'workspace-files', 'workspace-folder'],
    'notes.delete': ['workspace-file', 'workspace-files', 'workspace-folder'],
    'notes.move': ['workspace-folder'],
    'network.fetch': ['network-origins'],
  }

  for (const [permission, declaration] of Object.entries(manifest.permissions)) {
    if (!declaration) continue
    if (!allowedScopes[permission as PluginPermissionName].includes(declaration.scope)) {
      throw new PluginError(
        'InvalidManifest',
        `${permission} does not support the ${declaration.scope} scope`,
      )
    }
  }
}

function validateContributions(manifest: PluginManifestV1): void {
  const commandIds = new Set<string>()
  for (const command of manifest.contributes.commands ?? []) {
    if (!isNamespaced(command.id, manifest.id)) {
      throw new PluginError('InvalidManifest', `Command ${command.id} is outside the plugin namespace`)
    }
    if (commandIds.has(command.id)) {
      throw new PluginError('InvalidManifest', `Command ${command.id} is declared more than once`)
    }
    commandIds.add(command.id)
  }

  let folderBindingSeen = false
  const settingKeys = new Set<string>()
  for (const setting of manifest.contributes.settings ?? []) {
    if (setting.type === 'string' && setting.permissionPaths !== undefined) {
      const paths = setting.permissionPaths
      if (folderBindingSeen || setting.scope !== 'workspace' || !Array.isArray(paths) || !paths.length || paths.length > 20
        || new Set(paths).size !== paths.length || paths.some((name: PluginPermissionName) => {
          const permission = manifest.permissions[name]
          return !permission || permission.scope !== 'workspace-folder' || permission.optional
        })) throw new PluginError('InvalidManifest', 'Invalid workspace folder permission binding')
      folderBindingSeen = true
    }
    if (!isNamespaced(setting.key, manifest.id)) {
      throw new PluginError('InvalidManifest', `Setting ${setting.key} is outside the plugin namespace`)
    }
    if (settingKeys.has(setting.key)) {
      throw new PluginError('InvalidManifest', `Setting ${setting.key} is declared more than once`)
    }
    if (setting.type === 'select' && !setting.options.some((option) => option.value === setting.default)) {
      throw new PluginError('InvalidManifest', `Setting ${setting.key} has an unknown default value`)
    }
    if (
      setting.type === 'string'
      && new TextEncoder().encode(setting.default).byteLength > (setting.maxLength ?? 65_536)
    ) {
      throw new PluginError('InvalidManifest', `Setting ${setting.key} default exceeds maxLength`)
    }
    if (setting.type === 'number') {
      if (setting.min !== undefined && setting.default < setting.min) {
        throw new PluginError('InvalidManifest', `Setting ${setting.key} is below its minimum`)
      }
      if (setting.max !== undefined && setting.default > setting.max) {
        throw new PluginError('InvalidManifest', `Setting ${setting.key} is above its maximum`)
      }
      if (setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) {
        throw new PluginError('InvalidManifest', `Setting ${setting.key} has an invalid range`)
      }
    }
    settingKeys.add(setting.key)
  }

  const statusIds = new Set<string>()
  for (const status of manifest.contributes.statusBar ?? []) {
    if (!isNamespaced(status.id, manifest.id)) {
      throw new PluginError('InvalidManifest', `Status item ${status.id} is outside the plugin namespace`)
    }
    if (statusIds.has(status.id)) {
      throw new PluginError('InvalidManifest', `Status item ${status.id} is declared more than once`)
    }
    if (status.command && !commandIds.has(status.command)) {
      throw new PluginError('InvalidManifest', `Status item ${status.id} references an unknown command`)
    }
    statusIds.add(status.id)
  }

  const viewIds = new Set<string>()
  for (const view of manifest.contributes.views ?? []) {
    if (!isNamespaced(view.id, manifest.id)) {
      throw new PluginError('InvalidManifest', `View ${view.id} is outside the plugin namespace`)
    }
    if (viewIds.has(view.id)) {
      throw new PluginError('InvalidManifest', `View ${view.id} is declared more than once`)
    }
    viewIds.add(view.id)
  }

  for (const menu of manifest.contributes.menus ?? []) {
    if (!commandIds.has(menu.command)) {
      throw new PluginError('InvalidManifest', `Menu references unknown command ${menu.command}`)
    }
    if (menu.when && !isValidPluginMenuCondition(menu.when)) {
      throw new PluginError('InvalidManifest', `Unsupported menu condition: ${menu.when}`)
    }
  }

  for (const activationEvent of manifest.activationEvents) {
    if (['onEditor:markdown', 'onWorkspace:open', 'onNotes:change'].includes(activationEvent)) continue
    if (!activationEvent.startsWith('onCommand:')) {
      throw new PluginError('InvalidManifest', `Unsupported activation event: ${activationEvent}`)
    }
    const commandId = activationEvent.slice('onCommand:'.length)
    if (!commandIds.has(commandId)) {
      throw new PluginError('InvalidManifest', `Activation event references unknown command ${commandId}`)
    }
  }
}

function validateLocalization(manifest: PluginManifestV1): void {
  if (manifest.locales && !manifest.defaultLocale) {
    throw new PluginError('InvalidManifest', 'defaultLocale is required when locales are declared')
  }
  if (manifest.defaultLocale && !manifest.locales?.[manifest.defaultLocale]) {
    throw new PluginError('InvalidManifest', 'The default locale must have a locale file')
  }

  const texts = [
    ...(manifest.contributes.commands ?? []).flatMap((item) => [item.title, item.description]),
    ...(manifest.contributes.settings ?? []).flatMap((item) => [
      item.title,
      item.description,
      item.type === 'string' ? item.placeholder : undefined,
      ...(item.type === 'select' ? item.options.map((option) => option.label) : []),
    ]),
    ...(manifest.contributes.views ?? []).map((item) => item.title),
  ].filter((value): value is string => typeof value === 'string')

  for (const text of texts) {
    if (text.startsWith('%') && !TRANSLATION_PATTERN.test(text)) {
      throw new PluginError('InvalidManifest', `Invalid localization reference: ${text}`)
    }
  }
}

export function parsePluginManifest(value: unknown): PluginManifestV1 {
  const result = manifestSchema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new PluginError(
      'InvalidManifest',
      issue ? `${issue.path.join('.') || 'plugin.json'}: ${issue.message}` : 'Invalid plugin manifest',
    )
  }

  const manifest = result.data as PluginManifestV1
  validatePermissionScopes(manifest)
  validateContributions(manifest)
  validateLocalization(manifest)
  return manifest
}

export function assertPluginCompatibility(
  manifest: PluginManifestV1,
  options: {
    appVersion: string
    platform: PluginPlatform
    apiVersion?: string
  },
): void {
  if (!manifest.platforms.includes(options.platform)) {
    throw new PluginError('Incompatible', `Plugin does not support ${options.platform}`)
  }
  if (compareSemver(options.appVersion, manifest.minAppVersion) < 0) {
    throw new PluginError('Incompatible', `Plugin requires NoteGen ${manifest.minAppVersion} or newer`)
  }
  if (!satisfiesSemverRange(options.apiVersion ?? PLUGIN_API_VERSION, manifest.apiVersion)) {
    throw new PluginError('Incompatible', `Plugin API ${manifest.apiVersion} is not supported`)
  }
}

export function getManifestTranslationKeys(manifest: PluginManifestV1): string[] {
  const keys = new Set<string>()
  const add = (value: string | undefined) => {
    if (!value) return
    const match = value.match(TRANSLATION_PATTERN)
    if (match) keys.add(match[1])
  }

  for (const command of manifest.contributes.commands ?? []) {
    add(command.title)
    add(command.description)
  }
  for (const setting of manifest.contributes.settings ?? []) {
    add(setting.title)
    add(setting.description)
    if (setting.type === 'string') add(setting.placeholder)
    if (setting.type === 'select') {
      setting.options.forEach((option) => add(option.label))
    }
  }
  return [...keys]
}

export function resolveManifestText(
  value: string | undefined,
  messages: Record<string, string>,
): string | undefined {
  if (!value) return value
  const match = value.match(TRANSLATION_PATTERN)
  return match ? messages[match[1]] ?? match[1] : value
}
