import type { Mark } from "@/db/marks"

export type ImageRecordStatus = 'pending' | 'failed' | 'noText' | 'savedOnly'

export interface ImageRecordStatusLabels {
  pending: string
  failed: string
  noText: string
  savedOnly: string
}

function compact(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

export function isImageRecord(mark: Pick<Mark, 'type'>) {
  return mark.type === 'image' || mark.type === 'scan'
}

export function getImageRecordStatus(
  mark: Pick<Mark, 'type' | 'content' | 'desc'>,
  labels: ImageRecordStatusLabels,
): ImageRecordStatus | null {
  if (!isImageRecord(mark)) {
    return null
  }

  const content = compact(mark.content)
  const desc = compact(mark.desc)

  if (desc === labels.pending) {
    return 'pending'
  }

  if (desc === labels.failed) {
    return 'failed'
  }

  if (desc === labels.noText) {
    return 'noText'
  }

  if (!content && !desc) {
    return 'savedOnly'
  }

  return null
}

export function getImageRecordDisplayText(
  mark: Pick<Mark, 'type' | 'content' | 'desc'>,
  labels: ImageRecordStatusLabels,
) {
  const status = getImageRecordStatus(mark, labels)

  if (!status) {
    return ''
  }

  return labels[status]
}
