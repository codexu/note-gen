import { getDb } from './index'

export interface ImageAnalysisCacheEntry {
  cacheKey: string
  imageHash: string
  queryHash: string
  ocrText?: string
  visualAnalysis?: string
  mimeType?: string
  width?: number
  height?: number
  updatedAt: number
}

export async function initImageAnalysisCacheDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists image_analysis_cache (
      cacheKey text primary key,
      imageHash text not null,
      queryHash text not null,
      ocrText text default null,
      visualAnalysis text default null,
      mimeType text default null,
      width integer default null,
      height integer default null,
      updatedAt integer not null
    )
  `)
  await db.execute(`
    create index if not exists image_analysis_cache_hash
    on image_analysis_cache(imageHash, updatedAt desc)
  `)
}

export async function getImageAnalysisCache(cacheKey: string) {
  await initImageAnalysisCacheDb()
  const db = await getDb()
  const rows = await db.select<ImageAnalysisCacheEntry[]>(
    'select * from image_analysis_cache where cacheKey = $1 limit 1',
    [cacheKey]
  )
  return rows[0]
}

export async function saveImageAnalysisCache(entry: ImageAnalysisCacheEntry) {
  await initImageAnalysisCacheDb()
  const db = await getDb()
  await db.execute(
    `insert into image_analysis_cache
      (cacheKey, imageHash, queryHash, ocrText, visualAnalysis, mimeType, width, height, updatedAt)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict(cacheKey) do update set
       ocrText = excluded.ocrText,
       visualAnalysis = excluded.visualAnalysis,
       mimeType = excluded.mimeType,
       width = excluded.width,
       height = excluded.height,
       updatedAt = excluded.updatedAt`,
    [
      entry.cacheKey,
      entry.imageHash,
      entry.queryHash,
      entry.ocrText,
      entry.visualAnalysis,
      entry.mimeType,
      entry.width,
      entry.height,
      entry.updatedAt,
    ]
  )
}
