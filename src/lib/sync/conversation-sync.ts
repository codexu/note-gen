import { BaseDirectory, exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { deleteFile as deleteGithubFile, getFiles as githubGetFiles, uploadFile as uploadGithubFile } from './github'
import { deleteFile as deleteGiteeFile, getFiles as giteeGetFiles, uploadFile as uploadGiteeFile } from './gitee'
import { deleteFile as deleteGitlabFile, getFileContent as gitlabGetFileContent, getFiles as gitlabGetFiles, uploadFile as uploadGitlabFile } from './gitlab'
import { deleteFile as deleteGiteaFile, getFileContent as giteaGetFileContent, getFiles as giteaGetFiles, uploadFile as uploadGiteaFile } from './gitea'
import { s3Delete, s3Download, s3Upload } from './s3'
import { webdavDelete, webdavDownload, webdavUpload } from './webdav'
import { cloudFolderDelete, cloudFolderDownload, cloudFolderUpload } from './cloud-folder'
import { decodeBase64ToString, getRemoteFileContent, parseSyncJson, syncDataError } from './remote-file'
import { getDataSyncRepoName } from './repo-utils'
import {
  downloadRemoteBytes,
  getRemoteContentType,
  remoteFileExists,
  uploadRemoteBytes,
  getOneDriveCreateOnlyCondition,
} from './remote-library'
import type { CloudFolderConfig, S3Config, WebDAVConfig, SyncPlatform } from '@/types/sync'
import type { Chat, ChatType, Role } from '@/db/chats'
import type { ConversationCompaction } from '@/db/conversation-compactions'
import type { ConversationSyncTombstone } from '@/db/conversation-sync-state'
import { v5 as uuidv5 } from 'uuid'
import { recordSyncTiming } from './sync-timing'
import { CONVERSATION_ASSETS_DIRECTORY, resolveConversationAssetPath } from '@/lib/conversation-assets'

export const CONVERSATION_SYNC_DIRECTORY = '.data/conversations'
export const CONVERSATION_SYNC_INDEX_PATH = `${CONVERSATION_SYNC_DIRECTORY}/index.json`
export const CONVERSATION_SYNC_ITEMS_DIRECTORY = `${CONVERSATION_SYNC_DIRECTORY}/items`
export const CONVERSATION_SYNC_ASSETS_DIRECTORY = '.data/assets/conversations'
export const LEGACY_CHATS_SYNC_PATH = '.data/chats.json'

const LOCAL_CONVERSATION_ASSETS_DIRECTORY = CONVERSATION_ASSETS_DIRECTORY
const CONVERSATION_SYNC_INDEX_FORMAT = 'notegen-conversations-index'
const CONVERSATION_SYNC_ITEM_FORMAT = 'notegen-conversation'
const CONVERSATION_SYNC_VERSION = 1
const HTTP_URL_PATTERN = /^https?:\/\//i
const DATA_URL_PATTERN = /^data:/i
const CONVERSATION_SYNC_VERSIONS_KEY = 'conversationSyncVersions'
const LEGACY_REMOTE_CONVERSATION_NAMESPACE = 'a3d53934-b448-4617-8971-922cf0a73aad'

export interface ConversationSyncMessage {
  syncId: string
  syncUpdatedAt: number
  tagId?: number
  content?: string
  role: Role
  type: ChatType
  image?: string
  images?: string
  imageAnalyses?: string
  attachments?: string
  inserted: boolean
  createdAt: number
  ragSources?: string
  ragSourceDetails?: string
  agentHistory?: string
  thinking?: string
  quoteData?: string
  condensedContent?: string
  condensedAt?: number
}

export interface ConversationSyncCompaction {
  summary: string
  coveredThroughMessageSyncId: string
  tailStartMessageSyncId?: string
  sourceTokenCount: number
  summaryTokenCount: number
  model: string
  promptVersion: number
  retainedTurnCount: number
  prunedToolResultCount: number
  prunedToolTokenCount: number
  revision: number
  createdAt: number
}

export interface ConversationSyncItem {
  format: typeof CONVERSATION_SYNC_ITEM_FORMAT
  version: typeof CONVERSATION_SYNC_VERSION
  syncId: string
  syncUpdatedAt: number
  title: string
  createdAt: number
  updatedAt: number
  isPinned: boolean
  messages: ConversationSyncMessage[]
  messageTombstones: ConversationSyncTombstone[]
  compaction: ConversationSyncCompaction | null
}

export interface ConversationSyncIndexEntry {
  syncId: string
  syncUpdatedAt: number
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  isPinned: boolean
  path: string
}

export interface ConversationSyncIndex {
  format: typeof CONVERSATION_SYNC_INDEX_FORMAT
  version: typeof CONVERSATION_SYNC_VERSION
  updatedAt: number
  conversations: ConversationSyncIndexEntry[]
  deleted: ConversationSyncTombstone[]
}

interface ConversationRemoteStorage {
  read: (path: string) => Promise<string | null>
  write: (path: string, content: string, expectedContent?: string | null) => Promise<boolean>
  remove: (path: string) => Promise<boolean>
}

async function getConversationSyncVersionsKey(store: Store, platform?: SyncPlatform) {
  const provider = platform ?? (await store.get<string>('primaryBackupMethod') || 'github')
  let target: unknown
  if (provider === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    target = config && [config.endpoint, config.region, config.bucket, config.pathPrefix]
  } else if (provider === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    target = config && [config.url, config.pathPrefix, config.username]
  } else if (provider === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    target = config?.path
  } else {
    target = await getDataSyncRepoName(provider as 'github' | 'gitee' | 'gitlab' | 'gitea')
  }
  return `${CONVERSATION_SYNC_VERSIONS_KEY}:${JSON.stringify([provider, target])}`
}

async function getConversationSyncVersions(store: Store) {
  const key = await getConversationSyncVersionsKey(store)
  return await store.get<Record<string, number>>(key) || {}
}

async function setConversationSyncVersions(store: Store, versions: Record<string, number>) {
  await store.set(await getConversationSyncVersionsKey(store), versions)
}

function getConversationItemPath(syncId: string) {
  return `${CONVERSATION_SYNC_ITEMS_DIRECTORY}/${syncId}.json`
}

function getRemoteSha(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const sha = (value as Record<string, unknown>).sha
  return typeof sha === 'string' ? sha : undefined
}

function decodeRemoteContent(value: unknown, path: string) {
  if (!value) return null
  try { return decodeBase64ToString(getRemoteFileContent(value, path)) }
  catch { throw syncDataError('INVALID_SCHEMA', path) }
}

async function createConversationRemoteStorage(store: Store): Promise<ConversationRemoteStorage | null> {
  const storage = await createRawConversationRemoteStorage(store)
  if (!storage) return null
  const provider = await store.get<string>('primaryBackupMethod') || 'github'
  return { ...storage, read: async path => {
    const content = await storage.read(path)
    if (content === null) return null
    const value = parseSyncJson<unknown>(content, `${provider} / ${path}`)
    const normalized = content.replace(/^\uFEFF/, '')
    const valid = path === CONVERSATION_SYNC_INDEX_PATH ? Boolean(parseConversationSyncIndex(normalized))
      : path === LEGACY_CHATS_SYNC_PATH ? Array.isArray(value) && value.every(item => isRecord(item) && typeof item.createdAt === 'number' && chatRoles.has(item.role as Role) && chatTypes.has(item.type as ChatType))
      : Boolean(parseConversationSyncItem(normalized))
    if (!valid) throw syncDataError('INVALID_SCHEMA', `${provider} / ${path}`)
    return content.replace(/^\uFEFF/, '')
  } }
}

async function createRawConversationRemoteStorage(store: Store): Promise<ConversationRemoteStorage | null> {
  const provider = await store.get<string>('primaryBackupMethod') || 'github'

  if (provider === 'github') {
    const repo = await getDataSyncRepoName('github')
    return {
      read: async path => decodeRemoteContent(await githubGetFiles({ path, repo }), path),
      write: async (path, content, expectedContent) => {
        const existing = await githubGetFiles({ path, repo })
        if (expectedContent !== undefined && decodeRemoteContent(existing, path) !== expectedContent) return false
        return Boolean(await uploadGithubFile({
          file: content,
          repo,
          path,
          sha: getRemoteSha(existing),
          message: `Sync conversation ${path.split('/').pop() || 'data'}`,
        }))
      },
      remove: async path => {
        const sha = getRemoteSha(await githubGetFiles({ path, repo }))
        return !sha || Boolean(await deleteGithubFile({ path, repo, sha }))
      },
    }
  }

  if (provider === 'gitee') {
    const repo = await getDataSyncRepoName('gitee')
    return {
      read: async path => decodeRemoteContent(await giteeGetFiles({ path, repo }), path),
      write: async (path, content, expectedContent) => {
        const existing = await giteeGetFiles({ path, repo })
        if (expectedContent !== undefined && decodeRemoteContent(existing, path) !== expectedContent) return false
        return Boolean(await uploadGiteeFile({
          file: content,
          repo,
          path,
          sha: getRemoteSha(existing),
          message: `Sync conversation ${path.split('/').pop() || 'data'}`,
        }))
      },
      remove: async path => {
        const sha = getRemoteSha(await giteeGetFiles({ path, repo }))
        return !sha || Boolean(await deleteGiteeFile({ path, repo, sha }))
      },
    }
  }

  if (provider === 'gitlab') {
    const repo = await getDataSyncRepoName('gitlab')
    return {
      read: async path => decodeRemoteContent(
        await gitlabGetFileContent({ path, repo }),
        path,
      ),
      write: async (path, content, expectedContent) => {
        const existing = await gitlabGetFiles({ path, repo })
        const existingContent = existing
          ? decodeRemoteContent(await gitlabGetFileContent({ path, repo }), path)
          : null
        if (expectedContent !== undefined && existingContent !== expectedContent) return false
        return Boolean(await uploadGitlabFile({
          file: content,
          repo,
          path,
          sha: getRemoteSha(existing),
          message: `Sync conversation ${path.split('/').pop() || 'data'}`,
        }))
      },
      remove: async path => {
        const existing = await gitlabGetFiles({ path, repo })
        return !existing || Boolean(await deleteGitlabFile({ path, repo }))
      },
    }
  }

  if (provider === 'gitea') {
    const repo = await getDataSyncRepoName('gitea')
    return {
      read: async path => decodeRemoteContent(
        await giteaGetFileContent({ path, repo }),
        path,
      ),
      write: async (path, content, expectedContent) => {
        const existing = await giteaGetFiles({ path, repo })
        const existingContent = existing
          ? decodeRemoteContent(await giteaGetFileContent({ path, repo }), path)
          : null
        if (expectedContent !== undefined && existingContent !== expectedContent) return false
        return Boolean(await uploadGiteaFile({
          file: content,
          repo,
          path,
          sha: getRemoteSha(existing),
          message: `Sync conversation ${path.split('/').pop() || 'data'}`,
        }))
      },
      remove: async path => {
        const existing = await giteaGetFiles({ path, repo })
        return !existing || Boolean(await deleteGiteaFile({ path, repo, sha: getRemoteSha(existing) }))
      },
    }
  }

  if (provider === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) return null
    return {
      read: async path => (await s3Download(config, path))?.content ?? null,
      write: async (path, content, expectedContent) => {
        if (expectedContent !== undefined
          && ((await s3Download(config, path))?.content ?? null) !== expectedContent) return false
        return Boolean(await s3Upload(config, path, content))
      },
      remove: async path => s3Delete(config, path),
    }
  }

  if (provider === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (!config) return null
    return {
      read: async path => (await webdavDownload(config, path))?.content ?? null,
      write: async (path, content, expectedContent) => {
        if (expectedContent !== undefined
          && ((await webdavDownload(config, path))?.content ?? null) !== expectedContent) return false
        return Boolean(await webdavUpload(config, path, content))
      },
      remove: async path => webdavDelete(config, path),
    }
  }

  if (provider === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (!config?.path) return null
    const versions = new Map<string, string | null>()
    return {
      read: async path => {
        const file = await cloudFolderDownload(config, path)
        versions.set(path, file?.etag || null)
        return file?.content ?? null
      },
      write: async (path, content, expectedContent) => {
        if (expectedContent !== undefined) {
          const file = await cloudFolderDownload(config, path)
          if ((file?.content ?? null) !== expectedContent) return false
          versions.set(path, file?.etag || null)
        }
        const condition = config.provider === 'oneDrive' && versions.has(path) ? { version: versions.get(path)! } : undefined
        const result = await cloudFolderUpload(config, path, content, condition)
        versions.set(path, result.etag)
        return Boolean(result)
      },
      remove: async path => cloudFolderDelete(config, path,
        config.provider === 'oneDrive' && versions.has(path) ? { version: versions.get(path)! } : undefined),
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePersistedImageAnalyses(value?: string) {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(isRecord) : []
  } catch {
    return []
  }
}

function normalizeTombstone(value: unknown): ConversationSyncTombstone | null {
  if (!isRecord(value)) return null
  if ((value.entityType !== 'conversation' && value.entityType !== 'message')
    || typeof value.syncId !== 'string'
    || typeof value.deletedAt !== 'number') return null
  return {
    entityType: value.entityType,
    syncId: value.syncId,
    conversationSyncId: typeof value.conversationSyncId === 'string'
      ? value.conversationSyncId
      : null,
    deletedAt: value.deletedAt,
  }
}

function normalizeIndexEntry(value: unknown): ConversationSyncIndexEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.syncId !== 'string' || !value.syncId
    || typeof value.syncUpdatedAt !== 'number'
    || typeof value.title !== 'string'
    || typeof value.createdAt !== 'number'
    || typeof value.updatedAt !== 'number'
    || typeof value.messageCount !== 'number'
    || typeof value.isPinned !== 'boolean') return null
  return {
    syncId: value.syncId,
    syncUpdatedAt: value.syncUpdatedAt,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messageCount: value.messageCount,
    isPinned: value.isPinned,
    path: typeof value.path === 'string' ? value.path : getConversationItemPath(value.syncId),
  }
}

