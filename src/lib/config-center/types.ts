export type ConfigCenterConfigKey = 'providerTemplates' | 'noteGenDefaultModels'

export interface ConfigCenterEntry {
  versionCode: number
  versionName?: string
  url: string
}

export interface ConfigCenterManifest {
  schemaVersion: number
  updatedAt?: string
  configs: Partial<Record<ConfigCenterConfigKey, ConfigCenterEntry>>
}

export type ConfigCenterFetchResult =
  | {
    status: 'updated'
    versionCode: number
    versionName?: string
    payload: unknown
  }
  | {
    status: 'not-modified'
  }
