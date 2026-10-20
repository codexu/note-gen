export type ImageHostingType =
  | 'github'
  | 'smms'
  | 'picgo'
  | 's3'
  | 'lsky'
  | 'webdav'
  | 'custom-http'
  | 'cloudinary'
  | 'imagekit'
  | 'qiniu'
  | 'upyun'

export const IMAGE_HOSTING_TYPES: ImageHostingType[] = [
  'github',
  'smms',
  'picgo',
  's3',
  'qiniu',
  'upyun',
  'lsky',
  'webdav',
  'custom-http',
  'cloudinary',
  'imagekit',
]

export function getNormalizedImageHosting(mainImageHosting?: string | null): {
  value: ImageHostingType
  shouldPersist: boolean
} {
  if (IMAGE_HOSTING_TYPES.includes(mainImageHosting as ImageHostingType)) {
    return {
      value: mainImageHosting as ImageHostingType,
      shouldPersist: false,
    }
  }

  return {
    value: 'github',
    shouldPersist: true,
  }
}
