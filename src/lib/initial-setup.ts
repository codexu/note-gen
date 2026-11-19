import { Store } from '@tauri-apps/plugin-store'

export const INITIAL_SETUP_STEPS = ['welcome', 'workspace', 'model', 'knowledge', 'sync'] as const
export type InitialSetupStep = typeof INITIAL_SETUP_STEPS[number]
export type InitialSetupStatus = 'pending' | 'completed' | 'skipped' | 'existing-user'

export interface InitialSetupProgress {
  schemaVersion: 1
  status: InitialSetupStatus
  step: InitialSetupStep
  isNewInstallation: boolean
}

const INITIAL_SETUP_FILE = 'initial-setup.json'

export function createExistingUserSetupProgress(): InitialSetupProgress {
  return {
    schemaVersion: 1,
    status: 'existing-user',
    step: 'welcome',
    isNewInstallation: false,
  }
}

function normalizeInitialSetupProgress(value: unknown): InitialSetupProgress {
  if (!value || typeof value !== 'object') return createExistingUserSetupProgress()
  const progress = value as Partial<InitialSetupProgress>
  if (progress.schemaVersion !== 1
    || !['pending', 'completed', 'skipped', 'existing-user'].includes(progress.status ?? '')
    || !INITIAL_SETUP_STEPS.includes(progress.step as InitialSetupStep)) {
    return createExistingUserSetupProgress()
  }
  return {
    schemaVersion: 1,
    status: progress.status as InitialSetupStatus,
    step: progress.step as InitialSetupStep,
    isNewInstallation: progress.isNewInstallation === true,
  }
}

export async function readInitialSetupProgress(): Promise<InitialSetupProgress> {
  // Only native startup may identify a new installation. Missing or unreadable
  // state here is intentionally not inferred from an empty model or note list.
  const store = await Store.load(INITIAL_SETUP_FILE, { autoSave: false })
  return normalizeInitialSetupProgress(await store.get<unknown>('state'))
}

let persistenceQueue = Promise.resolve()

export function persistInitialSetupProgress(progress: InitialSetupProgress): Promise<void> {
  const snapshot = { ...progress }
  const write = persistenceQueue.then(async () => {
    // Tie the decision to the settings it applies to. A leftover wizard file
    // must not suppress onboarding after the settings and content are cleared.
    if (snapshot.status === 'completed' || snapshot.status === 'skipped') {
      const settings = await Store.load('store.json')
      await settings.set('initialSetupDismissed', true)
      await settings.save()
    }
    const store = await Store.load(INITIAL_SETUP_FILE, { autoSave: false })
    await store.set('state', snapshot)
    await store.save()
  })
  // Keep later navigation/skip writes ordered even if a previous save failed.
  persistenceQueue = write.catch(() => undefined)
  return write
}
