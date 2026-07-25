import type { SyDocument, SyNode } from './types.ts'
import { isDocumentId } from './utils.ts'
import { parseSiYuanSpecVersion } from './known-node-types.ts'

const MAX_SY_DOCUMENT_NODES = 500_000
const MAX_SY_DOCUMENT_DEPTH = 256
const OPTIONAL_STRING_FIELDS: Array<keyof SyNode> = [
  'Spec',
  'Data',
  'TextMarkType',
  'TextMarkTextContent',
  'TextMarkAHref',
  'TextMarkATitle',
  'TextMarkBlockRefID',
  'TextMarkBlockRefSubtype',
  'TextMarkInlineMathContent',
  'TextMarkInlineMemoContent',
  'TextMarkFileAnnotationRefID',
  'CodeBlockInfo',
  'CalloutType',
  'CalloutTitle',
  'CalloutIcon',
  'AttributeViewID',
  'AttributeViewType',
]

export function validateSiYuanDocument(
  value: unknown,
  source = 'SiYuan document',
): SyDocument {
  if (
    !value
    || typeof value !== 'object'
    || !('Type' in value)
    || value.Type !== 'NodeDocument'
    || !('ID' in value)
    || typeof value.ID !== 'string'
    || !isDocumentId(value.ID)
    || !('Properties' in value)
    || !value.Properties
    || typeof value.Properties !== 'object'
    || Array.isArray(value.Properties)
  ) {
    throw new Error(`Invalid SiYuan document: ${source}`)
  }

  const document = value as SyDocument
  const stack: Array<{ node: SyNode; depth: number }> = [{ node: document, depth: 0 }]
  let nodeCount = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      break
    }

    const { node, depth } = current
    nodeCount += 1
    if (nodeCount > MAX_SY_DOCUMENT_NODES || depth > MAX_SY_DOCUMENT_DEPTH) {
      throw new Error(`SiYuan document is too complex: ${source}`)
    }
    if (!node || typeof node !== 'object' || typeof node.Type !== 'string') {
      throw new Error(`Invalid SiYuan node: ${source}`)
    }
    if (node.Spec !== undefined && parseSiYuanSpecVersion(node.Spec) === null) {
      throw new Error(`Invalid SiYuan spec: ${source}`)
    }
    if (node.ID !== undefined && (typeof node.ID !== 'string' || !isDocumentId(node.ID))) {
      throw new Error(`Invalid SiYuan block ID: ${source}`)
    }
    if (
      OPTIONAL_STRING_FIELDS.some(field =>
        node[field] !== undefined && typeof node[field] !== 'string',
      )
    ) {
      throw new Error(`Invalid SiYuan node text: ${source}`)
    }
    if (
      node.Properties !== undefined
      && (
        !node.Properties
        || typeof node.Properties !== 'object'
        || Array.isArray(node.Properties)
        || Object.values(node.Properties).some(
          property => property !== undefined && typeof property !== 'string',
        )
      )
    ) {
      throw new Error(`Invalid SiYuan node properties: ${source}`)
    }
    if (node.Children !== undefined && !Array.isArray(node.Children)) {
      throw new Error(`Invalid SiYuan child nodes: ${source}`)
    }

    for (const child of node.Children ?? []) {
      stack.push({ node: child, depth: depth + 1 })
    }
  }

  return document
}

export function parseAndValidateSiYuanDocument(
  content: string,
  source?: string,
): SyDocument {
  return validateSiYuanDocument(JSON.parse(content) as unknown, source)
}
