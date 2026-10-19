import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { Mapping, type Step } from '@tiptap/pm/transform'

export interface HeadingItem {
  level: number
  rawText: string
  text: string
  id: string
  pos: number
  nodeSize: number
}

interface ChangedRange {
  from: number
  to: number
}

type UntitledHeading = (level: number) => string

export class OutlineHeadingIndex {
  private doc: ProseMirrorNode | null = null
  private headings: HeadingItem[] = []
  private headingIds = new WeakMap<ProseMirrorNode, string>()
  private nextHeadingId = 0

  private readHeadings(
    doc: ProseMirrorNode,
    ranges: ChangedRange[],
    untitledHeading: UntitledHeading,
    mappedIds = new Map<number, string>(),
    usedIds = new Set<string>(),
  ) {
    const headings = new Map<number, HeadingItem>()

    for (const { from, to } of ranges) {
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'heading') return !node.isTextblock
        if (headings.has(pos)) return false

        const rawLevel = node.attrs.level
        const level = typeof rawLevel === 'number' ? rawLevel : Number(rawLevel) || 1
        const rawText = node.textContent.trim()
        let id = mappedIds.get(pos) ?? this.headingIds.get(node)

        if (!id || usedIds.has(id)) {
          id = `heading-${this.nextHeadingId}`
          this.nextHeadingId += 1
        }

        this.headingIds.set(node, id)
        usedIds.add(id)
        headings.set(pos, {
          level,
          rawText,
          text: rawText || untitledHeading(level),
          id,
          pos,
          nodeSize: node.nodeSize,
        })

        // Heading text is read once; inline descendants cannot contain headings.
        return false
      })
    }

    return [...headings.values()]
  }

  rebuild(doc: ProseMirrorNode, untitledHeading: UntitledHeading) {
    const mappedIds = this.doc === doc
      ? new Map(this.headings.map(heading => [heading.pos, heading.id]))
      : new Map<number, string>()
    this.doc = doc
    this.headings = this.readHeadings(doc, [{ from: 0, to: doc.content.size }], untitledHeading, mappedIds)
    return this.headings
  }

  update(doc: ProseMirrorNode, transactions: Transaction[], untitledHeading: UntitledHeading) {
    if (this.doc === doc) return this.headings

    // Rebuild if changes happened while the outline was not subscribed.
    if (transactions[0]?.before !== this.doc || transactions.at(-1)?.doc !== doc) {
      return this.rebuild(doc, untitledHeading)
    }

    const mapping = new Mapping()
    const steps: Step[] = []

    for (const transaction of transactions) {
      mapping.appendMapping(transaction.mapping)
      steps.push(...transaction.steps)
    }

    const ranges: ChangedRange[] = []
    let hasUnknownStep = false

    mapping.maps.forEach((stepMap, index) => {
      const remainingMapping = mapping.slice(index + 1)
      const addRange = (from: number, to: number) => {
        ranges.push({
          from: Math.max(0, remainingMapping.map(from, -1) - 1),
          to: Math.min(doc.content.size, remainingMapping.map(to, 1) + 1),
        })
      }
      let hasMappedRange = false

      stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
        hasMappedRange = true
        addRange(newFrom, newTo)
      })

      if (hasMappedRange) return

      // Marks and node attributes can change without changing positions.
      const step = steps[index] as Step & { from?: number; to?: number; pos?: number }
      if (typeof step.from === 'number' && typeof step.to === 'number') {
        addRange(step.from, step.to)
      } else if (typeof step.pos === 'number') {
        addRange(step.pos, step.pos + 1)
      } else if (step.toJSON().stepType !== 'docAttr') {
        hasUnknownStep = true
      }
    })

    if (hasUnknownStep) return this.rebuild(doc, untitledHeading)

    ranges.sort((a, b) => a.from - b.from)
    const mergedRanges: ChangedRange[] = []
    for (const range of ranges) {
      const previous = mergedRanges.at(-1)
      if (previous && range.from <= previous.to) {
        previous.to = Math.max(previous.to, range.to)
      } else {
        mergedRanges.push({ ...range })
      }
    }

    const mappedIds = new Map<number, string>()
    const unchangedHeadings: HeadingItem[] = []
    const usedIds = new Set<string>()

    for (const heading of this.headings) {
      const mapped = mapping.mapResult(heading.pos, 1)
      // setNodeMarkup replaces the opening token while preserving the content.
      // Keep the ID for level changes, but discard headings deleted in full.
      if (mapped.deleted && mapping.mapResult(heading.pos + 1, 1).deleted) continue

      const end = mapping.map(heading.pos + heading.nodeSize, -1)
      mappedIds.set(mapped.pos, heading.id)

      if (mergedRanges.some((range) => mapped.pos < range.to && end > range.from)) continue

      unchangedHeadings.push(mapped.pos === heading.pos && end - mapped.pos === heading.nodeSize
        ? heading
        : { ...heading, pos: mapped.pos, nodeSize: end - mapped.pos })
      usedIds.add(heading.id)
    }

    const changedHeadings = this.readHeadings(doc, mergedRanges, untitledHeading, mappedIds, usedIds)
    this.doc = doc
    this.headings = [...unchangedHeadings, ...changedHeadings].sort((a, b) => a.pos - b.pos)
    return this.headings
  }
}
