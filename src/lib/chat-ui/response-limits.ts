/** Shared by schema publication, runtime validation, text projection and model guidance. */
export const RESPONSE_LIMITS = {
  elements: 256,
  children: 128,
  depth: 12,
  specChars: 256_000,
  collectionItems: 2_000,
} as const
