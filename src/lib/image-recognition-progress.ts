import type { ImageRecognitionStage } from '@/lib/image-recognition'

type Translate = (key: string) => string

export function getImageRecognitionProgressText(
  t: Translate,
  stage: ImageRecognitionStage
) {
  switch (stage) {
  case 'vlm':
    return t('record.mark.progress.vlm')
  case 'ocr':
    return t('record.mark.progress.ocr')
  case 'description':
    return t('record.mark.progress.description')
  default:
    return t('record.mark.progress.ocr')
  }
}
