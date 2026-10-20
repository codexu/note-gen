import { create } from 'zustand'
import {
  pullAllRemoteLibraryFiles,
  uploadAllLocalLibraryFiles,
  type PullAllProgress,
  type PullAllResult,
  type RemoteLibraryOptions,
  type UploadAllResult,
} from '@/lib/sync/remote-library'
import {
  downloadKnowledgeBaseSnapshot,
  uploadKnowledgeBaseSnapshot,
  type RagSnapshotDownloadResult,
  type RagSnapshotManifest,
} from '@/lib/rag-sync'

export type CloudLibraryOperation = 'pull-files' | 'upload-files' | 'upload-rag' | 'download-rag' | null

type CloudLibraryState = {
  operation: CloudLibraryOperation
  progressCurrent: number
  progressTotal: number
  progressPath: string
  error: string
  lastPullResult: PullAllResult | null
  lastUploadResult: UploadAllResult | null
  lastUploadedSnapshot: RagSnapshotManifest | null
  lastDownloadedSnapshot: RagSnapshotDownloadResult | null
  pullAllFiles: (onProgress?: (progress: PullAllProgress) => void, options?: RemoteLibraryOptions) => Promise<PullAllResult>
  uploadAllFiles: (onProgress?: (progress: PullAllProgress) => void, options?: RemoteLibraryOptions) => Promise<UploadAllResult>
  uploadKnowledgeBase: () => Promise<RagSnapshotManifest>
  downloadKnowledgeBase: () => Promise<RagSnapshotDownloadResult>
  clearError: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const useCloudLibraryStore = create<CloudLibraryState>((set) => ({
  operation: null,
  progressCurrent: 0,
  progressTotal: 0,
  progressPath: '',
  error: '',
  lastPullResult: null,
  lastUploadResult: null,
  lastUploadedSnapshot: null,
  lastDownloadedSnapshot: null,

  pullAllFiles: async (onProgress, options) => {
    set({
      operation: 'pull-files',
      progressCurrent: 0,
      progressTotal: 0,
      progressPath: '',
      error: '',
    })
    try {
      const result = await pullAllRemoteLibraryFiles(options, progress => {
        set({
          progressCurrent: progress.current,
          progressTotal: progress.total,
          progressPath: progress.path || '',
        })
        onProgress?.(progress)
      })
      set({ lastPullResult: result })
      return result
    } catch (error) {
      set({ error: errorMessage(error) })
      throw error
    } finally {
      set({ operation: null })
    }
  },

  uploadAllFiles: async (onProgress, options) => {
    set({
      operation: 'upload-files',
      progressCurrent: 0,
      progressTotal: 0,
      progressPath: '',
      error: '',
    })
    try {
      const result = await uploadAllLocalLibraryFiles(options, progress => {
        set({
          progressCurrent: progress.current,
          progressTotal: progress.total,
          progressPath: progress.path || '',
        })
        onProgress?.(progress)
      })
      set({ lastUploadResult: result })
      return result
    } catch (error) {
      set({ error: errorMessage(error) })
      throw error
    } finally {
      set({ operation: null })
    }
  },

  uploadKnowledgeBase: async () => {
    set({
      operation: 'upload-rag',
      progressCurrent: 0,
      progressTotal: 0,
      progressPath: '',
      error: '',
    })
    try {
      const manifest = await uploadKnowledgeBaseSnapshot((current, total, path) => {
        set({ progressCurrent: current, progressTotal: total, progressPath: path })
      })
      set({ lastUploadedSnapshot: manifest })
      return manifest
    } catch (error) {
      set({ error: errorMessage(error) })
      throw error
    } finally {
      set({ operation: null })
    }
  },

  downloadKnowledgeBase: async () => {
    set({
      operation: 'download-rag',
      progressCurrent: 0,
      progressTotal: 0,
      progressPath: '',
      error: '',
    })
    try {
      const result = await downloadKnowledgeBaseSnapshot((current, total, path) => {
        set({ progressCurrent: current, progressTotal: total, progressPath: path })
      })
      set({ lastDownloadedSnapshot: result })
      return result
    } catch (error) {
      set({ error: errorMessage(error) })
      throw error
    } finally {
      set({ operation: null })
    }
  },

  clearError: () => set({ error: '' }),
}))

export default useCloudLibraryStore
