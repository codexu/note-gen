export interface SyProperties {
  id?: string
  title?: string
  type?: string
  updated?: string
  icon?: string
  tag?: string
  style?: string
  fold?: string
  colgroup?: string
  [key: string]: string | undefined
}

export interface SyListData {
  Typ?: number
  Tight?: boolean
  BulletChar?: number
  Delimiter?: number
  Start?: number
  Num?: number
  Padding?: number
  Checked?: boolean
  Marker?: string
}

export interface SyNode {
  ID?: string
  Spec?: string
  Type: string
  Data?: string
  Properties?: SyProperties
  Children?: SyNode[]
  HeadingLevel?: number
  ListData?: SyListData
  TextMarkType?: string
  TextMarkTextContent?: string
  TextMarkAHref?: string
  TextMarkATitle?: string
  TextMarkBlockRefID?: string
  TextMarkBlockRefSubtype?: string
  TextMarkInlineMathContent?: string
  TextMarkInlineMemoContent?: string
  TextMarkFileAnnotationRefID?: string
  TaskListItemChecked?: boolean
  IsFencedCodeBlock?: boolean
  CodeBlockInfo?: string
  CodeBlockFenceChar?: number
  CodeBlockFenceLen?: number
  CalloutType?: string
  CalloutTitle?: string
  CalloutIcon?: string
  AttributeViewID?: string
  AttributeViewType?: string
  TableAligns?: number[]
}

export interface SyDocument extends SyNode {
  Type: 'NodeDocument'
  ID: string
  Properties: SyProperties
}

export interface SyNotebookConf {
  name?: string
  icon?: string
  sort?: number
  closed?: boolean
}

export interface BlockRefTarget {
  mdPath: string
  anchor?: string
  preview?: string
}

export interface SyAvKey {
  id: string
  name: string
  type: string
}

export interface SyAvValue {
  id?: string
  keyID?: string
  blockID?: string
  type?: string
  block?: {
    id?: string
    content?: string
  }
  text?: { content?: string }
  number?: { content?: number; formattedContent?: string; isNotEmpty?: boolean }
  date?: { content?: number; content2?: number; isNotTime?: boolean; hasEndDate?: boolean; formattedContent?: string }
  mSelect?: Array<{ content?: string }>
  url?: { content?: string }
  email?: { content?: string }
  phone?: { content?: string }
  mAsset?: Array<{ name?: string; content?: string }>
  template?: { content?: string }
  created?: { formattedContent?: string }
  updated?: { formattedContent?: string }
  checkbox?: { checked?: boolean }
  relation?: {
    blockIDs?: string[] | null
    contents?: Array<{ block?: { content?: string }; text?: { content?: string } }> | null
  }
  rollup?: {
    contents?: Array<{ block?: { content?: string }; text?: { content?: string }; number?: { formattedContent?: string; content?: number } }> | null
  }
}

export interface SyAvKeyValue {
  key: SyAvKey
  values?: SyAvValue[]
}

export interface SyAvViewColumn {
  id: string
  hidden?: boolean
}

export interface SyAvView {
  id: string
  name?: string
  type?: string
  itemIds?: string[]
  table?: {
    columns?: SyAvViewColumn[]
    rowIds?: string[]
  }
}

export interface SyAttributeView {
  spec?: number
  id: string
  name?: string
  keyValues?: SyAvKeyValue[]
  keyIDs?: string[] | null
  viewID?: string
  views?: SyAvView[]
}

export interface SyConvertContext {
  blockIndex: Map<string, BlockRefTarget>
  attributeViews: Map<string, SyAttributeView>
  currentMdPath: string
  assetOutputDir: string
}

export interface SyDocumentPlan {
  syPath: string
  mdAbsolutePath: string
  mdRelativePath: string
  title: string
  documentId: string
  assetOutputDir: string
}

export type SyImportIssueCode =
  | 'widget'
  | 'custom_block'
  | 'embed_block'
  | 'missing_attribute_view'
  | 'non_table_attribute_view'
  | 'super_block'
  | 'unresolved_block_ref'
  | 'siyuan_protocol_link'
  | 'missing_asset'
  | 'inline_memo'
  | 'file_annotation_ref'
  | 'media_html_block'
  | 'html_block'
  | 'unsafe_asset_path'
  | 'git_conflict'
  | 'av_truncated'
  | 'unknown_node_type'
  | 'unsupported_spec'

export interface SyImportIssue {
  level: 'degraded' | 'unsupported'
  code: SyImportIssueCode
  count: number
  omittedRows?: number
  omittedColumns?: number
  markdownBytesTruncated?: boolean
}

export type SyImportDocumentStatus = 'success' | 'failed' | 'degraded' | 'unsupported'

export interface SyImportDocumentReport {
  title: string
  syPath: string
  mdRelativePath?: string
  status: SyImportDocumentStatus
  errorMessage?: string
  issues: SyImportIssue[]
}

export type SyImportPhase = 'planning' | 'extracting' | 'loading_av' | 'indexing' | 'importing' | 'done'

export interface SyImportProgress {
  phase: SyImportPhase
  current: number
  total: number
  currentTitle?: string
}

export interface SyImportResult {
  totalDocuments: number
  discoveredDocumentCount: number
  omittedDocumentCount: number
  successCount: number
  failedCount: number
  degradedCount: number
  unsupportedCount: number
  degradedIssueCount: number
  unsupportedIssueCount: number
  documentCount: number
  assetCount: number
  notebookCount: number
  documents: SyImportDocumentReport[]
  documentsTruncated?: boolean
  degradedIssuesSummary: Array<{
    code: SyImportIssueCode
    count: number
    omittedRows?: number
    omittedColumns?: number
  }>
}

export interface SyImportOptions {
  dataRoot: string
  targetDir: string
  assetsDirName?: string
  onProgress?: (progress: SyImportProgress) => void
  signal?: AbortSignal
}