export function parseConversationSyncIndex(content: string | null): ConversationSyncIndex | null {
  if (!content) return null
  try {
    const value: unknown = JSON.parse(content)
    if (!isRecord(value)
      || value.format !== CONVERSATION_SYNC_INDEX_FORMAT
      || value.version !== CONVERSATION_SYNC_VERSION
      || !Array.isArray(value.conversations)) return null
    const conversations = value.conversations.map(normalizeIndexEntry)
    const deleted = Array.isArray(value.deleted) ? value.deleted.map(normalizeTombstone) : []
    if (conversations.some(entry => entry === null) || deleted.some(entry => entry === null)) return null
    return {
      format: CONVERSATION_SYNC_INDEX_FORMAT,
      version: CONVERSATION_SYNC_VERSION,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      conversations: conversations.filter((entry): entry is ConversationSyncIndexEntry => entry !== null),
      deleted: deleted.filter((entry): entry is ConversationSyncTombstone => entry !== null),
    }
  } catch {
    return null
  }
}

const chatTypes = new Set<ChatType>([
  'chat',
  'note',
  'clipboard',
  'clear',
  'condensed',
  'model_change',
])
const chatRoles = new Set<Role>(['system', 'user'])

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sanitizeAttachments(value?: string) {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    const sanitized = parsed.flatMap(item => {
      if (!isRecord(item)
        || typeof item.id !== 'string'
        || (item.kind !== 'file' && item.kind !== 'folder')
        || typeof item.name !== 'string'
        || typeof item.readable !== 'boolean') return []
      return [{
        id: item.id,
        kind: item.kind,
        name: item.name,
        size: optionalNumber(item.size),
        extension: optionalString(item.extension),
        readable: item.readable,
        entryCount: optionalNumber(item.entryCount),
        previewTruncated: typeof item.previewTruncated === 'boolean'
          ? item.previewTruncated
          : undefined,
      }]
    })
    return sanitized.length > 0 ? JSON.stringify(sanitized) : undefined
  } catch {
    return undefined
  }
}

