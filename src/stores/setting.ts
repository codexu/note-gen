import { Store } from '@tauri-apps/plugin-store'
import { emit } from '@tauri-apps/api/event'
import { create } from 'zustand'
import { getVersion } from '@tauri-apps/api/app'
import { AiConfig } from '@/app/core/setting/config'
import { GitlabInstanceType } from '@/lib/sync/gitlab.types'
import { GiteaInstanceType } from '@/lib/sync/gitea.types'
import { noteGenDefaultModels, noteGenModelKeys } from '@/app/model-config'
import { fetch } from '@tauri-apps/plugin-http'
import { CustomThemeColors } from '@/types/theme'
import { applyThemeColors, removeThemeColors } from '@/lib/theme-utils'
import { getNormalizedImageHosting } from '@/lib/image-hosting-config'
import { normalizeSpeechMode } from '@/lib/speech/preferences'
import type { SpeechMode } from '@/lib/speech/types'
import { applyNoteGenDefaultConfig, loadNoteGenDefaultConfig } from '@/lib/ai/notegen-default-models-runtime'
import { excludeBuiltInOpenAIProviders, isMainlandChinaAppStore } from '@/lib/ai/storefront-policy'
import { enqueueAutoDataSync, isAutoDataSyncApplyingRemote } from '@/lib/sync/auto-data-sync-queue'
import { shouldExcludeFromSync } from '@/config/sync-exclusions'
import {
  AGENT_CORE_PROMPT_VERSION,
  isManagedAgentSystemPrompt,
} from '@/lib/ai/system-prompt'
import { APP_FONT_SYSTEM_VALUE, applyAppFontFamily } from '@/lib/font-settings'
import { prepareActiveEditorDeactivation } from '@/lib/editor-deactivation'
import type { AgentPermissionMode } from '@/lib/agent/types'
import { getWorkspaceSyncRepos, setWorkspaceSyncRepo } from '@/lib/sync/workspace-repos'
import {
  DEFAULT_EDITOR_CONTENT_WIDTH,
  DEFAULT_EDITOR_LINE_HEIGHT,
  DEFAULT_EDITOR_VIEW_MODE,
  normalizeEditorContentWidth,
  normalizeEditorLineHeight,
  normalizeEditorViewMode,
  type EditorContentWidth,
  type EditorLineHeight,
  type EditorViewMode,
} from '@/lib/editor-layout-styles'
import {
  DEFAULT_OUTLINE_POSITION,
  normalizeOutlinePosition,
  type OutlinePosition,
} from '@/lib/outline-preferences'
import {
  DEFAULT_RECORD_SORT_MODE,
  DEFAULT_RECORD_VIEW_MODE,
  normalizeRecordSortMode,
  normalizeRecordViewMode,
  type RecordSortMode,
  type RecordViewMode,
} from '@/lib/record-display-preferences'
import {
  DEFAULT_RECORD_COMPLETION_BEHAVIOR,
  DEFAULT_RECORD_SAVE_TARGET_MODE,
  normalizeRecordCompletionBehavior,
  normalizeRecordSaveTargetMode,
  normalizeRecordTagId,
  type RecordCompletionBehavior,
  type RecordSaveTargetMode,
} from '@/lib/record-save-preferences'
import {
  DEFAULT_CANVAS_GRID_GAP,
  DEFAULT_CANVAS_GRID_STYLE,
  DEFAULT_CANVAS_GRID_VISIBLE,
  DEFAULT_CANVAS_INSERT_BEHAVIOR,
  DEFAULT_CANVAS_MANAGER_SORT_MODE,
  DEFAULT_CANVAS_MANAGER_VIEW_MODE,
  DEFAULT_CANVAS_MINIMAP_VISIBLE,
  DEFAULT_CANVAS_SNAP_TO_GRID,
  DEFAULT_CANVAS_WHEEL_BEHAVIOR,
  DEFAULT_CANVAS_ZOOM,
  normalizeCanvasGridGap,
  normalizeCanvasGridStyle,
  normalizeCanvasInsertBehavior,
  normalizeCanvasManagerSortMode,
  normalizeCanvasManagerViewMode,
  normalizeCanvasWheelBehavior,
  normalizeCanvasZoom,
  type CanvasGridStyle,
  type CanvasInsertBehavior,
  type CanvasManagerSortMode,
  type CanvasManagerViewMode,
  type CanvasWheelBehavior,
} from '@/lib/canvas/preferences'

export const DEVELOPER_MODE_CHANGED_EVENT = 'notegen://developer-mode-changed'

export enum GenTemplateRange {
  All = 'all',
  Today = 'today',
  Week = 'week',
  Month = 'month',
  ThreeMonth = 'threeMonth',
  Year = 'year',
}

export interface GenTemplate {
  id: string
  title: string
  status: boolean
  content: string
  range: GenTemplateRange
}

export type CloseBehavior = 'minimize' | 'quit' | 'ask'

interface SettingState {
  initSettingData: () => Promise<void>

  version: string
  setVersion: () => Promise<void>

  autoUpdate: boolean
  setAutoUpdate: (autoUpdate: boolean) => void

  language: string
  setLanguage: (language: string) => void

  appFontFamily: string
  setAppFontFamily: (fontFamily: string) => Promise<void>

  closeBehavior: CloseBehavior
  setCloseBehavior: (behavior: CloseBehavior) => Promise<void>

  autostartMinimized: boolean
  setAutostartMinimized: (enabled: boolean) => Promise<void>

  developerMode: boolean
  setDeveloperMode: (enabled: boolean) => Promise<void>

  developerPerformanceInfo: boolean
  setDeveloperPerformanceInfo: (enabled: boolean) => void

  // setting - ai - 当前选择的模型 key
  currentAi: string
  setCurrentAi: (currentAi: string) => void

  aiModelList: AiConfig[]
  setAiModelList: (aiModelList: AiConfig[]) => void

  primaryModel: string
  setPrimaryModel: (primaryModel: string) => void

  editorModel: string
  setEditorModel: (editorModel: string) => Promise<void>

  placeholderModel: string
  setPlaceholderModel: (placeholderModel: string) => Promise<void>

  completionModel: string
  setCompletionModel: (completionModel: string) => Promise<void>

  markDescModel: string
  setMarkDescModel: (markDescModel: string) => Promise<void>

  commitModel: string
  setCommitModel: (commitModel: string) => Promise<void>

  embeddingModel: string
  setEmbeddingModel: (embeddingModel: string) => Promise<void>

  rerankingModel: string
  setRerankingModel: (rerankingModel: string) => Promise<void>

  imageMethodModel: string
  setImageMethodModel: (imageMethodModel: string) => Promise<void>

  audioModel: string
  setAudioModel: (audioModel: string) => Promise<void>

  sttModel: string
  setSttModel: (sttModel: string) => Promise<void>

  textToSpeechMode: SpeechMode
  setTextToSpeechMode: (mode: SpeechMode) => Promise<void>

  speechToTextMode: SpeechMode
  setSpeechToTextMode: (mode: SpeechMode) => Promise<void>

  systemPrompt: string
  setSystemPrompt: (systemPrompt: string) => Promise<void>

  agentPermissionMode: AgentPermissionMode
  setAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>

  templateList: GenTemplate[]
  setTemplateList: (templateList: GenTemplate[]) => Promise<void>

  darkMode: string
  setDarkMode: (darkMode: string) => void

  previewTheme: string
  setPreviewTheme: (previewTheme: string) => void

  codeTheme: string
  setCodeTheme: (codeTheme: string) => void

  // Github 相关设置
  githubUsername: string
  setGithubUsername: (githubUsername: string) => Promise<void>

  accessToken: string
  setAccessToken: (accessToken: string) => void

  jsdelivr: boolean
  setJsdelivr: (jsdelivr: boolean) => void

  useImageRepo: boolean
  setUseImageRepo: (useImageRepo: boolean) => Promise<void>

  autoSync: string
  setAutoSync: (autoSync: string) => Promise<void>

  autoRecordSyncEnabled: boolean
  setAutoRecordSyncEnabled: (enabled: boolean) => Promise<void>

  autoSettingsSyncEnabled: boolean
  setAutoSettingsSyncEnabled: (enabled: boolean) => Promise<void>

  autoConversationSyncEnabled: boolean
  setAutoConversationSyncEnabled: (enabled: boolean) => Promise<void>

  excludeSensitiveConfig: boolean
  setExcludeSensitiveConfig: (enabled: boolean) => Promise<void>

  // 自动拉取相关设置
  autoPullOnOpen: boolean
  setAutoPullOnOpen: (autoPullOnOpen: boolean) => Promise<void>

  // Gitee 相关设置
  giteeAccessToken: string
  setGiteeAccessToken: (giteeAccessToken: string) => void

  giteeAutoSync: string
  setGiteeAutoSync: (giteeAutoSync: string) => Promise<void>

  // Gitlab 相关设置
  gitlabInstanceType: GitlabInstanceType
  setGitlabInstanceType: (instanceType: GitlabInstanceType) => Promise<void>

