import type { Editor } from '@tiptap/core'
import { ChangeSet, type TokenEncoder } from '@tiptap/pm/changeset'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { StepMap, Transform } from '@tiptap/pm/transform'
import { agentDebugLog } from '@/lib/agent/debug-log'

// Include marks and attributes so formula-only and formatting-only edits count.
export const agentDiffTokenEncoder: TokenEncoder<string> = {
  encodeCharacter: (character, marks) => marks.length > 0
    ? JSON.stringify([character, marks.map(mark => mark.toJSON())])
    : String(character),
  encodeNodeStart: node => JSON.stringify([node.type.name, node.attrs, node.marks.map(mark => mark.toJSON())]),
  encodeNodeEnd: node => `end:${node.type.name}`,
  compareTokens: (left, right) => left === right,
}

function documentChanges(before: ProseMirrorNode, after: ProseMirrorNode) {
  const replacement = new Transform(before).replaceWith(0, before.content.size, after.content)
  return ChangeSet.create(before, undefined, agentDiffTokenEncoder).addSteps(
    after,
    replacement.mapping.maps,
    'agent'
  ).changes
}

interface ChangedRange {
  fromA: number
  toA: number
}

function collectMathNodes(doc: ProseMirrorNode) {
  const nodes: { node: ProseMirrorNode; position: number }[] = []
  doc.descendants((node, position) => {
    if (node.type.name === 'inlineMath' || node.type.name === 'blockMath') {
      nodes.push({ node, position })
    }
  })
  return nodes
}

function mapMathAttributeChange(
  originalDoc: ProseMirrorNode,
  modifiedDoc: ProseMirrorNode,
  currentDoc: ProseMirrorNode,
  change: ChangedRange & { fromB: number; toB: number }
) {
  const original = originalDoc.nodeAt(change.fromA)
  const modified = modifiedDoc.nodeAt(change.fromB)
  agentDebugLog('editor_math_mapping_candidate', {
    original: original?.toJSON(),
    modified: modified?.toJSON(),
    originalSize: original?.nodeSize,
    modifiedSize: modified?.nodeSize,
    change,
  })
  if (!original || !modified
    || !['inlineMath', 'blockMath'].includes(original.type.name)
    || original.type !== modified.type
    || change.toA !== change.fromA + original.nodeSize
    || change.toB !== change.fromB + modified.nodeSize) return undefined

  const sourceMath = collectMathNodes(originalDoc)
  const currentMath = collectMathNodes(currentDoc)
  agentDebugLog('editor_math_mapping_sequence', {
    original: sourceMath.map(entry => ({ position: entry.position, type: entry.node.type.name, attrs: entry.node.attrs })),
    current: currentMath.map(entry => ({ position: entry.position, type: entry.node.type.name, attrs: entry.node.attrs })),
  })
  const sourceMatches = sourceMath.filter(entry => entry.node.eq(original))
  const currentMatches = currentMath.filter(entry => entry.node.eq(original))
  if (sourceMatches.length === 1 && currentMatches.length === 1) {
    return { position: currentMatches[0].position, node: modified }
  }
  // Formula nodes are atomic. Locate them by their unchanged ordered sequence
  // instead of mapping through a surrounding range of empty paragraph changes.
  if (sourceMath.length !== currentMath.length
    || sourceMath.some((entry, index) => !entry.node.eq(currentMath[index].node))) return undefined

  const index = sourceMath.findIndex(entry => entry.position === change.fromA)
  return index < 0 ? undefined : { position: currentMath[index].position, node: modified }
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
  if (originalDoc.eq(currentDoc)) return modifiedDoc

  const requestedChanges = documentChanges(originalDoc, modifiedDoc)
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
      const mathEdit = mapMathAttributeChange(originalDoc, modifiedDoc, currentDoc, change)
      if (mathEdit) {
        transaction.setNodeMarkup(mathEdit.position, undefined, mathEdit.node.attrs, mathEdit.node.marks)
        agentDebugLog('editor_markdown_math_rebased', { position: mathEdit.position, type: mathEdit.node.type.name })
        continue
      }
      agentDebugLog('editor_markdown_edit_overlap', {
        change,
        serializationChanges: serializationChanges.filter(serialization => rangesOverlap(change, serialization)),
      })
      // A local edit must never silently accept unrelated parse changes. The
      // user can use an exact selection when the source range is ambiguous.
      throw new Error('该修改范围与 Markdown 转换差异重叠，请选中目标内容后重试；未修改笔记。')
    }
    const from = sourceToCurrent.map(change.fromA, 1)
    const to = change.fromA === change.toA ? from : sourceToCurrent.map(change.toA, -1)
    transaction.replace(from, to, modifiedDoc.slice(change.fromB, change.toB))
  }

  transaction.doc.check()
  return transaction.doc
}