function sanitizeRagSourceDetails(value?: string) {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    const sanitized = parsed.flatMap(item => {
      if (!isRecord(item)
        || typeof item.filename !== 'string'
        || typeof item.content !== 'string') return []
      return [{
        // A filename keeps the citation useful without exposing a device path.
        filepath: item.filename,
        filename: item.filename,
        content: item.content,
      }]
    })
    return sanitized.length > 0 ? JSON.stringify(sanitized) : undefined
  } catch {
    return undefined
  }
}

function normalizeSyncImages(value: unknown): string | undefined {
  const text = optionalString(value)
  if (!text) return text
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? JSON.stringify(parsed) : text
  } catch { return undefined }
}
function normalizeSyncImageAnalyses(value: unknown): string | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  const analyses = parsePersistedImageAnalyses(text)
  return analyses.length ? JSON.stringify(analyses) : undefined
}

function normalizeSyncMessage(value: unknown): ConversationSyncMessage | null {
  if (!isRecord(value)) return null
  if (typeof value.syncId !== 'string' || !value.syncId
    || typeof value.syncUpdatedAt !== 'number'
    || typeof value.createdAt !== 'number'
    || typeof value.inserted !== 'boolean'
    || !chatRoles.has(value.role as Role)
    || !chatTypes.has(value.type as ChatType)) return null
  return {
    syncId: value.syncId,
    syncUpdatedAt: value.syncUpdatedAt,
    tagId: optionalNumber(value.tagId) ?? 0,
    content: optionalString(value.content),
    role: value.role as Role,
    type: value.type as ChatType,
    image: optionalString(value.image) || undefined,
    images: normalizeSyncImages(value.images),
    imageAnalyses: normalizeSyncImageAnalyses(value.imageAnalyses),
    attachments: sanitizeAttachments(optionalString(value.attachments)),
    inserted: value.inserted,
    createdAt: value.createdAt,
    ragSources: optionalString(value.ragSources),
    ragSourceDetails: sanitizeRagSourceDetails(optionalString(value.ragSourceDetails)),
    agentHistory: optionalString(value.agentHistory),
    thinking: optionalString(value.thinking),
    quoteData: optionalString(value.quoteData),
    condensedContent: optionalString(value.condensedContent),
    condensedAt: optionalNumber(value.condensedAt),
  }
}

function normalizeCompaction(value: unknown): ConversationSyncCompaction | null {
  if (!isRecord(value)) return null
  if (typeof value.summary !== 'string'
    || typeof value.coveredThroughMessageSyncId !== 'string'
    || typeof value.sourceTokenCount !== 'number'
    || typeof value.summaryTokenCount !== 'number'
    || typeof value.model !== 'string'
    || typeof value.promptVersion !== 'number'
    || typeof value.retainedTurnCount !== 'number'
    || typeof value.prunedToolResultCount !== 'number'
    || typeof value.prunedToolTokenCount !== 'number'
    || typeof value.revision !== 'number'
    || typeof value.createdAt !== 'number') return null
  return {
    summary: value.summary,
    coveredThroughMessageSyncId: value.coveredThroughMessageSyncId,
    tailStartMessageSyncId: optionalString(value.tailStartMessageSyncId),
    sourceTokenCount: value.sourceTokenCount,
    summaryTokenCount: value.summaryTokenCount,
    model: value.model,
    promptVersion: value.promptVersion,
    retainedTurnCount: value.retainedTurnCount,
    prunedToolResultCount: value.prunedToolResultCount,
    prunedToolTokenCount: value.prunedToolTokenCount,
    revision: value.revision,
    createdAt: value.createdAt,
  }
}

const compareSyncIds = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

export function parseConversationSyncItem(content: string | null): ConversationSyncItem | null {
  if (!content) return null
  try {
    const value: unknown = JSON.parse(content)
    if (!isRecord(value)
      || value.format !== CONVERSATION_SYNC_ITEM_FORMAT
      || value.version !== CONVERSATION_SYNC_VERSION
      || typeof value.syncId !== 'string' || !value.syncId
      || typeof value.syncUpdatedAt !== 'number'
      || typeof value.title !== 'string'
      || typeof value.createdAt !== 'number'
      || typeof value.updatedAt !== 'number'
      || typeof value.isPinned !== 'boolean'
      || !Array.isArray(value.messages)) return null
    const messages = value.messages.map(normalizeSyncMessage)
    const messageTombstones = Array.isArray(value.messageTombstones)
      ? value.messageTombstones.map(normalizeTombstone)
      : []
    if (messages.some(message => message === null)
      || messageTombstones.some(tombstone => tombstone === null)) return null
    const compaction = value.compaction === null || value.compaction === undefined
      ? null
      : normalizeCompaction(value.compaction)
    if (value.compaction && !compaction) return null
    const tombstones = new Map<string, ConversationSyncTombstone>()
    for (const tombstone of messageTombstones) {
      if (!tombstone || tombstone.entityType !== 'message' || tombstone.conversationSyncId !== value.syncId) return null
      const previous = tombstones.get(tombstone.syncId)
      if (!previous || previous.deletedAt < tombstone.deletedAt) tombstones.set(tombstone.syncId, tombstone)
    }
    const activeMessages = messages.filter((message): message is ConversationSyncMessage => message !== null && !tombstones.has(message.syncId))
    if (new Set(activeMessages.map(message => message.syncId)).size !== activeMessages.length) return null
    if (compaction && (!activeMessages.some(message => message.syncId === compaction.coveredThroughMessageSyncId)
      || (compaction.tailStartMessageSyncId && !activeMessages.some(message => message.syncId === compaction.tailStartMessageSyncId)))) return null
    return {
      format: CONVERSATION_SYNC_ITEM_FORMAT,
      version: CONVERSATION_SYNC_VERSION,
      syncId: value.syncId,
      syncUpdatedAt: value.syncUpdatedAt,
      title: value.title,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      isPinned: value.isPinned,
      messages: activeMessages.sort((a, b) => a.createdAt - b.createdAt || compareSyncIds(a.syncId, b.syncId)),
      messageTombstones: [...tombstones.values()].sort((a, b) => compareSyncIds(a.syncId, b.syncId)),
      compaction,
    }
  } catch {
    return null
  }
}

function chatToSyncMessage(chat: Chat): ConversationSyncMessage | null {
  if (!chat.syncId || typeof chat.syncUpdatedAt !== 'number' || !Number.isFinite(chat.syncUpdatedAt)) return null
  return {
    syncId: chat.syncId,
    syncUpdatedAt: chat.syncUpdatedAt,
    tagId: chat.tagId,
    content: chat.content,
    role: chat.role,
    type: chat.type,
    image: chat.image,
    images: chat.images,
    imageAnalyses: chat.imageAnalyses,
    attachments: sanitizeAttachments(chat.attachments),
    inserted: Boolean(chat.inserted),
    createdAt: chat.createdAt,
    ragSources: chat.ragSources,
    ragSourceDetails: sanitizeRagSourceDetails(chat.ragSourceDetails),
    agentHistory: chat.agentHistory,
    thinking: chat.thinking,
    quoteData: chat.quoteData,
    condensedContent: chat.condensedContent,
    condensedAt: chat.condensedAt,
  }
}

