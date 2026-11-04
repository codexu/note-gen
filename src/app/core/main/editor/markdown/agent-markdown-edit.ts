import { EditorEditSkipped } from '@/lib/agent/editor-adapter'
import { buildTextEdits } from '@/lib/agent/text-diff'
import { normalizeMarkdownPlaceholders } from './markdown-paragraph'
import type { Editor } from '@tiptap/core'
import { ChangeSet, type TokenEncoder } from '@tiptap/pm/changeset'
import { closeHistory } from '@tiptap/pm/history'
import { Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { StepMap, Transform } from '@tiptap/pm/transform'
import { agentDebugLog } from '@/lib/agent/debug-log'
import { WIKI_METADATA_NODE_NAME, WIKI_METADATA_REPLACE_DOCUMENT } from './wiki-metadata-tokenizer'

// Include marks and attributes so formula-only and formatting-only edits count.
const agentDiffTokenEncoder: TokenEncoder<string> = {
  encodeCharacter: (character, marks) => marks.length > 0
    ? JSON.stringify([character, marks.map(mark => mark.toJSON())])
    : String(character),
  encodeNodeStart: node => JSON.stringify([node.type.name, node.attrs, node.marks.map(mark => mark.toJSON())]),
  encodeNodeEnd: node => `end:${node.type.name}`,
  compareTokens: (left, right) => left === right,
}

export function documentChanges(before: ProseMirrorNode, after: ProseMirrorNode) {
  const maps: StepMap[] = []
  const collect = (oldNode: ProseMirrorNode, newNode: ProseMirrorNode, position: number): boolean => {
    if (oldNode.eq(newNode)) return true
    if (oldNode.type !== newNode.type) return false
    if (oldNode.isAtom) {
      maps.push(new StepMap([position, oldNode.nodeSize, newNode.nodeSize]))
      return true
    }
    if (!oldNode.sameMarkup(newNode)) return false
    if (oldNode.isTextblock) {
      // Keep adjacent text edits from merging across list items or table cells.
      maps.push(new StepMap([position + 1, oldNode.content.size, newNode.content.size]))
      return true
    }
    if (oldNode.childCount !== newNode.childCount) return false
    let childPosition = position + 1
    for (let index = 0; index < oldNode.childCount; index += 1) {
      const child = oldNode.child(index)
      if (!collect(child, newNode.child(index), childPosition)) return false
      childPosition += child.nodeSize
    }
    return true
  }

  // Apply from right to left so every map uses its original position.
  const mapping = collect(before, after, -1)
    ? maps.reverse()
    : [new StepMap([0, before.content.size, after.content.size])]
  return ChangeSet.create(before, undefined, agentDiffTokenEncoder).addSteps(
    after,
    mapping,
    'agent'
  ).changes
}

export interface DiffPreviewRange {
  fromA: number
  toA: number
  fromB: number
  toB: number
  inline: boolean
  depth: number
}

function expandToChildren(doc: ProseMirrorNode, from: number, to: number, depth: number) {
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  return {
    from: $from.depth > depth ? $from.before(depth + 1) : from,
    to: $to.depth > depth ? $to.after(depth + 1) : to,
  }
}

function hasMergedTableRows(node: ProseMirrorNode) {
  let merged = false
  node.descendants(child => {
    if (Number(child.attrs.rowspan ?? 1) > 1) merged = true
    return !merged
  })
  return merged
}

export function buildPreviewRange(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  change: Pick<DiffPreviewRange, 'fromA' | 'toA' | 'fromB' | 'toB'>
): DiffPreviewRange {
  const $fromA = before.resolve(change.fromA)
  const $toA = before.resolve(change.toA)
  const $fromB = after.resolve(change.fromB)
  const $toB = after.resolve(change.toB)
  const sharedDepth = Math.min($fromA.sharedDepth(change.toA), $fromB.sharedDepth(change.toB))
  let depth = 0

  // Only descend through matching containers. A change to a container's own
  // attributes or structure is reviewed at its parent, while a text change in
  // a deeply nested list item or table cell stays in that item or cell.
  for (let candidate = 1; candidate <= sharedDepth; candidate += 1) {
    const oldParent = $fromA.node(candidate)
    const newParent = $fromB.node(candidate)
    if (!oldParent.sameMarkup(newParent)) break
    // Structural table changes are reviewed one row at a time. Keeping rows as
    // the smallest structural unit preserves valid columns while row widgets
    // stay inside the table's tbody. Text edits still descend into a cell.
    // Repeating a row that spans another row would alter the untouched cells'
    // geometry. Such structural edits retain a separate full-table preview.
    const spansRows = oldParent.type.spec.tableRole === 'table'
      && (hasMergedTableRows(oldParent) || hasMergedTableRows(newParent))
    if (!oldParent.isTextblock && oldParent.type.spec.tableRole !== 'row' && !spansRows) {
      depth = candidate
    }
  }

  const inline = $fromA.sameParent($toA)
    && $fromB.sameParent($toB)
    && $fromA.parent.isTextblock
    && $fromB.parent.isTextblock
    && $fromA.depth === $fromB.depth
    && sharedDepth === $fromA.depth
    && $fromA.parent.sameMarkup($fromB.parent)
    && depth === $fromA.depth - 1

  if (inline) return { ...change, inline: true, depth: $fromA.depth }

  const oldRange = expandToChildren(before, change.fromA, change.toA, depth)
  const newRange = expandToChildren(after, change.fromB, change.toB, depth)
  return {
    fromA: oldRange.from,
    toA: oldRange.to,
    fromB: newRange.from,
    toB: newRange.to,
    inline: false,
    depth,
  }
}

interface ChangedRange {
  fromA: number
  toA: number
}

function assertAgentMetadataPreserved(before: ProseMirrorNode, after: ProseMirrorNode) {
  if (before.firstChild?.type.name !== WIKI_METADATA_NODE_NAME) return
  const retained = new Set<string>()
  after.forEach(node => {
    if (node.type.name === WIKI_METADATA_NODE_NAME && typeof node.attrs.raw === 'string') retained.add(node.attrs.raw)
  })
  before.forEach(node => {
    if (node.type.name === WIKI_METADATA_NODE_NAME && typeof node.attrs.raw === 'string' && !retained.has(node.attrs.raw)) {
      throw new EditorEditSkipped('该改动涉及受保护的 Wiki 元数据，未应用。请保留元数据后重新生成局部差异。')
    }
  })
}

/** Structural parsing must not pull unchanged blocks into a local replacement. */
export function assertAgentChangeLocal(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  range: DiffPreviewRange
) {
  if (before.childCount > 1 && range.fromA === 0 && range.toA === before.content.size) {
    throw new EditorEditSkipped('本次修改会替换整个文档，已拒绝执行；请拆分为局部修改。')
  }
  if (range.inline || range.fromA === range.toA || range.fromB === range.toB) return
  const oldNode = before.nodeAt(range.fromA)
  const newNode = after.nodeAt(range.fromB)
  // Attribute edits and structural edits within one existing block (including
  // table rows, list items and extension nodes) are legitimate local updates.
  if (oldNode && newNode && oldNode.type === newNode.type
    && range.toA === range.fromA + oldNode.nodeSize
    && range.toB === range.fromB + newNode.nodeSize) return
  let oldBlocks = 0
  before.nodesBetween(range.fromA, range.toA, node => {
    if (node.isTextblock || (node.isAtom && !node.isText)) {
      oldBlocks += 1
      return false
    }
  })
  // Converting a single paragraph to a heading/quote/list is still local.
  if (oldBlocks <= 1) return
  const retained = new Set<string>()
  after.nodesBetween(range.fromB, range.toB, (node, position) => {
    if (position >= range.fromB && position + node.nodeSize <= range.toB
      && ((node.isTextblock && node.content.size > 0) || (node.isAtom && !node.isText))) {
      retained.add(JSON.stringify(node.toJSON()))
      return false
    }
  })
  before.nodesBetween(range.fromA, range.toA, (node, position) => {
    if (position >= range.fromA && position + node.nodeSize <= range.toA
      && retained.has(JSON.stringify(node.toJSON()))) {
      throw new EditorEditSkipped('局部修改扩大到了未修改的内容，已拒绝整段替换，未写入笔记。请使用更小的行范围或精确选区重试，并保留原有缩进和结构。')
    }
  })
}

export function assertAgentDocumentChangeLocal(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  scope?: { from: number; to: number }
) {
  assertAgentMetadataPreserved(before, after)
  for (const change of documentChanges(before, after)) {
    if (change.fromA <= 1 && change.toA >= before.content.size - 1 && before.childCount > 1) {
      throw new EditorEditSkipped('本次修改会替换整个文档，已拒绝执行；请拆分为局部修改。')
    }
    const expanded = buildPreviewRange(before, after, change)
    if (expanded.fromA === 0 && expanded.toA === before.content.size && before.childCount > 1) {
      throw new EditorEditSkipped('本次修改会替换整个文档，已拒绝执行；请拆分为局部修改。')
    }
    if (scope) {
      const $from = before.resolve(scope.from)
      const $to = before.resolve(scope.to)
      // Node markup lives just outside its text selection. Permit those
      // boundary tokens for headings, marks, quotes and other local conversions.
      const from = $from.depth > 0 ? $from.before($from.depth) : scope.from
      const to = $to.depth > 0 ? $to.after($to.depth) : scope.to
      if (change.fromA < from || change.toA > to) {
        throw new EditorEditSkipped('编辑超出指定选区，已拒绝写入。')
      }
      // Exact selections already define the permitted structural change. Do
      // not reject a valid wrap/unwrap merely because its text stays unchanged.
      continue
    }
    assertAgentChangeLocal(before, after, expanded)
  }
}

export function assertAgentMarkdownChangeLocal(editor: Editor, before: string, after: string) {
  const original = editor.markdown?.parse(before)
  const modified = editor.markdown?.parse(after)
  if (!original || !modified) throw new Error('Markdown parser is unavailable')
  const originalDoc = editor.schema.nodeFromJSON(original)
  const modifiedDoc = editor.schema.nodeFromJSON(modified)
  assertAgentDocumentChangeLocal(originalDoc, modifiedDoc)
}

/** Build the exact range edit used by both review and confirmed writes. */
export function buildAgentRangeEdit(
  editor: Editor,
  content: string,
  range: { from: number; to: number },
  parseInlineMarkdown = false
): Transaction {
  const before = editor.state.doc
  const from = Math.min(Math.max(0, range.from), before.content.size)
  const to = Math.min(Math.max(from, range.to), before.content.size)
  const $from = before.resolve(from)
  const $to = before.resolve(to)
  const inlineRange = $from.sameParent($to) && $from.parent.isTextblock
  const transaction = closeHistory(editor.state.tr)

  if (!content) {
    transaction.deleteRange(from, to)
  } else if (!parseInlineMarkdown && !content.includes('\n') && inlineRange) {
    transaction.insertText(content, from, to)
  } else {
    const parsed = editor.markdown?.parse(content)
    if (!parsed) throw new Error('Markdown parser is unavailable')
    const modifiedDoc = editor.schema.nodeFromJSON(parsed)
    const paragraph = modifiedDoc.firstChild
    if (parseInlineMarkdown && inlineRange && modifiedDoc.childCount === 1
      && paragraph?.type.name === 'paragraph') {
      transaction.replaceWith(from, to, paragraph.content)
    } else {
      transaction.replaceRange(from, to, new Slice(modifiedDoc.content, 0, 0))
    }
  }

  assertAgentDocumentChangeLocal(before, transaction.doc, { from, to })
  return transaction
}

/** Transfer only the range edit from serialized Markdown back onto its raw source. */
export function mapAgentSerializedMarkdownChanges(
  originalMarkdown: string,
  serializedBefore: string,
  serializedAfter: string,
): string {
  const edits = buildTextEdits(serializedBefore, serializedAfter)
  const normalization = buildTextEdits(serializedBefore, originalMarkdown)
  const sourceMap = new StepMap(normalization.flatMap(edit => [edit.from, edit.to - edit.from, edit.text.length]))
  let candidate = originalMarkdown
  for (const edit of [...edits].reverse()) {
    const overlapsNormalization = normalization.some(normalized => {
      if (edit.from === edit.to) return normalized.from < edit.from && edit.from < normalized.to
      if (normalized.from === normalized.to) return edit.from < normalized.from && normalized.from < edit.to
      return edit.from < normalized.to && normalized.from < edit.to
    })
    if (overlapsNormalization) {
      throw new EditorEditSkipped('该选区与 Markdown 格式转换范围重叠，本次改动未应用。')
    }
    // At a zero-width insertion, stay before untouched raw whitespace such as
    // the final newline. Replacements exclude normalization at both boundaries.
    const from = sourceMap.map(edit.from, edit.from === edit.to ? -1 : 1)
    const to = edit.from === edit.to ? from : sourceMap.map(edit.to, -1)
    if (to < from || originalMarkdown.slice(from, to) !== serializedBefore.slice(edit.from, edit.to)) {
      throw new EditorEditSkipped('无法准确定位原文中的选区，本次改动未应用。')
    }
    candidate = candidate.slice(0, from) + edit.text + candidate.slice(to)
  }
  return candidate
}

/** Verify the preserved raw source produces the exact proposed live document. */
export function buildAgentRangeMarkdown(
  editor: Editor,
  originalMarkdown: string,
  modifiedDoc: ProseMirrorNode,
  currentDoc: ProseMirrorNode = editor.state.doc,
): string {
  if (currentDoc.eq(modifiedDoc)) return originalMarkdown
  const markdown = editor.markdown
  if (!markdown) throw new Error('Markdown parser is unavailable')
  const serializedBefore = normalizeMarkdownPlaceholders(markdown.serialize(currentDoc.toJSON()))
  const serializedAfter = normalizeMarkdownPlaceholders(markdown.serialize(modifiedDoc.toJSON()))
  const candidate = mapAgentSerializedMarkdownChanges(originalMarkdown, serializedBefore, serializedAfter)
  const verifiedDoc = buildAgentMarkdownEdit(editor, originalMarkdown, candidate, currentDoc)
  if (!verifiedDoc.eq(modifiedDoc)) {
    throw new EditorEditSkipped('原文映射与选区修改结果不一致，本次改动未应用。')
  }
  return candidate
}

/** Dispatch only local steps; never use setContent for an Agent edit. */
export function applyAgentDocumentEdit(editor: Editor, modifiedDoc: ProseMirrorNode) {
  const before = editor.state.doc
  assertAgentDocumentChangeLocal(before, modifiedDoc)
  const changes = documentChanges(before, modifiedDoc)
  const transaction = closeHistory(editor.state.tr)
  for (const change of [...changes].reverse()) {
    assertAgentChangeLocal(before, modifiedDoc, buildPreviewRange(before, modifiedDoc, change))
    transaction.replace(change.fromA, change.toA, modifiedDoc.slice(change.fromB, change.toB))
  }
  if (!transaction.doc.eq(modifiedDoc)) throw new EditorEditSkipped('局部编辑结果与预期不一致，未写入笔记。')
  if (transaction.docChanged) editor.view.dispatch(transaction)
  if (!editor.state.doc.eq(modifiedDoc)) throw new Error('编辑器未接受局部编辑，未完成写入。请等待当前预览结束后重试。')
  if (transaction.docChanged) editor.view.dispatch(closeHistory(editor.state.tr))
}

/** Trusted history restoration only; callers must verify the recorded result first. */
export function applyAgentSnapshotRestore(editor: Editor, content: string): void {
  const parsed = editor.markdown?.parse(content)
  if (!parsed) throw new Error('Markdown parser is unavailable')
  const target = editor.schema.nodeFromJSON(parsed)
  const before = editor.state.doc
  const transaction = closeHistory(editor.state.tr).setMeta(WIKI_METADATA_REPLACE_DOCUMENT, true)
  for (const change of [...documentChanges(before, target)].reverse()) {
    transaction.replace(change.fromA, change.toA, target.slice(change.fromB, change.toB))
  }
  if (!transaction.doc.eq(target)) throw new Error('撤销结果与记录不一致，未写入笔记。')
  if (transaction.docChanged) editor.view.dispatch(transaction)
  if (!editor.state.doc.eq(target)) throw new Error('编辑器未接受撤销，未写入笔记。')
  if (transaction.docChanged) editor.view.dispatch(closeHistory(editor.state.tr))
}

function collectAtomicNodes(doc: ProseMirrorNode) {
  const nodes: { node: ProseMirrorNode; position: number }[] = []
  doc.descendants((node, position) => {
    if (node.isAtom && !node.isText) {
      nodes.push({ node, position })
    }
  })
  return nodes
}

function mapAtomicAttributeChange(
  originalDoc: ProseMirrorNode,
  modifiedDoc: ProseMirrorNode,
  currentDoc: ProseMirrorNode,
  change: ChangedRange & { fromB: number; toB: number }
) {
  const original = originalDoc.nodeAt(change.fromA)
  const modified = modifiedDoc.nodeAt(change.fromB)
  agentDebugLog('editor_atom_mapping_candidate', {
    original: original?.toJSON(),
    modified: modified?.toJSON(),
    originalSize: original?.nodeSize,
    modifiedSize: modified?.nodeSize,
    change,
  })
  if (!original || !modified
    || (!original.isAtom || original.isText)
    || original.type !== modified.type
    || change.toA !== change.fromA + original.nodeSize
    || change.toB !== change.fromB + modified.nodeSize) return undefined

  const sourceAtoms = collectAtomicNodes(originalDoc)
  const currentAtoms = collectAtomicNodes(currentDoc)
  agentDebugLog('editor_atom_mapping_sequence', {
    original: sourceAtoms.map(entry => ({ position: entry.position, type: entry.node.type.name, attrs: entry.node.attrs })),
    current: currentAtoms.map(entry => ({ position: entry.position, type: entry.node.type.name, attrs: entry.node.attrs })),
  })
  const sourceMatches = sourceAtoms.filter(entry => entry.node.eq(original))
  const currentMatches = currentAtoms.filter(entry => entry.node.eq(original))
  if (sourceMatches.length === 1 && currentMatches.length === 1) {
    return { position: currentMatches[0].position, node: modified }
  }
  // Extension nodes are atomic. Locate them by their unchanged ordered sequence
  // instead of mapping through a surrounding range of empty paragraph changes.
  if (sourceAtoms.length !== currentAtoms.length
    || sourceAtoms.some((entry, index) => !entry.node.eq(currentAtoms[index].node))) return undefined

  const index = sourceAtoms.findIndex(entry => entry.position === change.fromA)
  return index < 0 ? undefined : { position: currentAtoms[index].position, node: modified }
}

function rangesOverlap(left: ChangedRange, right: ChangedRange) {
  if (left.fromA === left.toA) {
    return right.fromA < left.fromA && left.fromA < right.toA
  }
  if (right.fromA === right.toA) {
    return left.fromA < right.fromA && right.fromA < left.toA
  }
  return left.fromA < right.toA && right.fromA < left.toA
}

function insertOrderedListSibling(
  editor: Editor,
  originalMarkdown: string,
  modifiedMarkdown: string,
  currentDoc: ProseMirrorNode
): ProseMirrorNode | undefined {
  const before = originalMarkdown.split('\n')
  const after = modifiedMarkdown.split('\n')
  if (after.length !== before.length + 1) return undefined

  let index = 0
  while (index < before.length && before[index] === after[index]) index += 1
  if (index === 0 || before.slice(index).some((line, offset) => line !== after[index + 1 + offset])) return undefined

  const previous = /^(\s*)(\d+)\.\s+(.+)$/.exec(before[index - 1])
  const inserted = /^(\s*)(\d+)\.\s+(.+)$/.exec(after[index])
  if (!previous || !inserted || Number(inserted[2]) !== Number(previous[2]) + 1) return undefined

  const anchors: number[] = []
  currentDoc.descendants((node, position) => {
    if (node.type.name !== 'paragraph' || !node.isTextblock) return
    const markdown = editor.markdown?.serialize({ type: 'doc', content: [node.toJSON()] }).trim()
    if (markdown === previous[3].trim()) anchors.push(position)
  })
  if (anchors.length !== 1) return undefined

  const $anchor = currentDoc.resolve(anchors[0] + 1)
  for (let depth = $anchor.depth - 1; depth > 0; depth -= 1) {
    const item = $anchor.node(depth)
    const list = $anchor.node(depth - 1)
    if (item.type.name !== 'listItem' || list.type.name !== 'orderedList') continue
    if ($anchor.index(depth) !== 0) return undefined
    const number = Number(list.attrs.start ?? 1) + $anchor.index(depth - 1)
    if (number !== Number(previous[2])) return undefined

    const parsed = editor.markdown?.parse(`1. ${inserted[3]}`)
    const parsedList = parsed?.content?.[0]
    const parsedItem = parsedList?.type === 'orderedList' ? parsedList.content?.[0] : undefined
    if (!parsedItem || parsedItem.type !== 'listItem' || parsedList?.content?.length !== 1) return undefined
    const itemNode = editor.schema.nodeFromJSON(parsedItem)
    const nextItem = list.maybeChild($anchor.index(depth - 1) + 1)
    if (nextItem?.eq(itemNode)) {
      throw new Error('相同的列表项已存在，未重复插入。')
    }
    const transaction = new Transform(currentDoc)
    transaction.insert($anchor.after(depth), itemNode)
    transaction.doc.check()
    agentDebugLog('editor_list_sibling_inserted', { anchor: previous[3], position: $anchor.after(depth) })
    return transaction.doc
  }
  return undefined
}

/** Apply only the requested Markdown changes to the live document. Parsing the
 * original snapshot provides a baseline: serialization differences between that
 * baseline and the live document must not become part of the Agent's edit.
 * Both approval previews and confirmed writes use this same path.
 */
export function buildAgentMarkdownEdit(
  editor: Editor,
  originalMarkdown: string,
  modifiedMarkdown: string,
  currentDoc: ProseMirrorNode = editor.state.doc
) {
  const listInsertion = insertOrderedListSibling(editor, originalMarkdown, modifiedMarkdown, currentDoc)
  if (listInsertion) return listInsertion
  const originalJson = editor.markdown?.parse(originalMarkdown)
  const modifiedJson = editor.markdown?.parse(modifiedMarkdown)
  if (!originalJson || !modifiedJson) throw new Error('Markdown parser is unavailable')

  const originalDoc = editor.schema.nodeFromJSON(originalJson)
  const modifiedDoc = editor.schema.nodeFromJSON(modifiedJson)
  assertAgentMetadataPreserved(currentDoc, modifiedDoc)
  const requestedChanges = documentChanges(originalDoc, modifiedDoc)
  for (const change of requestedChanges) {
    assertAgentChangeLocal(originalDoc, modifiedDoc, buildPreviewRange(originalDoc, modifiedDoc, change))
  }
  if (originalDoc.eq(currentDoc)) return modifiedDoc
  if (requestedChanges.length === 0) return currentDoc

  const serializationChanges = documentChanges(originalDoc, currentDoc)
  agentDebugLog('editor_markdown_edit_rebased', {
    requestedChangeCount: requestedChanges.length,
    serializationChangeCount: serializationChanges.length,
    originalDocSize: originalDoc.content.size,
    currentDocSize: currentDoc.content.size,
  })
  const sourceToCurrent = new StepMap(serializationChanges.flatMap(change => [
    change.fromA,
    change.toA - change.fromA,
    change.toB - change.fromB,
  ]))
  const transaction = new Transform(currentDoc)

  // Work from the end so each mapped position still refers to the live snapshot.
  for (const change of [...requestedChanges].reverse()) {
    if (serializationChanges.some(serialization => rangesOverlap(change, serialization))) {
      const atomicEdit = mapAtomicAttributeChange(originalDoc, modifiedDoc, currentDoc, change)
      if (atomicEdit) {
        transaction.setNodeMarkup(atomicEdit.position, undefined, atomicEdit.node.attrs, atomicEdit.node.marks)
        agentDebugLog('editor_markdown_atom_rebased', { position: atomicEdit.position, type: atomicEdit.node.type.name })
        continue
      }
      agentDebugLog('editor_markdown_edit_overlap', {
        change,
        serializationChanges: serializationChanges.filter(serialization => rangesOverlap(change, serialization)),
      })
      // A local edit must never silently accept unrelated parse changes. The
      // user can use an exact selection when the source range is ambiguous.
      throw new EditorEditSkipped('该修改范围与 Markdown 转换差异重叠，请选中目标内容后重试；未修改笔记。')
    }
    const from = sourceToCurrent.map(change.fromA, 1)
    const to = change.fromA === change.toA ? from : sourceToCurrent.map(change.toA, -1)
    transaction.replace(from, to, modifiedDoc.slice(change.fromB, change.toB))
  }

  transaction.doc.check()
  return transaction.doc
}
