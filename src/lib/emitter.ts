import mitt from 'mitt'

// 定义事件类型
interface Events {
  'searchAndScroll': string;
  'ai-completion-loading': boolean;
  'auto-completion-enabled-changed': boolean;
  'editor-input': unknown;
  'vditor:ready': unknown;
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
  [key: string]: unknown; // 添加索引签名以支持动态事件名
  [key: symbol]: unknown; // 添加 symbol 索引签名以满足 Record 约束
}

const emitter = mitt<Events>()

export default emitter;