function compactionToSyncValue(
  compaction: ConversationCompaction | null,
  messages: Chat[]
): ConversationSyncCompaction | null {
  if (!compaction) return null
  const covered = messages.find(message => message.id === compaction.coveredThroughChatId)?.syncId
  const tail = compaction.tailStartChatId
    ? messages.find(message => message.id === compaction.tailStartChatId)?.syncId
    : undefined
  if (!covered) return null
  return {
    summary: compaction.summary,
    coveredThroughMessageSyncId: covered,
    tailStartMessageSyncId: tail,
    sourceTokenCount: compaction.sourceTokenCount,
    summaryTokenCount: compaction.summaryTokenCount,
    model: compaction.model,
    promptVersion: compaction.promptVersion,
    retainedTurnCount: compaction.retainedTurnCount,
    prunedToolResultCount: compaction.prunedToolResultCount,
    prunedToolTokenCount: compaction.prunedToolTokenCount,
    revision: compaction.revision,
    createdAt: compaction.createdAt,
  }
}

export async function getLocalConversationSyncItems(): Promise<ConversationSyncItem[]> {
  const db = await import('@/db').then(module => module.getDb())
  const { getAllConversations } = await import('@/db/conversations')
  const { getLatestConversationCompaction } = await import('@/db/conversation-compactions')
  const { getConversationSyncTombstones } = await import('@/db/conversation-sync-state')
  const conversations = await getAllConversations()
  const tombstones = await getConversationSyncTombstones()
  const items: ConversationSyncItem[] = []

  for (const conversation of conversations) {
    const messages = await db.select<Chat[]>(
      'select * from chats where conversationId = $1 order by createdAt, syncId',
      [conversation.id]
    )
    const syncMessages = messages
      .map(chatToSyncMessage)
      .filter((message): message is ConversationSyncMessage => message !== null)
    const compaction = await getLatestConversationCompaction(conversation.id)
    items.push({
      format: CONVERSATION_SYNC_ITEM_FORMAT,
      version: CONVERSATION_SYNC_VERSION,
      syncId: conversation.syncId,
      syncUpdatedAt: conversation.syncUpdatedAt,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      isPinned: Boolean(conversation.isPinned),
      messages: syncMessages,
      messageTombstones: tombstones.filter(tombstone => (
        tombstone.entityType === 'message'
        && tombstone.conversationSyncId === conversation.syncId
      )),
      compaction: compactionToSyncValue(compaction, messages),
    })
  }
  return items
}

/** Normalize a publication snapshot without contacting a remote or changing saved messages. */
export async function getPlatformSwitchConversationItems() {
  const items = await getLocalConversationSyncItems()
  return await Promise.all(items.map(async item => {
    const normalized = parseConversationSyncItem(JSON.stringify({
      ...item, messages: await Promise.all(item.messages.map(message => normalizeMessageAssets(message, false))),
    }))
    if (!normalized) throw new Error('Invalid local conversation snapshot')
    return normalized
  }))
}

/** The switch controller has already backed up both sides before calling this. */
export async function replacePlatformSwitchConversations(items: ConversationSyncItem[], tombstones: ConversationSyncTombstone[]) {
  const parsed = items.map(item => parseConversationSyncItem(JSON.stringify(item)))
  if (parsed.some(item => !item)) throw new Error('Invalid conversation snapshot')
  const { executeRecordTransaction, getDb } = await import('@/db')
  const db = await getDb()
  const current = await db.select<Array<{ id: number; syncId: string }>>('select id, syncId from conversations')
  const kept = new Set(items.map(item => item.syncId))
  const { getOptionalConversationCleanupTables } = await import('@/db/conversations')
  const optionalMemoryTables = (await getOptionalConversationCleanupTables())
    .filter(table => table.name !== 'conversation_compactions')
  // Keep surviving conversation IDs so local memory jobs keep their references.
  await executeRecordTransaction([
    { sql: 'delete from conversation_compactions', values: [] },
    { sql: 'delete from chats', values: [] },
    { sql: 'delete from conversation_sync_tombstones', values: [] },
    ...current.filter(item => !kept.has(item.syncId)).flatMap(item => [
      ...optionalMemoryTables.map(table => ({
        sql: `delete from ${table.name} where ${table.column} = $1`, values: [item.id],
      })),
      { sql: 'delete from conversations where id = $1', values: [item.id] },
    ]),
  ])
  await persistMergedConversationItems(parsed.filter((item): item is ConversationSyncItem => item !== null), tombstones)
  await refreshConversationStoreAfterSync()
}

