export type ImageHostingType = 'github' | 'smms' | 'picgo' | 's3'

export function getNormalizedImageHosting(mainImageHosting?: string | null): {
  value: ImageHostingType
  shouldPersist: boolean
} {
  if (
    mainImageHosting === 'github' ||
    mainImageHosting === 'smms' ||
    mainImageHosting === 'picgo' ||
    mainImageHosting === 's3'
  ) {
    return {
      value: mainImageHosting,
      shouldPersist: false,
    }
  }

  return {
    value: 'github',
    shouldPersist: true,
  }
}
