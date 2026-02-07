import mitt from 'mitt'
import type { QuickPrompt } from '@/lib/ai/placeholder'

// 定义编辑器事件类型
interface EditorEvents {
  'editor-get-selection': { resolve: (data: { text: string; from: number; to: number; html?: string }) => void }
  'editor-get-content': { resolve: (data: { markdown: string; html?: string; text: string; wordCount: number; charCount: number }) => void }
  'editor-insert': { content: string; resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number }) => void }
  'editor-replace': { content: string; range?: { from: number; to: number }; resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number }) => void }
}

// 定义事件类型
interface Events {
  'searchAndScroll': string;
  'ai-completion-loading': boolean;
  'auto-completion-enabled-changed': boolean;
  'editor-input': unknown;
  'editor:ready': unknown;
  'editor-mode-changed': string;
  'external-content-update': string;
  'toolbar-text-number': number;
  'toolbar-reset-selected-text': unknown;
  'quickRecordText': unknown;
  'quickRecordTextHandler': unknown;
  'openWindow': unknown;
  'immediate-pull-needed': { type: string; path: string; hash: string; filePath: string } | { type: string; filePath: string } | { filePath: string; isRemoteFile: boolean };
  'getSettingModelList': unknown;
  'insert-quote': {
    quote: string;
    fullContent: string;
    fileName: string;
    startLine: number;
    endLine: number;
    articlePath: string;
  };
  'toolbar-shortcut-image': unknown;
  'toolbar-shortcut-file': unknown;
  'toolbar-shortcut-todo': unknown;
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
  'link-shortcut-register': unknown;
  'refresh-marks': unknown;
  'quick-prompt-insert': string;
  'quick-prompt-send': string;
  'ai-placeholder-generated': string;
  'ai-prompts-generated': QuickPrompt[];
  // Agent 编辑器工具事件
  'editor-get-selection': EditorEvents['editor-get-selection'];
  'editor-get-content': EditorEvents['editor-get-content'];
  'editor-insert': EditorEvents['editor-insert'];
  'editor-replace': EditorEvents['editor-replace'];
  [key: string]: unknown; // 添加索引签名以支持动态事件名
  [key: symbol]: unknown; // 添加 symbol 索引签名以满足 Record 约束
}

const emitter = mitt<Events>()

export default emitter;
