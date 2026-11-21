import { Store } from '@tauri-apps/plugin-store'
import { getDb } from '@/db'
import { workspaceRootsReferToSameLocation } from '@/lib/editor-deactivation'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import type { WorkspaceSummary } from './protocol'

export const DEFAULT_LIBRARY_IDEMPOTENCY_KEY = 'notegen.default-library.v1'

const choiceKey = 'selfHostedInitialLibraryChoice'
let choiceWrites = Promise.resolve()

interface InitialLibraryChoice {
  profileId: string
  localRoot: string
  workspaceId: string
}

export async function readInitialLibraryChoice(profileId: string, localRoot: string) {
  const choice = await (await Store.load('store.json')).get<InitialLibraryChoice>(choiceKey)
  return choice?.profileId === profileId && sameLibraryRoot(choice.localRoot, localRoot) ? choice.workspaceId : null
}

export function saveInitialLibraryChoice(profileId: string, localRoot: string, workspaceId: string | null) {
  return updateInitialLibraryChoice(profileId, localRoot, workspaceId)
}

export function clearInitialLibraryChoiceIfMatches(profileId: string, localRoot: string, expectedWorkspaceId: string) {
  return updateInitialLibraryChoice(profileId, localRoot, null, expectedWorkspaceId)
}

function updateInitialLibraryChoice(profileId: string, localRoot: string, workspaceId: string | null, expectedWorkspaceId?: string) {
  const write = choiceWrites.then(async () => {
    const store = await Store.load('store.json')
    if (workspaceId) {
      await store.set(choiceKey, { profileId, localRoot, workspaceId })
    } else {
      const choice = await store.get<InitialLibraryChoice>(choiceKey)
      if (choice?.profileId !== profileId || !sameLibraryRoot(choice.localRoot, localRoot)
        || (expectedWorkspaceId && choice.workspaceId !== expectedWorkspaceId)) return
      await store.delete(choiceKey)
    }
    await store.save()
  })
  choiceWrites = write.catch(() => undefined)
  return write
}

export interface LibraryBinding {
  workspaceId: string
  profileId: string
  localRoot: string | null
  bindingState: string
}

export async function readLibraryBindings() {
  const rows = await (await getDb()).select<LibraryBinding[]>(
    `select workspace_id as workspaceId, profile_id as profileId, local_root as localRoot,
       binding_state as bindingState from self_hosted_workspace_bindings
     where workspace_type = 'library' order by workspace_id`,
  )
  return new Map(rows.map(row => [row.workspaceId, row]))
}

export function sameLibraryRoot(left: string, right: string) {
  return left === right || workspaceRootsReferToSameLocation(left, right)
}

export async function getInitialLibraryLocation(location?: Awaited<ReturnType<typeof getWorkspacePath>>) {
  const { path, isCustom } = location ?? await getWorkspacePath()
  const defaultRoot = await getDefaultArticleAbsolutePath('')
  const relativePath = path.trim().replaceAll('\\', '/').replace(/\/+$/, '')
  const isDefault = !isCustom || relativePath === 'article' || relativePath === './article' || sameLibraryRoot(path, defaultRoot)
  return { localRoot: isDefault ? defaultRoot : path, isDefault }
}

export function isActiveLibraryBinding(binding: LibraryBinding) {
  return ['bound', 'bootstrapping', 'epoch-changed'].includes(binding.bindingState)
}

export function isInitialLibraryCandidate(workspace: WorkspaceSummary, profileId: string, localRoot: string, binding?: Pick<LibraryBinding, 'profileId' | 'localRoot'>) {
  return workspace.type === 'library' && workspace.deletedAt === null && workspace.owner
    && workspace.capabilities.includes('content.create') && workspace.capabilities.includes('content.update')
    && (!binding || (binding.profileId === profileId && (!binding.localRoot || sameLibraryRoot(binding.localRoot, localRoot))))
}

export function findInitialLibraryBinding(bindings: ReadonlyMap<string, LibraryBinding>, profileId: string, localRoot: string) {
  for (const binding of bindings.values()) {
    if (binding.profileId === profileId && isActiveLibraryBinding(binding)
      && binding.localRoot && sameLibraryRoot(binding.localRoot, localRoot)) return binding
  }
}

export function automaticInitialLibrary(
  workspaces: WorkspaceSummary[], bindings: ReadonlyMap<string, LibraryBinding>, profileId: string,
  localRoot: string, isDefault: boolean, defaultWorkspaceId?: string,
): string | null | undefined {
  const current = findInitialLibraryBinding(bindings, profileId, localRoot)
  if (current) return current.workspaceId
  const candidates = workspaces.filter(workspace => isInitialLibraryCandidate(workspace, profileId, localRoot, bindings.get(workspace.id)))
  if (isDefault) {
    if (!defaultWorkspaceId) return null
    if (candidates.some(workspace => workspace.id === defaultWorkspaceId)) return defaultWorkspaceId
  }
  return candidates.length > 1 ? undefined : candidates[0]?.id ?? null
}
