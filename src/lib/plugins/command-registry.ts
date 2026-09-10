import { usePluginStore } from '@/stores/plugins'
import { isPluginDisplayVisible } from './display-preferences'
import {
  PluginError,
  matchesPluginMenuCondition,
  type PluginMenuContext,
  type PluginCommandArgument,
  type PluginCommandContribution,
  type PluginCommandResult,
  type PluginDisposable,
  type PluginMenuContribution,
} from '@notegen/plugin-api'
import type { InstalledPlugin } from '@/lib/plugins/internal-types'
import { resolveManifestText } from '@/lib/plugins/manifest'

export interface RegisteredPluginCommand extends PluginCommandContribution {
  pluginId: string
  pluginName: string
  source: InstalledPlugin['source']
  group?: string
  disabled?: boolean
}

type CommandHandler = (
  argument?: PluginCommandArgument,
) => PluginCommandResult | Promise<PluginCommandResult>
type ActivationResolver = (pluginId: string, commandId: string) => Promise<void>

const commands = new Map<string, RegisteredPluginCommand>()
const handlers = new Map<string, { pluginId: string; handler: CommandHandler }>()
const menus = new Map<string, Array<PluginMenuContribution & { pluginId: string }>>()
const listeners = new Set<() => void>()
let activationResolver: ActivationResolver | null = null

function emitChange(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Registry mutations must not become partial because a UI subscriber failed.
    }
  }
}

export function setPluginActivationResolver(resolver: ActivationResolver | null): void {
  activationResolver = resolver
}

export function registerPluginContributions(
  plugin: InstalledPlugin,
  messages: Record<string, string>,
): PluginDisposable {
  const pluginId = plugin.manifest.id
  const registeredCommands = new Map<string, RegisteredPluginCommand>()
  const registeredMenus = new Set<PluginMenuContribution & { pluginId: string }>()
  let disposed = false
  const contributions = plugin.manifest.contributes.commands ?? []
  const contributionIds = new Set<string>()

  // Validate the whole batch before mutating global registries. A collision in
  // a later command must not leak commands registered earlier in the loop.
  for (const contribution of contributions) {
    if (contributionIds.has(contribution.id)) {
      throw new PluginError('AlreadyRegistered', `Command ${contribution.id} is declared more than once`)
    }
    contributionIds.add(contribution.id)
    const existing = commands.get(contribution.id)
    if (existing) {
      throw new PluginError('AlreadyRegistered', `Command ${contribution.id} is already registered`)
    }
  }

  for (const contribution of contributions) {
    const registered = {
      ...contribution,
      icon: contribution.icon
        ?? plugin.manifest.contributes.views?.find(view => view.icon)?.icon
        ?? contributions.find(command => command.icon)?.icon,
      title: resolveManifestText(contribution.title, messages) ?? contribution.id,
      description: resolveManifestText(contribution.description, messages),
      pluginId,
      pluginName: plugin.manifest.name,
      source: plugin.source,
    }
    commands.set(contribution.id, registered)
    registeredCommands.set(contribution.id, registered)
  }

  for (const menu of plugin.manifest.contributes.menus ?? []) {
    const entries = menus.get(menu.location) ?? []
    const registered = { ...menu, pluginId }
    registeredMenus.add(registered)
    menus.set(menu.location, [...entries, registered])
  }
  emitChange()

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const [id, command] of registeredCommands) {
        if (commands.get(id) !== command) continue
        commands.delete(id)
        if (handlers.get(id)?.pluginId === pluginId) handlers.delete(id)
      }
      for (const [location, entries] of menus) {
        const remaining = entries.filter((entry) => !registeredMenus.has(entry))
        if (remaining.length === 0) menus.delete(location)
        else menus.set(location, remaining)
      }
      emitChange()
    },
  }
}

export function registerPluginCommandHandler(
  pluginId: string,
  commandId: string,
  handler: CommandHandler,
): PluginDisposable {
  const contribution = commands.get(commandId)
  if (!contribution || contribution.pluginId !== pluginId) {
    throw new PluginError('PermissionDenied', `Command ${commandId} is not declared by ${pluginId}`)
  }
  if (handlers.has(commandId)) {
    throw new PluginError('AlreadyRegistered', `Command ${commandId} already has a handler`)
  }
  const registration = { pluginId, handler }
  handlers.set(commandId, registration)
  emitChange()
  return {
    dispose: () => {
      if (handlers.get(commandId) === registration) {
        handlers.delete(commandId)
        emitChange()
      }
    },
  }
}

export async function executePluginCommand(
  commandId: string,
  argument?: PluginCommandArgument,
): Promise<PluginCommandResult> {
  const contribution = commands.get(commandId)
  if (!contribution) throw new PluginError('NotFound', `Unknown command: ${commandId}`)

  let registered = handlers.get(commandId)
  if (!registered && activationResolver) {
    await activationResolver(contribution.pluginId, commandId)
    registered = handlers.get(commandId)
  }
  if (commands.get(commandId) !== contribution) {
    throw new PluginError('Cancelled', 'The command contribution changed while its plugin was activating')
  }
  if (!registered) {
    throw new PluginError('RuntimeFailure', `Plugin did not register ${commandId}`)
  }
  return registered.handler(argument)
}

export function getPluginCommands(): RegisteredPluginCommand[] {
  return [...commands.values()].sort((left, right) => left.title.localeCompare(right.title))
}

export function getPluginMenuCommands(location: PluginMenuContribution['location'], context: PluginMenuContext = {}, displayLocation: PluginMenuContribution['location'] = location): RegisteredPluginCommand[] {
  const seen = new Set<string>()
  return [...(menus.get(location) ?? [])]
    .filter(menu => isPluginDisplayVisible(usePluginStore.getState().deviceSettings, menu.pluginId, displayLocation) && matchesPluginMenuCondition(menu.when, context))
    .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || (a.order ?? 0) - (b.order ?? 0))
    .flatMap(menu => {
      const command = commands.get(menu.command)
      if (!command || seen.has(command.id)) return []
      seen.add(command.id)
      return [{ ...command, icon: menu.icon ?? command.icon, group: menu.group,
        disabled: !matchesPluginMenuCondition(menu.enableWhen, context) }]
    })
}

export function subscribePluginCommands(listener: () => void): () => void {
  listeners.add(listener)
  const stop = usePluginStore.subscribe((state, previous) => {
    if (state.deviceSettings === previous.deviceSettings) return
    try { listener() } catch { /* A subscriber must not interrupt preference persistence. */ }
  })
  return () => { listeners.delete(listener); stop() }
}
