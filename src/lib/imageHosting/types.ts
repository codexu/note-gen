export type ObjectStoragePreset =
  | 'aws'
  | 'cloudflare-r2'
  | 'aliyun-oss'
  | 'tencent-cos'
  | 'backblaze-b2'
  | 'minio'
  | 'custom'

export type ObjectStorageAddressingStyle = 'auto' | 'path' | 'virtual'

export interface S3Config {
  preset?: ObjectStoragePreset
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
  endpoint?: string
  customDomain?: string
  pathPrefix?: string
  addressingStyle?: ObjectStorageAddressingStyle
}

export interface LskyConfig {
  apiUrl: string
  token: string
  strategyId?: string
}

export interface WebDavImageConfig {
  baseUrl: string
  username: string
  password: string
  publicUrl: string
  pathPrefix?: string
}

export interface CustomHttpImageConfig {
  url: string
  method: 'POST' | 'PUT'
  headers: string
  formFields: string
  fileField: string
  responseUrlPath: string
}

export interface CloudinaryConfig {
  cloudName: string
  uploadPreset: string
  folder?: string
}

export interface ImageKitConfig {
  privateKey: string
  folder?: string
}

export interface QiniuConfig {
  accessKey: string
  secretKey: string
  bucket: string
  publicUrl: string
  uploadUrl: string
  pathPrefix?: string
}

export interface UpyunConfig {
  bucket: string
  operator: string
  password: string
  publicUrl: string
  pathPrefix?: string
}

export const DEFAULT_LSKY_CONFIG: LskyConfig = {
  apiUrl: '',
  token: '',
  strategyId: '',
}

export const DEFAULT_WEBDAV_IMAGE_CONFIG: WebDavImageConfig = {
  baseUrl: '',
  username: '',
  password: '',
  publicUrl: '',
  pathPrefix: 'images',
}

export const DEFAULT_CUSTOM_HTTP_IMAGE_CONFIG: CustomHttpImageConfig = {
  url: '',
  method: 'POST',
  headers: '',
  formFields: '',
  fileField: 'file',
  responseUrlPath: 'url',
}

export const DEFAULT_CLOUDINARY_CONFIG: CloudinaryConfig = {
  cloudName: '',
  uploadPreset: '',
  folder: '',
}

export const DEFAULT_IMAGEKIT_CONFIG: ImageKitConfig = {
  privateKey: '',
  folder: '',
}

export const DEFAULT_QINIU_CONFIG: QiniuConfig = {
  accessKey: '',
  secretKey: '',
  bucket: '',
  publicUrl: '',
  uploadUrl: 'https://upload.qiniup.com',
  pathPrefix: 'images',
}

export const DEFAULT_UPYUN_CONFIG: UpyunConfig = {
  bucket: '',
  operator: '',
  password: '',
  publicUrl: '',
  pathPrefix: 'images',
}