export async function acceptPlatformSwitchConversationVersions(items: ConversationSyncItem[], platform: SyncPlatform) {
  const store = await Store.load('store.json')
  await store.set(await getConversationSyncVersionsKey(store, platform), Object.fromEntries(items.map(item => [item.syncId, item.syncUpdatedAt])))
  await store.save()
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function hashBytes(bytes: Uint8Array) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

function getExtension(source: string, mimeType?: string) {
  const mimeExtension = mimeType?.split('/')[1]?.split(/[;+]/)[0]
  if (mimeExtension && /^[a-z0-9]+$/i.test(mimeExtension)) {
    return mimeExtension === 'jpeg' ? 'jpg' : mimeExtension
  }
  const withoutQuery = source.split(/[?#]/)[0]
  const extension = withoutQuery.split('.').pop()?.toLowerCase()
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : 'bin'
}

async function readImageSource(source: string): Promise<{ bytes: Uint8Array; mimeType?: string } | null> {
  if (!source || HTTP_URL_PATTERN.test(source) || source.startsWith('blob:')) return null
  if (DATA_URL_PATTERN.test(source)) {
    const match = source.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/)
    if (!match) return null
    const value = match[3]
    const bytes = match[2]
      ? Uint8Array.from(Buffer.from(value, 'base64'))
      : new TextEncoder().encode(decodeURIComponent(value))
    return { bytes, mimeType: match[1] }
  }

  const path = resolveConversationAssetPath(source)
  if (!path) return null
  try {
    const bytes = await readFile(path, { baseDir: BaseDirectory.AppData })
    return { bytes }
  } catch {
    return null
  }
}

async function ensureLocalConversationAsset(path: string, bytes: Uint8Array) {
  if (!resolveConversationAssetPath(path)) throw new Error('Invalid conversation asset path')
  if (!await exists(LOCAL_CONVERSATION_ASSETS_DIRECTORY, { baseDir: BaseDirectory.AppData })) {
    await mkdir(LOCAL_CONVERSATION_ASSETS_DIRECTORY, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    })
  }
  if (!await exists(path, { baseDir: BaseDirectory.AppData })) {
    await writeFile(path, bytes, { baseDir: BaseDirectory.AppData })
  }
}

async function normalizeAndUploadImageReference(source: string, upload = true) {
  if (!source || HTTP_URL_PATTERN.test(source)) return source
  const createCondition = upload ? await getOneDriveCreateOnlyCondition() : undefined
  const localAssetPath = resolveConversationAssetPath(source)
  if (localAssetPath) {
    const remotePath = `${CONVERSATION_SYNC_ASSETS_DIRECTORY}/${source.split('/').pop() || ''}`
    if (upload && !await remoteFileExists(remotePath, 'data')) {
      const bytes = await readFile(localAssetPath, { baseDir: BaseDirectory.AppData })
      await uploadRemoteBytes(
        remotePath,
        bytes,
        `Upload conversation asset: ${source}`,
        getRemoteContentType(source),
        'data',
        createCondition,
      )
    }
    return source
  }

  const resolved = await readImageSource(source)
  if (!resolved) {
    throw new Error('A local conversation image could not be read; sync was stopped to avoid exposing a device path')
  }
  const hash = await hashBytes(resolved.bytes)
  const extension = getExtension(source, resolved.mimeType)
  const localPath = `${LOCAL_CONVERSATION_ASSETS_DIRECTORY}/${hash}.${extension}`
  const remotePath = `${CONVERSATION_SYNC_ASSETS_DIRECTORY}/${hash}.${extension}`
  await ensureLocalConversationAsset(localPath, resolved.bytes)
  if (upload && !await remoteFileExists(remotePath, 'data')) {
    await uploadRemoteBytes(
      remotePath,
      resolved.bytes,
      `Upload conversation asset: ${hash}.${extension}`,
      resolved.mimeType || getRemoteContentType(localPath),
      'data',
      createCondition,
    )
  }
  return localPath
}

async function normalizeMessageAssets(message: ConversationSyncMessage, upload = true) {
  const references = new Map<string, string>()
  const normalize = async (source: string) => {
    if (!references.has(source)) {
      references.set(source, await normalizeAndUploadImageReference(source, upload))
    }
    return references.get(source) || source
  }

  const image = message.image ? await normalize(message.image) : undefined
  let images = message.images
  if (images) {
    try {
      const parsed: unknown = JSON.parse(images)
      if (Array.isArray(parsed) && parsed.every(value => typeof value === 'string')) {
        images = JSON.stringify(await Promise.all(parsed.map(value => normalize(value))))
      }
    } catch {
      // Do not upload opaque legacy strings that may contain a local path.
      images = undefined
    }
  }

  let imageAnalyses = message.imageAnalyses
  if (imageAnalyses) {
    const analyses = parsePersistedImageAnalyses(imageAnalyses)
    if (analyses.length > 0) {
      imageAnalyses = JSON.stringify(await Promise.all(analyses.map(async analysis => ({
        ...analysis,
        sourceUrl: typeof analysis.sourceUrl === 'string'
          ? await normalize(analysis.sourceUrl)
          : analysis.sourceUrl,
      }))))
    } else {
      imageAnalyses = undefined
    }
  }

  return { ...message, image, images, imageAnalyses }
}

export function getMessageImageReferences(message: ConversationSyncMessage) {
  const references = new Set<string>()
  if (message.image) references.add(message.image)
  if (message.images) {
    try {
      const parsed: unknown = JSON.parse(message.images)
      if (Array.isArray(parsed)) {
        for (const value of parsed) if (typeof value === 'string') references.add(value)
      }
    } catch {
      // Invalid legacy JSON is handled by the message renderer.
    }
  }
  for (const analysis of parsePersistedImageAnalyses(message.imageAnalyses)) {
    if (typeof analysis.sourceUrl === 'string') references.add(analysis.sourceUrl)
  }
  return Array.from(references).filter(reference => (
    resolveConversationAssetPath(reference) !== null
  ))
}

async function downloadConversationAssets(items: ConversationSyncItem[]) {
  const startedAt = Date.now()
  const references = Array.from(new Set(
    items.flatMap(item => item.messages.flatMap(getMessageImageReferences))
  ))
  let downloaded = 0
  for (const localPath of references) {
    if (await exists(localPath, { baseDir: BaseDirectory.AppData })) continue
    const fileName = localPath.split('/').pop()
    if (!fileName) throw new Error(`Invalid conversation asset path: ${localPath}`)
    const remotePath = `${CONVERSATION_SYNC_ASSETS_DIRECTORY}/${fileName}`
    if (!await remoteFileExists(remotePath, 'data')) {
      throw new Error(`Missing remote conversation asset: ${remotePath}`)
    }
    const bytes = await downloadRemoteBytes(remotePath, 'data')
    await ensureLocalConversationAsset(localPath, bytes)
    downloaded += 1
  }
  recordSyncTiming('conversationAssetsDownload', startedAt, {
    total: references.length,
    downloaded,
  })
}

async function persistNormalizedMessageAssets(messages: ConversationSyncMessage[]) {
  const db = await import('@/db').then(module => module.getDb())
  for (const message of messages) {
    await db.execute(
      `update chats set image = $1, images = $2, imageAnalyses = $3 where syncId = $4`,
      [message.image, message.images, message.imageAnalyses, message.syncId]
    )
  }
}

function mergeTombstones(
  local: ConversationSyncTombstone[],
  remote: ConversationSyncTombstone[],
) {
  const merged = new Map<string, ConversationSyncTombstone>()
  for (const tombstone of [...local, ...remote]) {
    const key = `${tombstone.entityType}:${tombstone.syncId}`
    const existing = merged.get(key)
    if (!existing || tombstone.deletedAt > existing.deletedAt) {
      merged.set(key, tombstone)
    }
  }
  return Array.from(merged.values())
}

function mergeMessages(
  local: ConversationSyncMessage[],
  remote: ConversationSyncMessage[],
  tombstones: ConversationSyncTombstone[],
) {
  const deletedIds = new Set(
    tombstones.filter(tombstone => tombstone.entityType === 'message').map(tombstone => tombstone.syncId)
  )
  const merged = new Map<string, ConversationSyncMessage>()
  for (const message of [...local, ...remote]) {
    if (deletedIds.has(message.syncId)) continue
    const existing = merged.get(message.syncId)
    if (!existing
      || message.syncUpdatedAt > existing.syncUpdatedAt
      || (message.syncUpdatedAt === existing.syncUpdatedAt
        && stableSerialize(message) > stableSerialize(existing))) {
      merged.set(message.syncId, message)
    }
  }
  return Array.from(merged.values()).sort((left, right) => (
    left.createdAt - right.createdAt || left.syncId.localeCompare(right.syncId)
  ))
}

function mergeConversationItems(
  local: ConversationSyncItem[],
  remote: ConversationSyncItem[],
  tombstones: ConversationSyncTombstone[],
  baselineVersions: Record<string, number>,
) {
  const deletedConversationIds = new Set(
    tombstones
      .filter(tombstone => tombstone.entityType === 'conversation')
      .map(tombstone => tombstone.syncId)
  )
  const localById = new Map(local.map(item => [item.syncId, item]))
  const remoteById = new Map(remote.map(item => [item.syncId, item]))
  const syncIds = new Set([...localById.keys(), ...remoteById.keys()])
  const merged: ConversationSyncItem[] = []

  for (const syncId of syncIds) {
    if (deletedConversationIds.has(syncId)) continue
    const localItem = localById.get(syncId)
    const remoteItem = remoteById.get(syncId)
    if (!localItem || !remoteItem) {
      merged.push(localItem || remoteItem as ConversationSyncItem)
      continue
    }

    const itemTombstones = mergeTombstones(
      localItem.messageTombstones,
      remoteItem.messageTombstones,
    )
    const metadata = remoteItem.syncUpdatedAt > localItem.syncUpdatedAt
      || (remoteItem.syncUpdatedAt === localItem.syncUpdatedAt
        && stableSerialize(remoteItem) > stableSerialize(localItem))
      ? remoteItem
      : localItem
    const baseline = baselineVersions[syncId] || 0
    const bothChanged = baseline > 0
      && localItem.syncUpdatedAt > baseline
      && remoteItem.syncUpdatedAt > baseline
      && localItem.syncUpdatedAt !== remoteItem.syncUpdatedAt
    const compaction = bothChanged
      ? null
      : (localItem.compaction?.createdAt || 0) >= (remoteItem.compaction?.createdAt || 0)
        ? localItem.compaction
        : remoteItem.compaction
    const mergedItem: ConversationSyncItem = {
      ...metadata,
      messages: mergeMessages(localItem.messages, remoteItem.messages, itemTombstones),
      messageTombstones: itemTombstones,
      compaction,
    }
    // A union can contain content from both sides while inheriting the newer
    // side's metadata timestamp. Give that newly produced state its own
    // version so other devices do not skip the item based on the old index.
    if (
      stableSerialize(mergedItem) !== stableSerialize(localItem)
      && stableSerialize(mergedItem) !== stableSerialize(remoteItem)
    ) {
      mergedItem.syncUpdatedAt = Math.max(
        localItem.syncUpdatedAt,
        remoteItem.syncUpdatedAt,
        ...mergedItem.messages.map(message => message.syncUpdatedAt),
        ...itemTombstones.map(tombstone => tombstone.deletedAt),
      ) + 1
    }
    merged.push(mergedItem)
  }
  return merged
}

async function persistMergedConversationItems(
  items: ConversationSyncItem[],
  tombstones: ConversationSyncTombstone[],
) {
  const db = await import('@/db').then(module => module.getDb())
  // tauri-plugin-sql acquires a pooled connection for each invoke. A manual
  // BEGIN here is not guaranteed to be followed by subsequent statements on
  // the same connection and can leave the database locked indefinitely.
  // These writes are intentionally idempotent so an interrupted merge can be
  // retried safely without wrapping multiple invokes in a pseudo transaction.
  for (const tombstone of tombstones) {
    await db.execute(
      `insert into conversation_sync_tombstones (
         entityType, syncId, conversationSyncId, deletedAt
       ) values ($1, $2, $3, $4)
       on conflict(entityType, syncId) do update set
         conversationSyncId = excluded.conversationSyncId,
         deletedAt = max(conversation_sync_tombstones.deletedAt, excluded.deletedAt)`,
      [tombstone.entityType, tombstone.syncId, tombstone.conversationSyncId, tombstone.deletedAt]
    )
  }

  const deletedConversationIds = tombstones
    .filter(tombstone => tombstone.entityType === 'conversation')
    .map(tombstone => tombstone.syncId)
  const { getOptionalConversationCleanupTables } = await import('@/db/conversations')
  const optionalMemoryTables = deletedConversationIds.length
    ? (await getOptionalConversationCleanupTables()).filter(table => table.name !== 'conversation_compactions')
    : []
  for (const syncId of deletedConversationIds) {
    const rows = await db.select<Array<{ id: number }>>(
      'select id from conversations where syncId = $1',
      [syncId]
    )
    for (const row of rows) {
      await db.execute('delete from conversation_compactions where conversationId = $1', [row.id])
      for (const table of optionalMemoryTables) {
        await db.execute(`delete from ${table.name} where ${table.column} = $1`, [row.id])
      }
      await db.execute('delete from chats where conversationId = $1', [row.id])
      await db.execute('delete from conversations where id = $1', [row.id])
    }
  }

  for (const item of items) {
    await db.execute(
        `insert into conversations (
           syncId, syncUpdatedAt, title, createdAt, updatedAt, messageCount, isPinned
         ) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict(syncId) do update set
           syncUpdatedAt = excluded.syncUpdatedAt,
           title = excluded.title,
           createdAt = excluded.createdAt,
           updatedAt = excluded.updatedAt,
           messageCount = excluded.messageCount,
           isPinned = excluded.isPinned`,
        [
          item.syncId,
          item.syncUpdatedAt,
          item.title,
          item.createdAt,
          item.updatedAt,
          item.messages.length,
          item.isPinned ? 1 : 0,
        ]
    )
    const conversationRows = await db.select<Array<{ id: number }>>(
        'select id from conversations where syncId = $1',
        [item.syncId]
    )
    const conversationId = conversationRows[0]?.id
    if (!conversationId) throw new Error(`Failed to persist conversation: ${item.syncId}`)

    for (const message of item.messages) {
      await db.execute(
          `insert into chats (
             syncId, syncUpdatedAt, tagId, conversationId, content, role, type,
             image, images, imageAnalyses, attachments, inserted, createdAt,
             ragSources, ragSourceDetails, agentHistory, thinking, quoteData,
             condensedContent, condensedAt
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
           )
           on conflict(syncId) do update set
             syncUpdatedAt = excluded.syncUpdatedAt,
             tagId = excluded.tagId,
             conversationId = excluded.conversationId,
             content = excluded.content,
             role = excluded.role,
             type = excluded.type,
             image = excluded.image,
             images = excluded.images,
             imageAnalyses = excluded.imageAnalyses,
             attachments = excluded.attachments,
             inserted = excluded.inserted,
             createdAt = excluded.createdAt,
             ragSources = excluded.ragSources,
             ragSourceDetails = excluded.ragSourceDetails,
             agentHistory = excluded.agentHistory,
             thinking = excluded.thinking,
             quoteData = excluded.quoteData,
             condensedContent = excluded.condensedContent,
             condensedAt = excluded.condensedAt`,
          [
            message.syncId,
            message.syncUpdatedAt,
            message.tagId ?? 0,
            conversationId,
            message.content,
            message.role,
            message.type,
            message.image,
            message.images,
            message.imageAnalyses,
            message.attachments,
            message.inserted ? 1 : 0,
            message.createdAt,
            message.ragSources,
            message.ragSourceDetails,
            message.agentHistory,
            message.thinking,
            message.quoteData,
            message.condensedContent,
            message.condensedAt,
          ]
      )
    }

    for (const tombstone of item.messageTombstones) {
      await db.execute(
          `insert into conversation_sync_tombstones (
             entityType, syncId, conversationSyncId, deletedAt
           ) values ($1, $2, $3, $4)
           on conflict(entityType, syncId) do update set
             conversationSyncId = excluded.conversationSyncId,
             deletedAt = max(conversation_sync_tombstones.deletedAt, excluded.deletedAt)`,
          [tombstone.entityType, tombstone.syncId, tombstone.conversationSyncId, tombstone.deletedAt]
      )
      await db.execute('delete from chats where syncId = $1', [tombstone.syncId])
    }

    await db.execute('delete from conversation_compactions where conversationId = $1', [conversationId])
    if (item.compaction) {
      const covered = await db.select<Array<{ id: number }>>(
          'select id from chats where syncId = $1 and conversationId = $2',
          [item.compaction.coveredThroughMessageSyncId, conversationId]
      )
      const tail = item.compaction.tailStartMessageSyncId
        ? await db.select<Array<{ id: number }>>(
          'select id from chats where syncId = $1 and conversationId = $2',
          [item.compaction.tailStartMessageSyncId, conversationId]
        )
        : []
      if (covered[0]) {
        await db.execute(
            `insert into conversation_compactions (
               conversationId, summary, coveredThroughChatId, tailStartChatId,
               sourceTokenCount, summaryTokenCount, model, promptVersion,
               retainedTurnCount, prunedToolResultCount, prunedToolTokenCount,
               revision, createdAt
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              conversationId,
              item.compaction.summary,
              covered[0].id,
              tail[0]?.id,
              item.compaction.sourceTokenCount,
              item.compaction.summaryTokenCount,
              item.compaction.model,
              item.compaction.promptVersion,
              item.compaction.retainedTurnCount,
              item.compaction.prunedToolResultCount,
              item.compaction.prunedToolTokenCount,
              item.compaction.revision,
              item.compaction.createdAt,
            ]
        )
      }
    }
  }
}

async function refreshConversationStoreAfterSync() {
  const { default: useChatStore } = await import('@/stores/chat')
  const state = useChatStore.getState()
  const current = state.currentConversationId
    ? await import('@/db/conversations').then(module => module.getConversation(state.currentConversationId as number))
    : null
  await state.initConversations()
  if (current) {
    await state.switchConversation(current.id)
    return
  }
  const next = useChatStore.getState().conversations[0]
  if (state.currentConversationId && next) {
    await state.switchConversation(next.id)
  } else if (state.currentConversationId) {
    useChatStore.setState({ currentConversationId: null, chats: [] })
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function conversationIndexFingerprint(index: ConversationSyncIndex) {
  return stableSerialize({
    conversations: index.conversations
      .map(entry => [entry.syncId, entry.syncUpdatedAt, entry.messageCount])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    deleted: index.deleted
      .map(tombstone => [tombstone.entityType, tombstone.syncId, tombstone.deletedAt])
      .sort((left, right) => String(left[1]).localeCompare(String(right[1]))),
  })
}

export async function getLocalConversationSyncFingerprint() {
  const db = await import('@/db').then(module => module.getDb())
  const [conversations, tombstones] = await Promise.all([
    db.select<Array<{
      syncId: string
      syncUpdatedAt: number
      title: string
      createdAt: number
      updatedAt: number
      messageCount: number
      isPinned: number | boolean
    }>>(
      `select
         conversations.syncId,
         conversations.syncUpdatedAt,
         conversations.title,
         conversations.createdAt,
         conversations.updatedAt,
         (select count(*) from chats where chats.conversationId = conversations.id) as messageCount,
         conversations.isPinned
       from conversations`,
      []
    ),
    import('@/db/conversation-sync-state').then(module => module.getConversationSyncTombstones()),
  ])
  return conversationIndexFingerprint({
    format: CONVERSATION_SYNC_INDEX_FORMAT,
    version: CONVERSATION_SYNC_VERSION,
    updatedAt: 0,
    conversations: conversations.map(conversation => ({
      syncId: conversation.syncId,
      syncUpdatedAt: conversation.syncUpdatedAt,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messageCount,
      isPinned: Boolean(conversation.isPinned),
      path: getConversationItemPath(conversation.syncId),
    })),
    deleted: tombstones.filter(tombstone => tombstone.entityType === 'conversation'),
  })
}

export function getRemoteConversationSyncFingerprint(content: string | null) {
  const index = parseConversationSyncIndex(content)
  return index ? conversationIndexFingerprint(index) : null
}

export async function hasRemoteConversationSyncData() {
  const store = await Store.load('store.json')
  const storage = await createConversationRemoteStorage(store)
  if (!storage) return false
  return Boolean(
    await storage.read(CONVERSATION_SYNC_INDEX_PATH)
    || await storage.read(LEGACY_CHATS_SYNC_PATH)
  )
}

export function legacyChatsToItems(content: string): ConversationSyncItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Invalid legacy conversation data')
  }
  if (!Array.isArray(parsed)) throw new Error('Invalid legacy conversation data')
  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const value of parsed) {
    if (!isRecord(value)
      || typeof value.createdAt !== 'number'
      || !chatRoles.has(value.role as Role)
      || !chatTypes.has(value.type as ChatType)) continue
    const key = typeof value.conversationId === 'number'
      ? String(value.conversationId)
      : `tag-${typeof value.tagId === 'number' ? value.tagId : 0}`
    groups.set(key, [...(groups.get(key) || []), value])
  }

  return Array.from(groups.entries()).map(([legacyId, values]) => {
    const sorted = [...values].sort((left, right) => (
      Number(left.createdAt) - Number(right.createdAt)
    ))
    const syncId = uuidv5(`legacy-conversation:${legacyId}`, LEGACY_REMOTE_CONVERSATION_NAMESPACE)
    const messages = sorted.flatMap((value, index) => {
      const normalized = normalizeSyncMessage({
        ...value,
        syncId: typeof value.syncId === 'string'
          ? value.syncId
          : uuidv5(
            stableSerialize(['legacy-message', legacyId, index, value.createdAt, value.role, value.type, value.content]),
            LEGACY_REMOTE_CONVERSATION_NAMESPACE,
          ),
        syncUpdatedAt: typeof value.syncUpdatedAt === 'number'
          ? value.syncUpdatedAt
          : value.createdAt,
        inserted: Boolean(value.inserted),
      })
      return normalized ? [normalized] : []
    })
    const createdAt = messages[0]?.createdAt || Date.now()
    const updatedAt = messages.at(-1)?.createdAt || createdAt
    return {
      format: CONVERSATION_SYNC_ITEM_FORMAT,
      version: CONVERSATION_SYNC_VERSION,
      syncId,
      syncUpdatedAt: updatedAt,
      title: groups.size === 1 ? '历史对话' : `历史对话 ${legacyId}`,
      createdAt,
      updatedAt,
      isPinned: false,
      messages,
      messageTombstones: [],
      compaction: null,
    }
  })
}

function getLegacyConversationContentSignature(item: ConversationSyncItem) {
  return stableSerialize(item.messages.map(message => [
    message.createdAt,
    message.role,
    message.type,
    message.content || '',
  ]))
}

function deduplicateLegacyItems(
  localItems: ConversationSyncItem[],
  legacyItems: ConversationSyncItem[],
) {
  const localBySignature = new Map<string, ConversationSyncItem[]>()
  for (const item of localItems) {
    const signature = getLegacyConversationContentSignature(item)
    localBySignature.set(signature, [...(localBySignature.get(signature) || []), item])
  }
  const usedLocalIds = new Set<string>()
  return legacyItems.map(item => {
    const local = localBySignature.get(getLegacyConversationContentSignature(item))
      ?.find(candidate => !usedLocalIds.has(candidate.syncId))
    if (!local || local.messages.length !== item.messages.length) return item
    usedLocalIds.add(local.syncId)
    return {
      ...item,
      syncId: local.syncId,
      syncUpdatedAt: Math.max(item.syncUpdatedAt, local.syncUpdatedAt),
      title: local.title,
      createdAt: local.createdAt,
      updatedAt: Math.max(item.updatedAt, local.updatedAt),
      isPinned: local.isPinned,
      messages: item.messages.map((message, index) => ({
        ...message,
        syncId: local.messages[index].syncId,
        syncUpdatedAt: Math.max(message.syncUpdatedAt, local.messages[index].syncUpdatedAt),
      })),
    }
  })
}

async function readRemoteConversationItems(
  storage: ConversationRemoteStorage,
  index: ConversationSyncIndex,
  localItems: ConversationSyncItem[],
  baselineVersions: Record<string, number>,
) {
  const items: ConversationSyncItem[] = []
  const localById = new Map(localItems.map(item => [item.syncId, item]))
  for (const entry of index.conversations) {
    const localItem = localById.get(entry.syncId)
    if (localItem
      && localItem.syncUpdatedAt === entry.syncUpdatedAt
      && localItem.messages.length === entry.messageCount
      && baselineVersions[entry.syncId] === entry.syncUpdatedAt) {
      items.push(localItem)
      continue
    }
    const item = parseConversationSyncItem(await storage.read(entry.path))
    if (!item
      || item.syncId !== entry.syncId
      || item.syncUpdatedAt !== entry.syncUpdatedAt) {
      throw new Error(`Invalid remote conversation file: ${entry.path}`)
    }
    items.push(item)
  }
  return items
}

export async function uploadConversations() {
  const startedAt = Date.now()
  const store = await Store.load('store.json')
  const storage = await createConversationRemoteStorage(store)
  if (!storage) return false
  const [items, tombstones] = await Promise.all([
    getLocalConversationSyncItems(),
    import('@/db/conversation-sync-state').then(module => module.getConversationSyncTombstones()),
  ])
  const remoteIndexContent = await storage.read(CONVERSATION_SYNC_INDEX_PATH)
  const remoteIndex = parseConversationSyncIndex(remoteIndexContent)
  if (remoteIndexContent && !remoteIndex) return false
  const remoteEntries = new Map(remoteIndex?.conversations.map(entry => [entry.syncId, entry]) || [])
  const versions = await getConversationSyncVersions(store)
  const conversationTombstones = mergeTombstones(
    tombstones.filter(tombstone => tombstone.entityType === 'conversation'),
    remoteIndex?.deleted || [],
  )
  const deletedIds = new Set(conversationTombstones.map(tombstone => tombstone.syncId))
  const activeItems = items.filter(item => !deletedIds.has(item.syncId))
  const publishedItems: ConversationSyncItem[] = []
  let appliedRemoteDuringUpload = false

  for (const item of activeItems) {
    const itemStartedAt = Date.now()
    const remoteEntry = remoteEntries.get(item.syncId)
    let expectedRemoteItemContent: string | null = null
    let parsedRemoteItem: ConversationSyncItem | null = null
    if (remoteEntry?.syncUpdatedAt === item.syncUpdatedAt
      && versions[item.syncId] === item.syncUpdatedAt) {
      expectedRemoteItemContent = await storage.read(remoteEntry.path)
      if (!expectedRemoteItemContent) return false
      parsedRemoteItem = parseConversationSyncItem(expectedRemoteItemContent)
      if (!parsedRemoteItem || parsedRemoteItem.syncId !== item.syncId) return false
      if (stableSerialize(parsedRemoteItem) === stableSerialize(item)) {
        publishedItems.push(item)
        recordSyncTiming('conversationItemUpload', itemStartedAt, {
          messages: item.messages.length,
          mode: 'unchanged',
        })
        continue
      }
    }
    let itemToPublish = item
    if (remoteEntry && expectedRemoteItemContent === null) {
      expectedRemoteItemContent = await storage.read(remoteEntry.path)
      if (!expectedRemoteItemContent) return false
    }
    if (remoteEntry && (
      versions[item.syncId] !== remoteEntry.syncUpdatedAt
      || parsedRemoteItem !== null
    )) {
      const remoteItem = parsedRemoteItem || parseConversationSyncItem(expectedRemoteItemContent)
      if (!remoteItem || remoteItem.syncId !== item.syncId) return false
      await downloadConversationAssets([remoteItem])
      const mergedTombstones = mergeTombstones(
        tombstones,
        remoteItem.messageTombstones,
      )
      itemToPublish = mergeConversationItems(
        [item],
        [remoteItem],
        mergedTombstones,
        versions,
      )[0]
      await import('@/db/conversation-sync-state').then(module => (
        module.observeConversationSyncTimestamp(Math.max(
          itemToPublish.syncUpdatedAt,
          ...itemToPublish.messages.map(message => message.syncUpdatedAt),
          ...mergedTombstones.map(tombstone => tombstone.deletedAt),
        ))
      ))
      await persistMergedConversationItems([itemToPublish], mergedTombstones)
      appliedRemoteDuringUpload = true
    }
    const normalizedMessages = await Promise.all(
      itemToPublish.messages.map(message => normalizeMessageAssets(message))
    )
    const normalizedItem = { ...itemToPublish, messages: normalizedMessages }
    await persistNormalizedMessageAssets(normalizedMessages)
    if (!await storage.write(
      getConversationItemPath(item.syncId),
      JSON.stringify(normalizedItem),
      expectedRemoteItemContent,
    )) {
      return false
    }
    publishedItems.push(normalizedItem)
    recordSyncTiming('conversationItemUpload', itemStartedAt, {
      messages: normalizedItem.messages.length,
      mode: 'uploaded',
    })
  }

  const index: ConversationSyncIndex = {
    format: CONVERSATION_SYNC_INDEX_FORMAT,
    version: CONVERSATION_SYNC_VERSION,
    updatedAt: Date.now(),
    conversations: Array.from(new Map([
      ...(remoteIndex?.conversations || [])
        .filter(entry => !deletedIds.has(entry.syncId))
        .map(entry => [entry.syncId, entry] as const),
      ...publishedItems.map(item => [item.syncId, {
      syncId: item.syncId,
      syncUpdatedAt: item.syncUpdatedAt,
      title: item.title,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      messageCount: item.messages.length,
      isPinned: item.isPinned,
      path: getConversationItemPath(item.syncId),
      }] as const),
    ]).values()),
    deleted: conversationTombstones,
  }
  // The index is the commit point. Refuse to publish over an index that changed
  // since it was read, then remove tombstoned items only after readers can see
  // the tombstones and no longer depend on those files.
  const serializedIndex = JSON.stringify(index)
  if (!await storage.write(
    CONVERSATION_SYNC_INDEX_PATH,
    serializedIndex,
    remoteIndexContent,
  )) {
    return false
  }
  if (await storage.read(CONVERSATION_SYNC_INDEX_PATH) !== serializedIndex) return false
  for (const syncId of deletedIds) {
    if (!await storage.remove(getConversationItemPath(syncId))) {
      console.warn(`Failed to clean up tombstoned conversation item: ${syncId}`)
    }
  }
  await setConversationSyncVersions(store, Object.fromEntries(
    publishedItems.map(item => [item.syncId, item.syncUpdatedAt])
  ))
  await store.save()
  if (appliedRemoteDuringUpload) await refreshConversationStoreAfterSync()
  recordSyncTiming('conversationsUpload', startedAt, {
    total: activeItems.length,
    published: publishedItems.length,
    deleted: deletedIds.size,
  })
  return true
}

export async function downloadConversations() {
  const startedAt = Date.now()
  const store = await Store.load('store.json')
  const storage = await createConversationRemoteStorage(store)
  if (!storage) return false
  try {
    const [localItems, localTombstones] = await Promise.all([
      getLocalConversationSyncItems(),
      import('@/db/conversation-sync-state').then(module => module.getConversationSyncTombstones()),
    ])
    const indexContent = await storage.read(CONVERSATION_SYNC_INDEX_PATH)
    const index = parseConversationSyncIndex(indexContent)
    const versions = await getConversationSyncVersions(store)
    let remoteItems: ConversationSyncItem[]
    let remoteTombstones: ConversationSyncTombstone[]
    let migratedLegacy = false
    if (index) {
      remoteItems = await readRemoteConversationItems(storage, index, localItems, versions)
      remoteTombstones = index.deleted
    } else {
      if (indexContent) throw new Error('Invalid remote conversation index')
      const legacyContent = await storage.read(LEGACY_CHATS_SYNC_PATH)
      if (!legacyContent) return true
      remoteItems = deduplicateLegacyItems(localItems, legacyChatsToItems(legacyContent))
      remoteTombstones = []
      migratedLegacy = true
    }

    await downloadConversationAssets(remoteItems)
    const tombstones = mergeTombstones(localTombstones, remoteTombstones)
    const remoteVersions = new Map(remoteItems.map(item => [item.syncId, item.syncUpdatedAt]))
    const remoteTombstoneKeys = new Set([
      ...remoteTombstones,
      ...remoteItems.flatMap(item => item.messageTombstones),
    ].map(tombstone => (
      `${tombstone.entityType}:${tombstone.syncId}:${tombstone.deletedAt}`
    )))
    const localNeedsUpload = localItems.some(item => (
      versions[item.syncId] !== item.syncUpdatedAt
      && remoteVersions.get(item.syncId) !== item.syncUpdatedAt
    )) || localTombstones.some(tombstone => !remoteTombstoneKeys.has(
      `${tombstone.entityType}:${tombstone.syncId}:${tombstone.deletedAt}`
    ))
    const merged = mergeConversationItems(localItems, remoteItems, tombstones, versions)
    const hasRemoteConversationData = remoteItems.length > 0 || remoteTombstones.length > 0
    if (hasRemoteConversationData) {
      const observedTimestamp = Math.max(
        0,
        ...merged.map(item => item.syncUpdatedAt),
        ...merged.flatMap(item => item.messages.map(message => message.syncUpdatedAt)),
        ...tombstones.map(tombstone => tombstone.deletedAt),
      )
      await import('@/db/conversation-sync-state').then(module => (
        module.observeConversationSyncTimestamp(observedTimestamp)
      ))
      await persistMergedConversationItems(merged, tombstones)
    }
    await setConversationSyncVersions(store, Object.fromEntries(
      remoteItems.map(item => [item.syncId, item.syncUpdatedAt])
    ))
    await store.save()
    if (hasRemoteConversationData) await refreshConversationStoreAfterSync()
    if ((migratedLegacy || localNeedsUpload) && !await uploadConversations()) {
      throw new Error('Failed to upload merged conversation data')
    }
    recordSyncTiming('conversationsDownload', startedAt, {
      remote: remoteItems.length,
      merged: merged.length,
      tombstones: tombstones.length,
    })
    return true
  } catch (error) {
    throw error
  }
}
