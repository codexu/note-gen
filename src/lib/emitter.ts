import mitt from 'mitt'
import type { OnboardingStepId } from '@/app/core/main/editor/onboarding-state'
import type { CanvasDocument } from '@/types/canvas'

// 定义事件类型
interface Events {
  'searchAndScroll': string;
  'ai-completion-loading': boolean;
  'auto-completion-enabled-changed': boolean;
  'editor-input': unknown;
  'editor:ready': unknown;
  'editor-mode-changed': string;
  'external-content-update': string;
  'editor-content-from-remote': { content: string };
  'editor-file-content-updated': { path: string; content: string };
  'editor-file-path-changed': { oldPath: string; newPath: string; content?: string };
  'editor-file-close': { path: string };
  'editor-navigation-path-moved': {
    oldPath: string
    newPath: string
    markHandled?: () => void
  };
  'editor-navigation-path-deleted': {
    path: string
    isFolder: boolean
    workspaceRoot?: string
    deletedTabIds?: string[]
    resolveFallbackTabId?: (tabId: string) => void
    markHandled?: () => void
  };
  'article-saved': {
    path: string
    content: string
    pluginChangeType?: 'created' | 'changed'
    pluginNoteChangeAlreadyEmitted?: boolean
  };
  'toolbar-text-number': number;
  'toolbar-reset-selected-text': unknown;
  'quickRecordText': unknown;
  'quickRecordTextHandler': { prefillText?: string } | undefined;
  'onboarding-record-prefill-changed': { prefillText?: string } | undefined;
  'onboarding-step-complete': { step: OnboardingStepId; filePath?: string };
  'openWindow': unknown;
  'immediate-pull-needed': { type: string; path: string; hash: string; filePath: string } | { type: string; filePath: string } | { filePath: string; isRemoteFile: boolean };
  'getSettingModelList': unknown;
  'insert-quote': {
    quote: string;
    fullContent: string;
    fileName: string;
    startLine: number;
    endLine: number;
    from: number;
    to: number;
    articlePath: string;
  };
  'toolbar-shortcut-image': unknown;
  'toolbar-shortcut-file': unknown;
  'toolbar-shortcut-todo': unknown;
  'editor-ai-streaming': { isStreaming: boolean; targetFilePath?: string; terminate?: () => void };
  'toolbar-shortcut-recording': unknown;
  'toolbar-shortcut-scan': unknown;
  'toolbar-shortcut-text': unknown;
  'toolbar-shortcut-link': unknown;
  'latest-commit-info': {
    sha: string;
    message: string;
    author: string;
    date: Date;
    additions?: number;
    deletions?: number;
  };
  'sync-success': unknown;
  'sync-content-updated': { path: string; content: string; workspaceRoot?: string };
  'sync-push-started': { path: string };
  'sync-push-completed': { path: string; success: boolean; sha?: string };
  'sync-sha-mismatch': {
    path: string
    workspacePath: string
    localSha?: string
    remoteSha?: string
    force?: boolean
  };
  'revertChat': unknown;
  'fileSelected': {
    name: string;
    path: string;
    relativePath: string;
  };
  'folderSelected': {
    name: string;
    path: string;
    relativePath: string;
    fileCount: number;
    indexedCount: number;
  };
  'toolbar-mark': unknown;
  'toolbar-continue': unknown;
  'toolbar-question': unknown;
  'toolbar-translation': unknown;
  'toolbar-organize': unknown;
  'screenshot-shortcut-register': unknown;
  'text-shortcut-register': unknown;
  'window-pin-register': unknown;
  'window-pin-changed': boolean;
  'link-shortcut-register': unknown;
  'refresh-marks': unknown;
  'open-new-record-tag': void;
  'record-assets-downloaded': { paths: string[] };
  'quick-prompt-insert': string;
  'quick-prompt-send': string;
  'conversation-compaction-status': {
    conversationId: number;
    status: 'running' | 'completed' | 'failed';
    messageCount: number;
    revision?: number;
    coveredThroughChatId?: number;
    sourceTokenCount?: number;
    summaryTokenCount?: number;
    summary?: string;
  };
  'memory-auto-created': {
    conversationId: number;
    created: Array<{
      id: string;
      content: string;
      status: 'active' | 'pending';
    }>;
  };
  'start-ai-streaming': {
    originalText: string;
    type: string;
    position: { top: number; left: number; right: number; bottom: number };
    controller?: AbortController;
  };
  'update-ai-streaming-content': {
    suggestedText: string;
    position: { top: number; left: number; right: number; bottom: number };
  };
  'update-ai-thinking-content': {
    thinkingText: string;
    position: { top: number; left: number; right: number; bottom: number };
  };
  'ai-streaming-complete': {
    originalText: string;
    suggestedText: string;
    type: string;
    position: { top: number; left: number; right: number; bottom: number };
    generatedRange?: { from: number; to: number };
  } | undefined;
  'show-ai-suggestion': {
    originalText: string;
    suggestedText: string;
    type: string;
    position: { top: number; left: number; right: number; bottom: number };
    generatedRange?: { from: number; to: number };
  };
  'abort-ai-streaming': void;
  'accept-ai-suggestion': void;
  'reject-ai-suggestion': void;
  // Agent 编辑器工具事件 - 内联定义避免重复
  'editor-get-selection': { resolve: (data: { text: string; from: number; to: number; html?: string; startLine?: number; endLine?: number }) => void };
  'editor-get-content': { resolve: (data: { markdown: string; text: string; wordCount: number; charCount: number; totalLines?: number; numberedLines?: string; version: number; selection?: { text: string; from: number; to: number; startLine: number; endLine: number } }) => void };
  'editor-insert': { filePath: string; content: string; position?: number; replaceSelection?: boolean; expectedVersion?: number; expectedSelection?: string; expectedSelectionToken?: string; resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number; versionMismatch?: boolean }) => void };
  'editor-undo': void;
  'editor-redo': void;
  'editor-agent-diff-preview': {
    originalContent: string;
    modifiedContent: string;
    filePath?: string;
    from?: number;
    to?: number;
  };
  'editor-agent-diff-clear': void;
  'mobile-editor-toggle-outline': void;
  'editor-search-trigger': void;
  'editor-can-undo-redo': { resolve: (can: { undo: boolean; redo: boolean }) => void };
  'editor-prepare-deactivate': { resolve: (canDeactivate: boolean) => void };
  'editor-undo-redo-changed': { undo: boolean; redo: boolean };
  'canvas-document-replace': { canvasId: string; document: CanvasDocument };
  'canvas-history-checkpoint': void;
  'canvas-undo': { canvasId: string };
  'canvas-redo': { canvasId: string };
  'canvas-can-undo-redo': { canvasId: string; resolve: (can: { undo: boolean; redo: boolean }) => void };
  'canvas-undo-redo-changed': { canvasId: string; undo: boolean; redo: boolean };
  'canvas-agent-preview': { operations: unknown[] };
  'canvas-agent-preview-clear': void;
  'canvas-auto-layout': { recordHistory?: boolean };
  'editor-replace': {
    filePath: string;
    content?: string;
    range?: { from: number; to: number };
    searchContent?: string;
    occurrence?: number;
    startLine?: number;
    endLine?: number;
    expectedVersion?: number;
    resolve: (result: { success: boolean; insertedLength: number; message?: string; error?: string; newCursorPosition?: number; versionMismatch?: boolean }) => void;
  };
  [key: string]: unknown;
  [key: symbol]: unknown;
}

const emitter = mitt<Events>()

export type { Events }
export default emitter;