  gitlabCustomUrl: string
  setGitlabCustomUrl: (customUrl: string) => Promise<void>

  gitlabAccessToken: string
  setGitlabAccessToken: (gitlabAccessToken: string) => void

  gitlabAutoSync: string
  setGitlabAutoSync: (gitlabAutoSync: string) => Promise<void>

  gitlabUsername: string
  setGitlabUsername: (gitlabUsername: string) => Promise<void>

  // Gitea 相关设置
  giteaInstanceType: GiteaInstanceType
  setGiteaInstanceType: (instanceType: GiteaInstanceType) => Promise<void>

  giteaCustomUrl: string
  setGiteaCustomUrl: (customUrl: string) => Promise<void>

  giteaAccessToken: string
  setGiteaAccessToken: (giteaAccessToken: string) => void

  giteaAutoSync: string
  setGiteaAutoSync: (giteaAutoSync: string) => Promise<void>

  giteaUsername: string
  setGiteaUsername: (giteaUsername: string) => Promise<void>

  // 主要备份方式设置
  primaryBackupMethod: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'
  setPrimaryBackupMethod: (method: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted') => Promise<void>

  lastSettingPage: string
  setLastSettingPage: (page: string) => Promise<void>

  workspacePath: string
  setWorkspacePath: (path: string) => Promise<void>

  // 工作区历史路径
  workspaceHistory: string[]
  addWorkspaceHistory: (path: string) => Promise<void>
  removeWorkspaceHistory: (path: string) => Promise<void>
  clearWorkspaceHistory: () => Promise<void>

  assetsPath: string
  setAssetsPath: (path: string) => Promise<void>

  // 图床设置
  githubImageAccessToken: string
  setGithubImageAccessToken: (githubImageAccessToken: string) => Promise<void>

  // 自定义仓库名称设置
  githubCustomSyncRepo: string
  setGithubCustomSyncRepo: (repo: string, workspacePath?: string) => Promise<void>

  giteeCustomSyncRepo: string
  setGiteeCustomSyncRepo: (repo: string, workspacePath?: string) => Promise<void>

  gitlabCustomSyncRepo: string
  setGitlabCustomSyncRepo: (repo: string, workspacePath?: string) => Promise<void>

  giteaCustomSyncRepo: string
  setGiteaCustomSyncRepo: (repo: string, workspacePath?: string) => Promise<void>

  githubCustomImageRepo: string
  setGithubCustomImageRepo: (repo: string) => Promise<void>

  // 图片识别设置
  enableImageRecognition: boolean
  setEnableImageRecognition: (enable: boolean) => Promise<void>

  // 界面缩放设置
  uiScale: number
  setUiScale: (scale: number) => Promise<void>

  // 正文文字大小缩放设置
  contentTextScale: number
  setContentTextScale: (scale: number) => Promise<void>

  // 文件管理器文字大小设置
  fileManagerTextSize: string
  setFileManagerTextSize: (size: string) => Promise<void>

  // 记录文字大小设置
  recordTextSize: string
  setRecordTextSize: (size: string) => Promise<void>

  // 自定义主题颜色设置
  customThemeColors: CustomThemeColors
  setCustomThemeColors: (colors: CustomThemeColors) => Promise<void>
  resetCustomThemeColors: () => Promise<void>

  // 记录工具栏配置
  recordToolbarConfig: RecordToolbarItem[]
  setRecordToolbarConfig: (config: RecordToolbarItem[]) => Promise<void>

  recordViewMode: RecordViewMode
  setRecordViewMode: (mode: RecordViewMode) => Promise<void>

  recordSortMode: RecordSortMode
  setRecordSortMode: (mode: RecordSortMode) => Promise<void>

  recordSaveTargetMode: RecordSaveTargetMode
  setRecordSaveTargetMode: (mode: RecordSaveTargetMode) => Promise<void>

  fixedRecordTagId: number | null
  setFixedRecordTagId: (tagId: number | null) => Promise<void>

  lastRecordTagId: number | null
  setLastRecordTagId: (tagId: number | null) => Promise<void>

  recordCompletionBehavior: RecordCompletionBehavior
  setRecordCompletionBehavior: (behavior: RecordCompletionBehavior) => Promise<void>

  // 移动端保留原生统计；桌面端由官方插件提供。
  showEditorStats: boolean
  setShowEditorStats: (show: boolean) => Promise<void>

  // 编辑器撤销/重做按钮显示设置
  showEditorUndoRedo: boolean
  setShowEditorUndoRedo: (show: boolean) => Promise<void>

  showSourceLineNumbers: boolean
  setShowSourceLineNumbers: (show: boolean) => Promise<void>

  editorSourceWrap: boolean
  setEditorSourceWrap: (wrap: boolean) => Promise<void>

  showMobileEditorToolbar: boolean
  setShowMobileEditorToolbar: (show: boolean) => Promise<void>

  editorContentWidth: EditorContentWidth
  setEditorContentWidth: (width: EditorContentWidth) => Promise<void>

  editorLineHeight: EditorLineHeight
  setEditorLineHeight: (lineHeight: EditorLineHeight) => Promise<void>

  editorViewMode: EditorViewMode
  setEditorViewMode: (viewMode: EditorViewMode) => Promise<void>

  enableOutline: boolean
  setEnableOutline: (enable: boolean) => Promise<void>

  outlinePosition: OutlinePosition
  setOutlinePosition: (position: OutlinePosition) => Promise<void>

  canvasGridVisible: boolean
  setCanvasGridVisible: (visible: boolean) => Promise<void>

  canvasSnapToGrid: boolean
  setCanvasSnapToGrid: (enabled: boolean) => Promise<void>

  canvasMinimapVisible: boolean
  setCanvasMinimapVisible: (visible: boolean) => Promise<void>

  canvasGridStyle: CanvasGridStyle
  setCanvasGridStyle: (style: CanvasGridStyle) => Promise<void>

  canvasGridGap: number
  setCanvasGridGap: (gap: number) => Promise<void>

  canvasDefaultZoom: number
  setCanvasDefaultZoom: (zoom: number) => Promise<void>

  canvasManagerViewMode: CanvasManagerViewMode
  setCanvasManagerViewMode: (mode: CanvasManagerViewMode) => Promise<void>

  canvasManagerSortMode: CanvasManagerSortMode
  setCanvasManagerSortMode: (mode: CanvasManagerSortMode) => Promise<void>

  canvasWheelBehavior: CanvasWheelBehavior
  setCanvasWheelBehavior: (behavior: CanvasWheelBehavior) => Promise<void>

  canvasInsertBehavior: CanvasInsertBehavior
  setCanvasInsertBehavior: (behavior: CanvasInsertBehavior) => Promise<void>

}

export interface RecordToolbarItem {
  id: string
  enabled: boolean
  order: number
}

let settingAutoSyncReady = false
let settingAutoSyncSubscriptionInitialized = false
const SETTING_LOCAL_PERSIST_DEBOUNCE_MS = 300
let pendingSettingPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingSettingPersistState: SettingState | null = null
const pendingSettingPersistKeys = new Set<string>()
const pendingSettingSyncKeys = new Set<string>()
let settingPersistQueue = Promise.resolve()

function getChangedSettingKeys(current: SettingState, previous: SettingState): string[] {
  const currentRecord = current as unknown as Record<string, unknown>
  const previousRecord = previous as unknown as Record<string, unknown>

  return Object.keys(currentRecord).filter((key) => {
    if (typeof currentRecord[key] === 'function') {
      return false
    }

    return currentRecord[key] !== previousRecord[key]
  })
}

function getSyncableSettingKeys(state: SettingState, changedKeys: string[]): string[] {
  const excludeSensitiveConfig = state.excludeSensitiveConfig !== false
  return changedKeys.filter(key => !shouldExcludeFromSync(key, { excludeSensitiveConfig }))
}

function initSettingAutoSyncSubscription() {
  if (settingAutoSyncSubscriptionInitialized) {
    return
  }

  settingAutoSyncSubscriptionInitialized = true

  useSettingStore.subscribe((current, previous) => {
    if (!settingAutoSyncReady || isAutoDataSyncApplyingRemote()) {
      return
    }

    const changedKeys = getChangedSettingKeys(current, previous)
    if (changedKeys.length === 0) {
      return
    }

    scheduleChangedSettingsPersist(
      current,
      changedKeys,
      getSyncableSettingKeys(current, changedKeys),
    )
  })

  window.addEventListener('pagehide', () => {
    void flushChangedSyncableSettingsPersist()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushChangedSyncableSettingsPersist()
    }
  })
}

function scheduleChangedSettingsPersist(
  state: SettingState,
  changedKeys: string[],
  syncableKeys: string[],
) {
  pendingSettingPersistState = state
  changedKeys.forEach(key => pendingSettingPersistKeys.add(key))
  syncableKeys.forEach(key => pendingSettingSyncKeys.add(key))

  if (pendingSettingPersistTimer) {
    clearTimeout(pendingSettingPersistTimer)
  }

  pendingSettingPersistTimer = setTimeout(() => {
    pendingSettingPersistTimer = null
    void flushChangedSyncableSettingsPersist()
  }, SETTING_LOCAL_PERSIST_DEBOUNCE_MS)
}

