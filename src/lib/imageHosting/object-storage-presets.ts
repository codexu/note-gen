import type {
  ObjectStorageAddressingStyle,
  ObjectStoragePreset,
  S3Config,
} from './types'

export const OBJECT_STORAGE_PRESETS: ObjectStoragePreset[] = [
  'aws',
  'cloudflare-r2',
  'aliyun-oss',
  'tencent-cos',
  'backblaze-b2',
  'minio',
  'custom',
]

export function getObjectStorageEndpoint(config: S3Config) {
  switch (config.preset) {
    case 'aws':
      return `https://s3.${config.region.trim() || 'us-east-1'}.amazonaws.com`
    case 'aliyun-oss':
      return `https://oss-${config.region.trim()}.aliyuncs.com`
    case 'tencent-cos':
      return `https://cos.${config.region.trim()}.myqcloud.com`
    case 'backblaze-b2':
      return `https://s3.${config.region.trim()}.backblazeb2.com`
    case 'cloudflare-r2':
    case 'minio':
    case 'custom':
      return config.endpoint?.trim().replace(/\/+$/, '') || ''
    case undefined:
      return config.endpoint?.trim().replace(/\/+$/, '')
        || `https://s3.${config.region.trim() || 'us-east-1'}.amazonaws.com`
  }
}

export function isObjectStorageConfigComplete(config: S3Config) {
  return Boolean(
    config.accessKeyId.trim()
    && config.secretAccessKey.trim()
    && config.region.trim()
    && config.bucket.trim()
    && getObjectStorageEndpoint(config),
  )
}

export function getObjectStorageAddressingStyle(
  config: S3Config,
): Exclude<ObjectStorageAddressingStyle, 'auto'> {
  if (!config.preset) {
    if (config.addressingStyle && config.addressingStyle !== 'auto') {
      return config.addressingStyle
    }
    const endpoint = config.endpoint || ''
    return endpoint.includes('amazonaws.com')
      || endpoint.includes('aliyuncs.com')
      || endpoint.includes('myqcloud.com')
      ? 'virtual'
      : 'path'
  }

  switch (config.preset) {
    case 'aws':
    case 'aliyun-oss':
    case 'tencent-cos':
      return 'virtual'
    case 'custom':
      return config.addressingStyle && config.addressingStyle !== 'auto'
        ? config.addressingStyle
        : 'path'
    default:
      return 'path'
  }
}

export function normalizeObjectStorageConfig(config: S3Config): S3Config {
  if (config.preset) {
    return {
      ...config,
      addressingStyle: config.addressingStyle || 'auto',
    }
  }

  const endpoint = config.endpoint || ''
  let preset: ObjectStoragePreset = 'custom'
  if (!endpoint || endpoint.includes('amazonaws.com')) preset = 'aws'
  else if (endpoint.includes('r2.cloudflarestorage.com')) preset = 'cloudflare-r2'
  else if (endpoint.includes('aliyuncs.com')) preset = 'aliyun-oss'
  else if (endpoint.includes('myqcloud.com')) preset = 'tencent-cos'
  else if (endpoint.includes('backblazeb2.com')) preset = 'backblaze-b2'

  return {
    ...config,
    preset,
    addressingStyle: config.addressingStyle || 'auto',
  }
}

export function buildObjectStorageUrl(
  config: S3Config,
  key?: string,
) {
  const endpoint = getObjectStorageEndpoint(config)
  if (!endpoint) throw new Error('Object storage endpoint is required')

  const bucket = config.bucket.trim()
  if (!bucket) throw new Error('Object storage bucket is required')

  const url = new URL(endpoint)
  const basePath = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join('/')
  const encodedKey = key
    ?.split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')

  if (getObjectStorageAddressingStyle(config) === 'virtual') {
    url.hostname = `${bucket}.${url.hostname}`
    url.pathname = `/${[basePath, encodedKey].filter(Boolean).join('/')}`
  } else {
    url.pathname = `/${[
      basePath,
      encodeURIComponent(bucket),
      encodedKey,
    ].filter(Boolean).join('/')}`
  }

  return url.toString().replace(/\/+$/, '')
}

export function applyObjectStoragePreset(
  preset: ObjectStoragePreset,
  current: S3Config,
): S3Config {
  const base: S3Config = {
    ...current,
    preset,
    addressingStyle: 'auto',
  }

  switch (preset) {
    case 'aws':
      return {
        ...base,
        region: 'us-east-1',
        endpoint: '',
      }
    case 'cloudflare-r2':
      return {
        ...base,
        region: 'auto',
        endpoint: '',
      }
    case 'aliyun-oss':
      return {
        ...base,
        region: 'cn-hangzhou',
        endpoint: '',
      }
    case 'tencent-cos':
      return {
        ...base,
        region: 'ap-guangzhou',
        endpoint: '',
      }
    case 'backblaze-b2':
      return {
        ...base,
        region: 'us-west-004',
        endpoint: '',
      }
    case 'minio':
      return {
        ...base,
        region: 'us-east-1',
        endpoint: '',
      }
    case 'custom':
      return {
        ...base,
        region: 'us-east-1',
        endpoint: '',
      }
  }
}
