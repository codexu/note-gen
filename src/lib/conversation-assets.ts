export const CONVERSATION_ASSETS_DIRECTORY = 'conversation-assets'

// Attachments are stored as SHA-256 filenames. Synced references are untrusted:
// never decode URLs or resolve arbitrary paths before passing them to the FS API.
export function resolveConversationAssetPath(source: string): string | null {
  const prefix = `${CONVERSATION_ASSETS_DIRECTORY}/`
  if (!source.startsWith(prefix)) return null
  const filename = source.slice(prefix.length)
  const match = filename.match(/^[a-f0-9]{64}\.[a-z0-9]+$/i)
  return match?.[0] === filename ? source : null
}