async function flushChangedSyncableSettingsPersist() {
  if (pendingSettingPersistTimer) {
    clearTimeout(pendingSettingPersistTimer)
    pendingSettingPersistTimer = null
  }

  const state = pendingSettingPersistState
  const changedKeys = Array.from(pendingSettingPersistKeys)
  const syncableKeys = Array.from(pendingSettingSyncKeys)
  pendingSettingPersistState = null
  pendingSettingPersistKeys.clear()
  pendingSettingSyncKeys.clear()
  if (!state || changedKeys.length === 0) return

  settingPersistQueue = settingPersistQueue
    .then(() => persistChangedSettings(state, changedKeys, syncableKeys))
    .catch(error => {
      console.error('Failed to persist changed settings:', error)
    })
  await settingPersistQueue
}

async function persistChangedSettings(
  state: SettingState,
  changedKeys: string[],
  syncableKeys: string[],
) {
  const store = await Store.load('store.json')
  const stateRecord = state as unknown as Record<string, unknown>

  for (const key of changedKeys) {
    await store.set(key, stateRecord[key])
  }

  await store.save()
  if (syncableKeys.length > 0) {
    enqueueAutoDataSync('settings', `settings:${syncableKeys.join(',')}`)
  }
}


const useSettingStore = create<SettingState>((set, get) => ({
  initSettingData: async () => {
    const store = await Store.load('store.json');
    await get().setVersion()

    const legacyAutoDataSyncEnabled = await store.get<boolean>('autoDataSyncEnabled')
    if (await store.get<boolean>('autoRecordSyncEnabled') === undefined) {
      await store.set('autoRecordSyncEnabled', legacyAutoDataSyncEnabled !== false)
    }
    if (await store.get<boolean>('autoSettingsSyncEnabled') === undefined) {
      await store.set('autoSettingsSyncEnabled', legacyAutoDataSyncEnabled !== false)
    }
    const shouldInitializeConversationSync = await store.get<boolean>('autoConversationSyncEnabled') === undefined
    if (shouldInitializeConversationSync) {
      await store.set('autoConversationSyncEnabled', true)
    }

    let preferencesChanged = false
    const storedEditorContentWidth = await store.get('editorContentWidth')
    if (storedEditorContentWidth === undefined) {
      const legacyCenteredContent = await store.get<boolean>('centeredContent')
      await store.set(
        'editorContentWidth',
        legacyCenteredContent === true ? 'standard' : DEFAULT_EDITOR_CONTENT_WIDTH
      )
      preferencesChanged = true
    } else {
      const normalizedContentWidth = normalizeEditorContentWidth(storedEditorContentWidth)
      if (normalizedContentWidth !== storedEditorContentWidth) {
        await store.set('editorContentWidth', normalizedContentWidth)
        preferencesChanged = true
      }
    }

    const storedEditorLineHeight = await store.get('editorLineHeight')
    const normalizedLineHeight = normalizeEditorLineHeight(storedEditorLineHeight)
    if (normalizedLineHeight !== storedEditorLineHeight) {
      await store.set('editorLineHeight', normalizedLineHeight)
      preferencesChanged = true
    }

    const storedEditorViewMode = await store.get('editorViewMode')
    const normalizedViewMode = normalizeEditorViewMode(storedEditorViewMode)
    if (normalizedViewMode !== storedEditorViewMode) {
      await store.set('editorViewMode', normalizedViewMode)
      preferencesChanged = true
    }

    const storedOutlinePosition = await store.get('outlinePosition')
    const normalizedOutlinePosition = normalizeOutlinePosition(storedOutlinePosition)
    if (normalizedOutlinePosition !== storedOutlinePosition) {
      await store.set('outlinePosition', normalizedOutlinePosition)
      preferencesChanged = true
    }

    const storedRecordViewMode = await store.get('recordViewMode')
    const normalizedRecordViewMode = normalizeRecordViewMode(storedRecordViewMode)
    if (normalizedRecordViewMode !== storedRecordViewMode) {
      await store.set('recordViewMode', normalizedRecordViewMode)
      preferencesChanged = true
    }

    const storedRecordSortMode = await store.get('recordSortMode')
    const normalizedRecordSortMode = normalizeRecordSortMode(storedRecordSortMode)
    if (normalizedRecordSortMode !== storedRecordSortMode) {
      await store.set('recordSortMode', normalizedRecordSortMode)
      preferencesChanged = true
    }

    const storedRecordSaveTargetMode = await store.get('recordSaveTargetMode')
    const normalizedRecordSaveTargetMode = normalizeRecordSaveTargetMode(storedRecordSaveTargetMode)
    if (normalizedRecordSaveTargetMode !== storedRecordSaveTargetMode) {
      await store.set('recordSaveTargetMode', normalizedRecordSaveTargetMode)
      preferencesChanged = true
    }

    const storedFixedRecordTagId = await store.get('fixedRecordTagId')
    const normalizedFixedRecordTagId = normalizeRecordTagId(storedFixedRecordTagId)
    if (normalizedFixedRecordTagId !== storedFixedRecordTagId) {
      await store.set('fixedRecordTagId', normalizedFixedRecordTagId)
      preferencesChanged = true
    }

    const storedLastRecordTagId = await store.get('lastRecordTagId')
    const normalizedLastRecordTagId = normalizeRecordTagId(storedLastRecordTagId)
    if (normalizedLastRecordTagId !== storedLastRecordTagId) {
      await store.set('lastRecordTagId', normalizedLastRecordTagId)
      preferencesChanged = true
    }

    const storedRecordCompletionBehavior = await store.get('recordCompletionBehavior')
    const normalizedRecordCompletionBehavior = normalizeRecordCompletionBehavior(storedRecordCompletionBehavior)
    if (normalizedRecordCompletionBehavior !== storedRecordCompletionBehavior) {
      await store.set('recordCompletionBehavior', normalizedRecordCompletionBehavior)
      preferencesChanged = true
    }

    const storedCanvasGridStyle = await store.get('canvasGridStyle')
    const normalizedCanvasGridStyle = normalizeCanvasGridStyle(storedCanvasGridStyle)
    if (normalizedCanvasGridStyle !== storedCanvasGridStyle) {
      await store.set('canvasGridStyle', normalizedCanvasGridStyle)
      preferencesChanged = true
    }

    const storedCanvasGridGap = await store.get('canvasGridGap')
    const normalizedCanvasGridGap = normalizeCanvasGridGap(storedCanvasGridGap)
    if (normalizedCanvasGridGap !== storedCanvasGridGap) {
      await store.set('canvasGridGap', normalizedCanvasGridGap)
      preferencesChanged = true
    }

    const storedCanvasDefaultZoom = await store.get('canvasDefaultZoom')
    const normalizedCanvasDefaultZoom = normalizeCanvasZoom(storedCanvasDefaultZoom)
    if (normalizedCanvasDefaultZoom !== storedCanvasDefaultZoom) {
      await store.set('canvasDefaultZoom', normalizedCanvasDefaultZoom)
      preferencesChanged = true
    }

    const storedCanvasManagerViewMode = await store.get('canvasManagerViewMode')
    const legacyCanvasManagerViewMode = typeof window !== 'undefined'
      ? window.localStorage.getItem('canvas-manager-view-mode')
      : null
    const normalizedCanvasManagerViewMode = normalizeCanvasManagerViewMode(
      storedCanvasManagerViewMode ?? legacyCanvasManagerViewMode
    )
    if (normalizedCanvasManagerViewMode !== storedCanvasManagerViewMode) {
      await store.set('canvasManagerViewMode', normalizedCanvasManagerViewMode)
      preferencesChanged = true
    }

    const storedCanvasManagerSortMode = await store.get('canvasManagerSortMode')
    const legacyCanvasManagerSortMode = typeof window !== 'undefined'
      ? window.localStorage.getItem('canvas-manager-sort-mode')
      : null
    const normalizedCanvasManagerSortMode = normalizeCanvasManagerSortMode(
      storedCanvasManagerSortMode ?? legacyCanvasManagerSortMode
    )
    if (normalizedCanvasManagerSortMode !== storedCanvasManagerSortMode) {
      await store.set('canvasManagerSortMode', normalizedCanvasManagerSortMode)
      preferencesChanged = true
    }

    const storedCanvasWheelBehavior = await store.get('canvasWheelBehavior')
    const normalizedCanvasWheelBehavior = normalizeCanvasWheelBehavior(storedCanvasWheelBehavior)
    if (normalizedCanvasWheelBehavior !== storedCanvasWheelBehavior) {
      await store.set('canvasWheelBehavior', normalizedCanvasWheelBehavior)
      preferencesChanged = true
    }

    const storedCanvasInsertBehavior = await store.get('canvasInsertBehavior')
    const normalizedCanvasInsertBehavior = normalizeCanvasInsertBehavior(storedCanvasInsertBehavior)
    if (normalizedCanvasInsertBehavior !== storedCanvasInsertBehavior) {
      await store.set('canvasInsertBehavior', normalizedCanvasInsertBehavior)
      preferencesChanged = true
    }

    if (preferencesChanged) {
      await store.save()
    }

    // 初始化图床配置
    const savedUseImageRepo = await store.get<boolean>('useImageRepo')
    if (savedUseImageRepo !== undefined && savedUseImageRepo !== null) {
      set({ useImageRepo: savedUseImageRepo })
    }

    // 初始化默认的NoteGen模型配置
    const storedAiModelList = (await store.get('aiModelList') as AiConfig[]) || []
    const existingAiModelList = await isMainlandChinaAppStore()
      ? excludeBuiltInOpenAIProviders(storedAiModelList)
      : storedAiModelList
    const hasNoteGenModels = existingAiModelList.some(config => 
      config.key === 'note-gen-free' || 
      noteGenModelKeys.includes(config.key) ||
      config.models?.some(model => noteGenModelKeys.includes(model.id))
    )
    
    const noteGenDefaultConfig = await loadNoteGenDefaultConfig(noteGenDefaultModels[0])
    let finalAiModelList = applyNoteGenDefaultConfig(existingAiModelList, noteGenDefaultConfig)
    if (JSON.stringify(finalAiModelList) !== JSON.stringify(existingAiModelList)) {
      await store.set('aiModelList', finalAiModelList)
      set({ aiModelList: finalAiModelList })
    }

    // 检查是否设置了主要模型，如果没有且存在note-gen-chat，则设置为主要模型
    const currentPrimaryModel = await store.get('primaryModel') as string
    const hasNoteGenChat = finalAiModelList.some(config => 
      config.models?.some(model => model.id === 'note-gen-chat') || config.key === 'note-gen-chat'
    )
    
    if (!currentPrimaryModel && hasNoteGenChat) {
      const noteGenFreeConfig = finalAiModelList.find(config => config.key === 'note-gen-free')
      if (noteGenFreeConfig?.models?.some(model => model.id === 'note-gen-chat')) {
        await store.set('primaryModel', 'note-gen-chat')
        set({ primaryModel: 'note-gen-chat' })
      } else {
        await store.set('primaryModel', 'note-gen-chat')
        set({ primaryModel: 'note-gen-chat' })
      }
    }

    // 检查是否设置了嵌入模型，如果没有且存在note-gen-embedding，则设置为默认嵌入模型
    const currentEmbeddingModel = await store.get('embeddingModel') as string
    const hasNoteGenEmbedding = finalAiModelList.some(config => 
      config.models?.some(model => model.id === 'note-gen-embedding') || config.key === 'note-gen-embedding'
    )
    
    if (!currentEmbeddingModel && hasNoteGenEmbedding) {
      const noteGenFreeConfig = finalAiModelList.find(config => config.key === 'note-gen-free')
      if (noteGenFreeConfig?.models?.some(model => model.id === 'note-gen-embedding')) {
        await store.set('embeddingModel', 'note-gen-embedding')
        set({ embeddingModel: 'note-gen-embedding' })
      } else {
        await store.set('embeddingModel', 'note-gen-embedding')
        set({ embeddingModel: 'note-gen-embedding' })
      }
    }

    // 检查是否设置了TTS模型，如果没有且存在note-gen-tts，则设置为默认TTS模型
    const currentAudioModel = await store.get('audioModel') as string
    const hasNoteGenTTS = finalAiModelList.some(config => 
      config.models?.some(model => model.modelType === 'tts') || config.modelType === 'tts'
    )
    
    if (!currentAudioModel && hasNoteGenTTS) {
      // 查找第一个可用的TTS模型
      for (const config of finalAiModelList) {
        if (config.models && config.models.length > 0) {
          const ttsModel = config.models.find(model => model.modelType === 'tts')
          if (ttsModel) {
            await store.set('audioModel', `${config.key}-${ttsModel.id}`)
            set({ audioModel: `${config.key}-${ttsModel.id}` })
            break
          }
        } else if (config.modelType === 'tts') {
          await store.set('audioModel', config.key)
          set({ audioModel: config.key })
          break
        }
      }
    }

    // 检查是否设置了STT模型，如果没有且存在note-gen-stt，则设置为默认STT模型
    const currentSttModel = await store.get('sttModel') as string
    const hasNoteGenSTT = finalAiModelList.some(config => 
      config.models?.some(model => model.modelType === 'stt') || config.modelType === 'stt'
    )
    
    if (!currentSttModel && hasNoteGenSTT) {
      // 查找第一个可用的STT模型
      for (const config of finalAiModelList) {
        if (config.models && config.models.length > 0) {
          const sttModel = config.models.find(model => model.modelType === 'stt')
          if (sttModel) {
            await store.set('sttModel', `${config.key}-${sttModel.id}`)
            set({ sttModel: `${config.key}-${sttModel.id}` })
            break
          }
        } else if (config.modelType === 'stt') {
          await store.set('sttModel', config.key)
          set({ sttModel: config.key })
          break
        }
      }
    }

    const currentTextToSpeechMode = await store.get('textToSpeechMode')
    set({ textToSpeechMode: normalizeSpeechMode(currentTextToSpeechMode) })

    const currentSpeechToTextMode = await store.get('speechToTextMode')
    set({ speechToTextMode: normalizeSpeechMode(currentSpeechToTextMode) })

    // 检查并初始化其他模型类型
    const modelTypes = [
      { storeKey: 'completionModel', modelType: 'chat' },
      { storeKey: 'markDescModel', modelType: 'chat' },
      { storeKey: 'commitModel', modelType: 'chat' }
    ]

    for (const { storeKey, modelType } of modelTypes) {
      const currentModel = await store.get(storeKey) as string
      if (!currentModel) {
        // 查找第一个可用的聊天模型作为默认值
        const noteGenFreeConfig = finalAiModelList.find(config => config.key === 'note-gen-free')
        if (noteGenFreeConfig?.models?.some(model => model.id === 'note-gen-chat' && model.modelType === modelType)) {
          await store.set(storeKey, 'note-gen-chat')
          set({ [storeKey]: 'note-gen-chat' })
        } else {
          // 查找其他可用的聊天模型
          for (const config of finalAiModelList) {
            if (config.models && config.models.length > 0) {
              const chatModel = config.models.find(model => model.modelType === modelType)
              if (chatModel) {
                await store.set(storeKey, `${config.key}-${chatModel.id}`)
                set({ [storeKey]: `${config.key}-${chatModel.id}` })
                break
              }
            } else if (config.modelType === modelType || !config.modelType) {
              await store.set(storeKey, config.key)
              set({ [storeKey]: config.key })
              break
            }
          }
        }
      }
    }

    // 获取 NoteGen 限时免费模型
    // 如果服务不可用,静默失败,不影响用户使用自己的模型
    try {
      const apiKey = noteGenDefaultModels[0].apiKey
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
      const res = await fetch('https://api.notegen.top/v1/models', {
        method: 'GET',
        headers
      })

      // 检查响应状态
      if (!res.ok) {
        throw new Error(`API responded with status: ${res.status}`)
      }

      const resModels = await res.json()

      if (resModels.data && resModels.data.length > 0) {
        // 移除旧的 NoteGen Limited 配置
        finalAiModelList = finalAiModelList.filter(model => 
          model.title !== 'NoteGen Limited' && model.key !== 'note-gen-limited'
        )
        
        // 过滤出不在默认模型中的限时免费模型
        const limitedModels = resModels.data.filter((model: any) => {
          // 检查是否在 noteGenDefaultModels 的 models 数组中
          const noteGenFreeConfig = finalAiModelList.find(config => config.key === 'note-gen-free')
          return !noteGenFreeConfig?.models?.some(defaultModel => defaultModel.model === model.id)
        })
        
        // 如果有限时免费模型,创建统一的 NoteGen Limited 配置
        if (limitedModels.length > 0) {
          const noteGenLimitedConfig = {
            apiKey,
            baseURL: "https://api.notegen.top/v1",
            key: "note-gen-limited",
            title: "NoteGen Limited",
            models: limitedModels.map((model: any) => ({
              id: `note-gen-limited-${model.id}`,
              model: model.id,
              modelType: "chat",
              temperature: 0.7,
              topP: 1,
              enableStream: true
            }))
          }
          
          finalAiModelList.push(noteGenLimitedConfig)
          await store.set('aiModelList', finalAiModelList)
          set({ aiModelList: finalAiModelList })
        }
      }
    } catch (error) {
      // 静默处理错误,不影响应用初始化和用户使用自己的模型
      console.debug('NoteGen API service unavailable, skipping limited models:', error)
    }

    const hydratedSettings: Record<string, unknown> = {}
    const storedPromptExtension = await store.get<string>('agentSystemPromptExtension')
    const legacySystemPrompt = await store.get<string>('systemPrompt')
    const promptExtension = typeof storedPromptExtension === 'string'
      ? storedPromptExtension
      : typeof legacySystemPrompt === 'string' && !isManagedAgentSystemPrompt(legacySystemPrompt)
        ? legacySystemPrompt
        : ''
    await store.set('agentSystemPromptExtension', promptExtension)
    await store.set('agentCorePromptVersion', AGENT_CORE_PROMPT_VERSION)
    hydratedSettings.systemPrompt = promptExtension

    await Promise.all(Object.entries(get()).map(async ([key, value]) => {
      if (key === 'systemPrompt') return
      const res = await store.get(key)

      if (typeof value === 'function') return
      if (res !== undefined && key !== 'version') {
        if (key === 'aiModelList' && hasNoteGenModels) {
          // 如果已经有NoteGen模型，使用存储的配置
          hydratedSettings[key] = res as AiConfig[]
        } else if (key === 'recordToolbarConfig') {
          // 确保包含所有工具，如果缺少新工具则自动添加
          const storedConfig = res as RecordToolbarItem[]
          const defaultConfig = value as RecordToolbarItem[]

          // 检查是否有缺失的工具
          const missingTools = defaultConfig.filter(
            defaultItem => !storedConfig.some(stored => stored.id === defaultItem.id)
          )

          if (missingTools.length > 0) {
            // 合并配置：保留用户的顺序和启用状态，添加新工具
            const mergedConfig = [...storedConfig]
            let maxOrder = Math.max(...storedConfig.map(item => item.order), 0)

            missingTools.forEach(tool => {
              mergedConfig.push({ ...tool, order: ++maxOrder })
            })

            await store.set(key, mergedConfig)
            hydratedSettings[key] = mergedConfig
          } else {
            hydratedSettings[key] = res as RecordToolbarItem[]
          }
        } else if (key !== 'aiModelList') {
          hydratedSettings[key] = res
        }
      } else {
        await store.set(key, value)
      }
    }))
    await store.save()

    const workspacePath = typeof hydratedSettings.workspacePath === 'string'
      ? hydratedSettings.workspacePath
      : get().workspacePath
    const workspaceRepos = await getWorkspaceSyncRepos(workspacePath)

    set({
      ...hydratedSettings,
      githubCustomSyncRepo: workspaceRepos.github || '',
      giteeCustomSyncRepo: workspaceRepos.gitee || '',
      gitlabCustomSyncRepo: workspaceRepos.gitlab || '',
      giteaCustomSyncRepo: workspaceRepos.gitea || '',
    } as Partial<SettingState>)

    initSettingAutoSyncSubscription()
    settingAutoSyncReady = true
  },

  version: '',
  setVersion: async () => {
    const version = await getVersion()
    set({ version })
  },

  autoUpdate: true,
  setAutoUpdate: (autoUpdate) => set({ autoUpdate }),

  language: '简体中文',
  setLanguage: (language) => set({ language }),

  appFontFamily: APP_FONT_SYSTEM_VALUE,
  setAppFontFamily: async (fontFamily) => {
    set({ appFontFamily: fontFamily })
    applyAppFontFamily(fontFamily)
    const store = await Store.load('store.json')
    await store.set('appFontFamily', fontFamily)
    await store.save()
  },

  closeBehavior: 'minimize',
  setCloseBehavior: async (closeBehavior) => {
    set({ closeBehavior })
    const store = await Store.load('store.json')
    await store.set('closeBehavior', closeBehavior)
    await store.save()
  },

  autostartMinimized: false,
  setAutostartMinimized: async (autostartMinimized) => {
    set({ autostartMinimized })
    const store = await Store.load('store.json')
    await store.set('autostartMinimized', autostartMinimized)
    await store.save()
  },

  developerMode: false,
  setDeveloperMode: async (developerMode) => {
    set({ developerMode })
    const store = await Store.load('store.json')
    await store.set('developerMode', developerMode)
    await store.save()
    await emit(DEVELOPER_MODE_CHANGED_EVENT, developerMode).catch(() => undefined)
  },

  developerPerformanceInfo: false,
  setDeveloperPerformanceInfo: (developerPerformanceInfo) => set({ developerPerformanceInfo }),

  currentAi: '',
  setCurrentAi: (currentAi) => set({ currentAi }),

  aiModelList: [],
  setAiModelList: (aiModelList) => set({ aiModelList }),

  primaryModel: '',
  setPrimaryModel: (primaryModel) => set({ primaryModel }),

  editorModel: '',
  setEditorModel: async (editorModel) => {
    set({ editorModel })
    const store = await Store.load('store.json')
    await store.set('editorModel', editorModel)
    await store.save()
  },

  placeholderModel: '',
  setPlaceholderModel: async (placeholderModel) => {
    const store = await Store.load('store.json');
    await store.set('placeholderModel', placeholderModel)
    set({ placeholderModel })
  },

  completionModel: '',
  setCompletionModel: async (completionModel) => {
    const store = await Store.load('store.json');
    await store.set('completionModel', completionModel)
    set({ completionModel })
  },

  markDescModel: '',
  setMarkDescModel: async (markDescModel) => {
    const store = await Store.load('store.json');
    await store.set('markDescModel', markDescModel)
    set({ markDescModel })
  },

  commitModel: '',
  setCommitModel: async (commitModel) => {
    const store = await Store.load('store.json');
    await store.set('commitModel', commitModel)
    set({ commitModel })
  },

  embeddingModel: '',
  setEmbeddingModel: async (embeddingModel) => {
    const store = await Store.load('store.json');
    await store.set('embeddingModel', embeddingModel)
    set({ embeddingModel })
    const {
      reconcileMemoryEmbeddingModel,
      reindexPendingMemories,
    } = await import('@/db/memories')
    await reconcileMemoryEmbeddingModel()
    void reindexPendingMemories()
  },

  rerankingModel: '',
  setRerankingModel: async (rerankingModel) => {
    const store = await Store.load('store.json');
    await store.set('rerankingModel', rerankingModel)
    set({ rerankingModel })
  },

  imageMethodModel: '',
  setImageMethodModel: async (imageMethodModel) => {
    const store = await Store.load('store.json');
    await store.set('imageMethodModel', imageMethodModel)
    set({ imageMethodModel })
  },

  audioModel: '',
  setAudioModel: async (audioModel) => {
    const store = await Store.load('store.json');
    await store.set('audioModel', audioModel)
    set({ audioModel })
  },

  sttModel: '',
  setSttModel: async (sttModel) => {
    const store = await Store.load('store.json');
    await store.set('sttModel', sttModel)
    set({ sttModel })
  },

  textToSpeechMode: 'auto',
  setTextToSpeechMode: async (mode) => {
    const normalizedMode = normalizeSpeechMode(mode)
    const store = await Store.load('store.json')
    await store.set('textToSpeechMode', normalizedMode)
    set({ textToSpeechMode: normalizedMode })
  },

  speechToTextMode: 'auto',
  setSpeechToTextMode: async (mode) => {
    const normalizedMode = normalizeSpeechMode(mode)
    const store = await Store.load('store.json')
    await store.set('speechToTextMode', normalizedMode)
    set({ speechToTextMode: normalizedMode })
  },

  systemPrompt: '',
  setSystemPrompt: async (systemPrompt) => {
    set({ systemPrompt })
    const store = await Store.load('store.json')
    await store.set('agentSystemPromptExtension', systemPrompt)
    await store.set('agentCorePromptVersion', AGENT_CORE_PROMPT_VERSION)
    await store.save()
  },

  agentPermissionMode: 'ask',
  setAgentPermissionMode: async (agentPermissionMode) => {
    set({ agentPermissionMode })
    const store = await Store.load('store.json')
    await store.set('agentPermissionMode', agentPermissionMode)
    await store.save()
  },

  templateList: [
    {
      id: '0',
      title: '笔记',
      content: `整理成一篇详细完整的笔记。
满足以下格式要求：
- 如果是代码，必须完整保留，不要随意生成。
- 文字复制的内容尽量不要修改，只处理格式化后的内容。`,
      status: true,
      range: GenTemplateRange.All
    },
    {
      id: '1',
      title: '周报',
      content: '最近一周的记录整理成一篇周报，将每条记录形成一句总结，每条不超过50字。',
      status: true,
      range: GenTemplateRange.Week
    }
  ],
  setTemplateList: async (templateList) => {
    set({ templateList })
    const store = await Store.load('store.json')
    await store.set('templateList', templateList)
  },

  darkMode: 'system',
  setDarkMode: (darkMode) => set({ darkMode }),

  previewTheme: 'github',
  setPreviewTheme: (previewTheme) => set({ previewTheme }),

  codeTheme: 'github',
  setCodeTheme: (codeTheme) => set({ codeTheme }),

  githubUsername: '',
  setGithubUsername: async (githubUsername) => {
    set({ githubUsername })
    const store = await Store.load('store.json');
    store.set('githubUsername', githubUsername)
  },

  accessToken: '',
  setAccessToken: async (accessToken) => {
    const store = await Store.load('store.json');
    const hasAccessToken = await store.get('accessToken') === accessToken
    if (!hasAccessToken) {
      await get().setGithubUsername('')
    }
    set({ accessToken })
  },

  jsdelivr: true,
  setJsdelivr: async (jsdelivr: boolean) => {
    set({ jsdelivr })
    const store = await Store.load('store.json');
    await store.set('jsdelivr', jsdelivr)
  },

  useImageRepo: false,
  setUseImageRepo: async (useImageRepo: boolean) => {
    set({ useImageRepo })
    const store = await Store.load('store.json');
    await store.set('useImageRepo', useImageRepo)
    if (useImageRepo) {
      const normalizedImageHosting = getNormalizedImageHosting(await store.get<string>('mainImageHosting'))
      if (normalizedImageHosting.shouldPersist) {
        await store.set('mainImageHosting', normalizedImageHosting.value)
      }
    }
    await store.save()
  },

  autoSync: '5',
  setAutoSync: async (autoSync: string) => {
    set({ autoSync })
    const store = await Store.load('store.json');
    await store.set('autoSync', autoSync)
  },

  autoRecordSyncEnabled: true,
  setAutoRecordSyncEnabled: async (autoRecordSyncEnabled: boolean) => {
    set({ autoRecordSyncEnabled })
    const store = await Store.load('store.json')
    await store.set('autoRecordSyncEnabled', autoRecordSyncEnabled)
    await store.set(
      'autoDataSyncEnabled',
      autoRecordSyncEnabled || get().autoSettingsSyncEnabled || get().autoConversationSyncEnabled,
    )
    await store.save()
    if (autoRecordSyncEnabled) enqueueAutoDataSync('records', 'records-sync-enabled')
  },

  autoSettingsSyncEnabled: true,
  setAutoSettingsSyncEnabled: async (autoSettingsSyncEnabled: boolean) => {
    set({ autoSettingsSyncEnabled })
    const store = await Store.load('store.json')
    await store.set('autoSettingsSyncEnabled', autoSettingsSyncEnabled)
    await store.set(
      'autoDataSyncEnabled',
      autoSettingsSyncEnabled || get().autoRecordSyncEnabled || get().autoConversationSyncEnabled,
    )
    await store.save()
    if (autoSettingsSyncEnabled) enqueueAutoDataSync('settings', 'settings-sync-enabled')
  },

  autoConversationSyncEnabled: true,
  setAutoConversationSyncEnabled: async (autoConversationSyncEnabled: boolean) => {
    set({ autoConversationSyncEnabled })
    const store = await Store.load('store.json')
    await store.set('autoConversationSyncEnabled', autoConversationSyncEnabled)
    await store.set(
      'autoDataSyncEnabled',
      autoConversationSyncEnabled || get().autoRecordSyncEnabled || get().autoSettingsSyncEnabled,
    )
    await store.save()
    if (autoConversationSyncEnabled) {
      enqueueAutoDataSync('conversations', 'conversations-sync-enabled')
    }
  },

  excludeSensitiveConfig: true,
  setExcludeSensitiveConfig: async (excludeSensitiveConfig: boolean) => {
    set({ excludeSensitiveConfig })
    const store = await Store.load('store.json')
    await store.set('excludeSensitiveConfig', excludeSensitiveConfig)
    await store.save()

    if (!isAutoDataSyncApplyingRemote()) {
      enqueueAutoDataSync('settings', 'settings:exclude-sensitive-config')
    }
  },

  // 自动拉取相关设置 - 默认开启
  autoPullOnOpen: true,
  setAutoPullOnOpen: async (autoPullOnOpen: boolean) => {
    set({ autoPullOnOpen })
    const store = await Store.load('store.json');
    await store.set('autoPullOnOpen', autoPullOnOpen)

    // 同步更新 sync-manager 的配置
    try {
      const { getSyncManager } = await import('@/lib/sync/sync-manager')
      const manager = getSyncManager()
      await manager.updateConfig({ autoPullOnOpen })
    } catch {
      // 静默处理
    }
  },

  lastSettingPage: 'about',
  setLastSettingPage: async (page: string) => {
    set({ lastSettingPage: page })
    const store = await Store.load('store.json');
    await store.set('lastSettingPage', page)
  },

  workspacePath: '',
  setWorkspacePath: async (path: string) => {
    const { getSyncPushQueue } = await import('@/lib/sync/sync-push-queue')
    const syncPushQueue = getSyncPushQueue()
    await syncPushQueue.prepareForWorkspaceSwitch()
    const { waitForLocalMcpWorkspaceWrites } = await import('@/lib/local-mcp/workspace-guard')
    await waitForLocalMcpWorkspaceWrites()

    try {
      const { invalidateMemoryCache } = await import('@/lib/memory/cache-version')
      invalidateMemoryCache()
      const store = await Store.load('store.json');
      const {
        beginEditorWorkspaceTransition,
        finishEditorWorkspaceTransition,
        flushEditorStatePersistence,
        default: useArticleStore,
      } = await import('@/stores/article')
      const articleState = useArticleStore.getState()
      const { prepareActiveEditorDeactivationDurably } = await import('@/lib/editor-deactivation')
      if (!await prepareActiveEditorDeactivationDurably(articleState.activeFilePath)) {
        throw new Error('Unable to save the active editor before switching workspace')
      }
      await articleState.flushAllPendingArticleSaves()
      await articleState.settleAllVectorCalculations()
      await flushEditorStatePersistence()
      const workspaceRepos = await getWorkspaceSyncRepos(path)
      await beginEditorWorkspaceTransition()
      try {
        await articleState.clearTabs()
        await articleState.setActiveFilePath('', true, {
          deactivationAlreadyPrepared: true,
          persistWorkspaceActiveFilePath: false,
          workspaceTransitionReset: true,
        })
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        await articleState.flushAllPendingArticleSaves()
        await articleState.settleAllVectorCalculations()
        await flushEditorStatePersistence()
        await store.set('workspacePath', path)
        await store.set('openTabs', [])
        await store.set('activeTabId', '')
        await store.set('activeFilePath', '')
        set({
          workspacePath: path,
          githubCustomSyncRepo: workspaceRepos.github || '',
          giteeCustomSyncRepo: workspaceRepos.gitee || '',
          gitlabCustomSyncRepo: workspaceRepos.gitlab || '',
          giteaCustomSyncRepo: workspaceRepos.gitea || '',
        })
      } finally {
        finishEditorWorkspaceTransition()
      }

      const { default: useSyncStore } = await import('@/stores/sync')
      const { SyncStateEnum } = await import('@/lib/sync/github.types')
      useSyncStore.setState({
        syncRepoState: SyncStateEnum.fail,
        syncRepoInfo: undefined,
        giteeSyncRepoState: SyncStateEnum.fail,
        giteeSyncRepoInfo: undefined,
        gitlabSyncProjectState: SyncStateEnum.fail,
        gitlabSyncProjectInfo: undefined,
        giteaSyncRepoState: SyncStateEnum.fail,
        giteaSyncRepoInfo: undefined,
      })

      // 如果路径不为空且不在历史记录中，则添加到历史记录
      if (path && !get().workspaceHistory.includes(path)) {
        await get().addWorkspaceHistory(path)
      }
      const { refreshSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/lifecycle')
      await refreshSelfHostedSyncRuntime()
    } finally {
      syncPushQueue.finishWorkspaceSwitch()
    }
  },

  // 工作区历史路径管理
  workspaceHistory: [],
  addWorkspaceHistory: async (path: string) => {
    const currentHistory = get().workspaceHistory
    const newHistory = [path, ...currentHistory.filter(p => p !== path)].slice(0, 10) // 最多保存10个历史路径
    set({ workspaceHistory: newHistory })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', newHistory)
    await store.save()
  },
  removeWorkspaceHistory: async (path: string) => {
    const newHistory = get().workspaceHistory.filter(p => p !== path)
    set({ workspaceHistory: newHistory })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', newHistory)
    await store.save()
  },
  clearWorkspaceHistory: async () => {
    set({ workspaceHistory: [] })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', [])
    await store.save()
  },

  // Gitee 相关设置
  giteeAccessToken: '',
  setGiteeAccessToken: async (giteeAccessToken: string) => {
    set({ giteeAccessToken })
    const store = await Store.load('store.json');
    await store.set('giteeAccessToken', giteeAccessToken)
  },

  giteeAutoSync: 'disabled',
  setGiteeAutoSync: async (giteeAutoSync: string) => {
    set({ giteeAutoSync })
    const store = await Store.load('store.json');
    await store.set('giteeAutoSync', giteeAutoSync)
  },

  // Gitlab 相关设置
  gitlabInstanceType: GitlabInstanceType.OFFICIAL,
  setGitlabInstanceType: async (instanceType: GitlabInstanceType) => {
    const store = await Store.load('store.json')
    await store.set('gitlabInstanceType', instanceType)
    await store.save()
    set({ gitlabInstanceType: instanceType })
  },

  gitlabCustomUrl: '',
  setGitlabCustomUrl: async (customUrl: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabCustomUrl', customUrl)
    await store.save()
    set({ gitlabCustomUrl: customUrl })
  },

  gitlabAccessToken: '',
  setGitlabAccessToken: (gitlabAccessToken: string) => {
    set({ gitlabAccessToken })
  },

  gitlabAutoSync: 'disabled',
  setGitlabAutoSync: async (gitlabAutoSync: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabAutoSync', gitlabAutoSync)
    await store.save()
    set({ gitlabAutoSync })
  },

  gitlabUsername: '',
  setGitlabUsername: async (gitlabUsername: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabUsername', gitlabUsername)
    await store.save()
    set({ gitlabUsername })
  },

  // Gitea 相关实现
  giteaInstanceType: GiteaInstanceType.OFFICIAL,
  setGiteaInstanceType: async (instanceType: GiteaInstanceType) => {
    const store = await Store.load('store.json')
    await store.set('giteaInstanceType', instanceType)
    await store.save()
    set({ giteaInstanceType: instanceType })
  },

  giteaCustomUrl: '',
  setGiteaCustomUrl: async (customUrl: string) => {
    const store = await Store.load('store.json')
    await store.set('giteaCustomUrl', customUrl)
    await store.save()
    set({ giteaCustomUrl: customUrl })
  },

  giteaAccessToken: '',
  setGiteaAccessToken: (giteaAccessToken: string) => {
    set({ giteaAccessToken })
  },

  giteaAutoSync: 'disabled',
  setGiteaAutoSync: async (giteaAutoSync: string) => {
    set({ giteaAutoSync })
    const store = await Store.load('store.json');
    await store.set('giteaAutoSync', giteaAutoSync)
    await store.save()
  },

  giteaUsername: '',
  setGiteaUsername: async (giteaUsername: string) => {
    const store = await Store.load('store.json')
    await store.set('giteaUsername', giteaUsername)
    await store.save()
    set({ giteaUsername })
  },

  giteaCustomSyncRepo: '',
  setGiteaCustomSyncRepo: async (repo: string, workspacePath = get().workspacePath) => {
    await setWorkspaceSyncRepo('gitea', repo, workspacePath)
    if (workspacePath === get().workspacePath) set({ giteaCustomSyncRepo: repo })
  },

  // 默认使用 GitHub 作为主要备份方式
  primaryBackupMethod: 'github',
  setPrimaryBackupMethod: async (method: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted') => {
    if (method === get().primaryBackupMethod) return

    const [{ getSyncPushQueue }, autoDataSyncQueue] = await Promise.all([
      import('@/lib/sync/sync-push-queue'),
      import('@/lib/sync/auto-data-sync-queue'),
    ])
    const syncPushQueue = getSyncPushQueue()
    await Promise.all([
      syncPushQueue.prepareForWorkspaceSwitch(),
      autoDataSyncQueue.prepareAutoDataSyncForRepositoryChange(),
    ])

    try {
      const store = await Store.load('store.json')
      await store.set('primaryBackupMethod', method)
      await store.save()
      set({ primaryBackupMethod: method })
      const { refreshSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/lifecycle')
      await refreshSelfHostedSyncRuntime()
    } finally {
      syncPushQueue.finishWorkspaceSwitch()
      autoDataSyncQueue.finishAutoDataSyncRepositoryChange()
    }
  },

  assetsPath: 'assets',
  setAssetsPath: async (path: string) => {
    set({ assetsPath: path })
    const store = await Store.load('store.json');
    await store.set('assetsPath', path)
    await store.save()
  },

  // 图床设置
  githubImageAccessToken: '',
  setGithubImageAccessToken: async (githubImageAccessToken: string) => {
    set({ githubImageAccessToken })
    const store = await Store.load('store.json');
    await store.set('githubImageAccessToken', githubImageAccessToken)
    await store.save()
  },

  // 图片识别设置
  enableImageRecognition: true,
  setEnableImageRecognition: async (enable: boolean) => {
    set({ enableImageRecognition: enable })
    const store = await Store.load('store.json');
    await store.set('enableImageRecognition', enable)
    await store.save()
  },

  // 界面缩放设置 (75%, 100%, 125%, 150%)
  uiScale: 100,
  setUiScale: async (scale: number) => {
    set({ uiScale: scale })
    const store = await Store.load('store.json');
    await store.set('uiScale', scale)
    await store.save()
    
    // 使用fontSize实现基于rem的缩放
    document.documentElement.style.fontSize = `${scale}%`
  },

  // 正文文字大小缩放设置 (75%, 100%, 125%, 150%)
  contentTextScale: 100,
  setContentTextScale: async (scale: number) => {
    set({ contentTextScale: scale })
    const store = await Store.load('store.json');
    await store.set('contentTextScale', scale)
    await store.save()
  },

  // 文件管理器文字大小设置 (xs, sm, md, lg, xl)
  fileManagerTextSize: 'sm',
  setFileManagerTextSize: async (size: string) => {
    set({ fileManagerTextSize: size })
    const store = await Store.load('store.json');
    await store.set('fileManagerTextSize', size)
    await store.save()
  },

  // 记录文字大小设置 (xs, sm, md, lg, xl)
  recordTextSize: 'sm',
  setRecordTextSize: async (size: string) => {
    set({ recordTextSize: size })
    const store = await Store.load('store.json');
    await store.set('recordTextSize', size)
    await store.save()
  },

  // 自定义主题颜色设置
  customThemeColors: {
    light: {
      background: null,
      foreground: null,
      card: null,
      cardForeground: null,
      primary: null,
      primaryForeground: null,
      secondary: null,
      secondaryForeground: null,
      third: null,
      thirdForeground: null,
      muted: null,
      mutedForeground: null,
      accent: null,
      accentForeground: null,
      border: null,
      shadow: null,
    },
    dark: {
      background: null,
      foreground: null,
      card: null,
      cardForeground: null,
      primary: null,
      primaryForeground: null,
      secondary: null,
      secondaryForeground: null,
      third: null,
      thirdForeground: null,
      muted: null,
      mutedForeground: null,
      accent: null,
      accentForeground: null,
      border: null,
      shadow: null,
    },
  },
  setCustomThemeColors: async (colors: CustomThemeColors) => {
    set({ customThemeColors: colors })
    const store = await Store.load('store.json');
    await store.set('customThemeColors', colors)
    await store.save()

    // 应用主题颜色（同时应用亮色和暗色主题）
    applyThemeColors(colors)
  },
  resetCustomThemeColors: async () => {
    const defaultColors: CustomThemeColors = {
      light: {
        background: null,
        foreground: null,
        card: null,
        cardForeground: null,
        primary: null,
        primaryForeground: null,
        secondary: null,
        secondaryForeground: null,
        third: null,
        thirdForeground: null,
        muted: null,
        mutedForeground: null,
        accent: null,
        accentForeground: null,
        border: null,
        shadow: null,
      },
      dark: {
        background: null,
        foreground: null,
        card: null,
        cardForeground: null,
        primary: null,
        primaryForeground: null,
        secondary: null,
        secondaryForeground: null,
        third: null,
        thirdForeground: null,
        muted: null,
        mutedForeground: null,
        accent: null,
        accentForeground: null,
        border: null,
        shadow: null,
      },
    }
    set({ customThemeColors: defaultColors })
    const store = await Store.load('store.json');
    await store.set('customThemeColors', defaultColors)
    await store.save()

    // 清除自定义主题颜色
    removeThemeColors()
  },

  // 自定义仓库名称设置
  githubCustomSyncRepo: '',
  setGithubCustomSyncRepo: async (repo: string, workspacePath = get().workspacePath) => {
    await setWorkspaceSyncRepo('github', repo, workspacePath)
    if (workspacePath === get().workspacePath) set({ githubCustomSyncRepo: repo })
  },

  giteeCustomSyncRepo: '',
  setGiteeCustomSyncRepo: async (repo: string, workspacePath = get().workspacePath) => {
    await setWorkspaceSyncRepo('gitee', repo, workspacePath)
    if (workspacePath === get().workspacePath) set({ giteeCustomSyncRepo: repo })
  },

  gitlabCustomSyncRepo: '',
  setGitlabCustomSyncRepo: async (repo: string, workspacePath = get().workspacePath) => {
    await setWorkspaceSyncRepo('gitlab', repo, workspacePath)
    if (workspacePath === get().workspacePath) set({ gitlabCustomSyncRepo: repo })
  },

  githubCustomImageRepo: '',
  setGithubCustomImageRepo: async (repo: string) => {
    set({ githubCustomImageRepo: repo })
    const store = await Store.load('store.json');
    await store.set('githubCustomImageRepo', repo)
    await store.save()
  },

  // 记录工具栏配置
  recordToolbarConfig: [
    { id: 'text', enabled: true, order: 0 },
    { id: 'recording', enabled: true, order: 1 },
    { id: 'scan', enabled: true, order: 2 },
    { id: 'image', enabled: true, order: 3 },
    { id: 'link', enabled: true, order: 4 },
    { id: 'file', enabled: true, order: 5 },
    { id: 'todo', enabled: true, order: 6 },
  ],
  setRecordToolbarConfig: async (config: RecordToolbarItem[]) => {
    set({ recordToolbarConfig: config })
    const store = await Store.load('store.json');
    await store.set('recordToolbarConfig', config)
    await store.save()
  },

  recordViewMode: DEFAULT_RECORD_VIEW_MODE,
  setRecordViewMode: async (mode) => {
    const recordViewMode = normalizeRecordViewMode(mode)
    set({ recordViewMode })
    const store = await Store.load('store.json')
    await store.set('recordViewMode', recordViewMode)
    await store.save()
  },

  recordSortMode: DEFAULT_RECORD_SORT_MODE,
  setRecordSortMode: async (mode) => {
    const recordSortMode = normalizeRecordSortMode(mode)
    set({ recordSortMode })
    const store = await Store.load('store.json')
    await store.set('recordSortMode', recordSortMode)
    await store.save()
  },

  recordSaveTargetMode: DEFAULT_RECORD_SAVE_TARGET_MODE,
  setRecordSaveTargetMode: async (mode) => {
    const recordSaveTargetMode = normalizeRecordSaveTargetMode(mode)
    set({ recordSaveTargetMode })
    const store = await Store.load('store.json')
    await store.set('recordSaveTargetMode', recordSaveTargetMode)
    await store.save()
  },

  fixedRecordTagId: null,
  setFixedRecordTagId: async (tagId) => {
    const fixedRecordTagId = normalizeRecordTagId(tagId)
    set({ fixedRecordTagId })
    const store = await Store.load('store.json')
    await store.set('fixedRecordTagId', fixedRecordTagId)
    await store.save()
  },

  lastRecordTagId: null,
  setLastRecordTagId: async (tagId) => {
    const lastRecordTagId = normalizeRecordTagId(tagId)
    set({ lastRecordTagId })
    const store = await Store.load('store.json')
    await store.set('lastRecordTagId', lastRecordTagId)
    await store.save()
  },

  recordCompletionBehavior: DEFAULT_RECORD_COMPLETION_BEHAVIOR,
  setRecordCompletionBehavior: async (behavior) => {
    const recordCompletionBehavior = normalizeRecordCompletionBehavior(behavior)
    set({ recordCompletionBehavior })
    const store = await Store.load('store.json')
    await store.set('recordCompletionBehavior', recordCompletionBehavior)
    await store.save()
  },

  // 保留旧偏好键，移动端默认显示统计。
  showEditorStats: true,
  setShowEditorStats: async (show: boolean) => {
    const store = await Store.load('store.json')
    await store.set('showEditorStats', show)
    await store.save()
    set({ showEditorStats: show })
  },

  // 编辑器撤销/重做按钮显示设置 - 默认开启
  showEditorUndoRedo: true,
  setShowEditorUndoRedo: async (show: boolean) => {
    set({ showEditorUndoRedo: show })
    const store = await Store.load('store.json');
    await store.set('showEditorUndoRedo', show)
    await store.save()
  },

  showSourceLineNumbers: true,
  setShowSourceLineNumbers: async (showSourceLineNumbers) => {
    set({ showSourceLineNumbers })
    const store = await Store.load('store.json')
    await store.set('showSourceLineNumbers', showSourceLineNumbers)
    await store.save()
  },

  editorSourceWrap: true,
  setEditorSourceWrap: async (editorSourceWrap) => {
    set({ editorSourceWrap })
    const store = await Store.load('store.json')
    await store.set('editorSourceWrap', editorSourceWrap)
    await store.save()
  },

  showMobileEditorToolbar: true,
  setShowMobileEditorToolbar: async (showMobileEditorToolbar) => {
    set({ showMobileEditorToolbar })
    const store = await Store.load('store.json')
    await store.set('showMobileEditorToolbar', showMobileEditorToolbar)
    await store.save()
  },

  editorContentWidth: DEFAULT_EDITOR_CONTENT_WIDTH,
  setEditorContentWidth: async (editorContentWidth) => {
    set({ editorContentWidth })
    const store = await Store.load('store.json')
    await store.set('editorContentWidth', editorContentWidth)
    await store.save()
  },

  editorLineHeight: DEFAULT_EDITOR_LINE_HEIGHT,
  setEditorLineHeight: async (editorLineHeight) => {
    set({ editorLineHeight })
    const store = await Store.load('store.json')
    await store.set('editorLineHeight', editorLineHeight)
    await store.save()
  },

  editorViewMode: DEFAULT_EDITOR_VIEW_MODE,
  setEditorViewMode: async (editorViewMode) => {
    if (
      editorViewMode !== get().editorViewMode
      && !prepareActiveEditorDeactivation()
    ) return
    set({ editorViewMode })
    const store = await Store.load('store.json')
    await store.set('editorViewMode', editorViewMode)
    await store.save()
  },

  enableOutline: false,
  setEnableOutline: async (enableOutline) => {
    set({ enableOutline })
    const store = await Store.load('store.json')
    await store.set('enableOutline', enableOutline)
    await store.save()
  },

  outlinePosition: DEFAULT_OUTLINE_POSITION,
  setOutlinePosition: async (outlinePosition) => {
    set({ outlinePosition })
    const store = await Store.load('store.json')
    await store.set('outlinePosition', outlinePosition)
    await store.save()
  },

  canvasGridVisible: DEFAULT_CANVAS_GRID_VISIBLE,
  setCanvasGridVisible: async (canvasGridVisible) => {
    set({ canvasGridVisible })
    const store = await Store.load('store.json')
    await store.set('canvasGridVisible', canvasGridVisible)
    await store.save()
  },

  canvasSnapToGrid: DEFAULT_CANVAS_SNAP_TO_GRID,
  setCanvasSnapToGrid: async (canvasSnapToGrid) => {
    set({ canvasSnapToGrid })
    const store = await Store.load('store.json')
    await store.set('canvasSnapToGrid', canvasSnapToGrid)
    await store.save()
  },

  canvasMinimapVisible: DEFAULT_CANVAS_MINIMAP_VISIBLE,
  setCanvasMinimapVisible: async (canvasMinimapVisible) => {
    set({ canvasMinimapVisible })
    const store = await Store.load('store.json')
    await store.set('canvasMinimapVisible', canvasMinimapVisible)
    await store.save()
  },

  canvasGridStyle: DEFAULT_CANVAS_GRID_STYLE,
  setCanvasGridStyle: async (style) => {
    const canvasGridStyle = normalizeCanvasGridStyle(style)
    set({ canvasGridStyle })
    const store = await Store.load('store.json')
    await store.set('canvasGridStyle', canvasGridStyle)
    await store.save()
  },

  canvasGridGap: DEFAULT_CANVAS_GRID_GAP,
  setCanvasGridGap: async (gap) => {
    const canvasGridGap = normalizeCanvasGridGap(gap)
    set({ canvasGridGap })
    const store = await Store.load('store.json')
    await store.set('canvasGridGap', canvasGridGap)
    await store.save()
  },

  canvasDefaultZoom: DEFAULT_CANVAS_ZOOM,
  setCanvasDefaultZoom: async (zoom) => {
    const canvasDefaultZoom = normalizeCanvasZoom(zoom)
    set({ canvasDefaultZoom })
    const store = await Store.load('store.json')
    await store.set('canvasDefaultZoom', canvasDefaultZoom)
    await store.save()
  },

  canvasManagerViewMode: DEFAULT_CANVAS_MANAGER_VIEW_MODE,
  setCanvasManagerViewMode: async (mode) => {
    const canvasManagerViewMode = normalizeCanvasManagerViewMode(mode)
    set({ canvasManagerViewMode })
    const store = await Store.load('store.json')
    await store.set('canvasManagerViewMode', canvasManagerViewMode)
    await store.save()
  },

  canvasManagerSortMode: DEFAULT_CANVAS_MANAGER_SORT_MODE,
  setCanvasManagerSortMode: async (mode) => {
    const canvasManagerSortMode = normalizeCanvasManagerSortMode(mode)
    set({ canvasManagerSortMode })
    const store = await Store.load('store.json')
    await store.set('canvasManagerSortMode', canvasManagerSortMode)
    await store.save()
  },

  canvasWheelBehavior: DEFAULT_CANVAS_WHEEL_BEHAVIOR,
  setCanvasWheelBehavior: async (behavior) => {
    const canvasWheelBehavior = normalizeCanvasWheelBehavior(behavior)
    set({ canvasWheelBehavior })
    const store = await Store.load('store.json')
    await store.set('canvasWheelBehavior', canvasWheelBehavior)
    await store.save()
  },

  canvasInsertBehavior: DEFAULT_CANVAS_INSERT_BEHAVIOR,
  setCanvasInsertBehavior: async (behavior) => {
    const canvasInsertBehavior = normalizeCanvasInsertBehavior(behavior)
    set({ canvasInsertBehavior })
    const store = await Store.load('store.json')
    await store.set('canvasInsertBehavior', canvasInsertBehavior)
    await store.save()
  },
}))

export default useSettingStore
