import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// Run production modules, replacing only desktop/platform boundaries. HTTP is
// handled by the test server; no provider credentials or paid inference are used.
export async function loadMiniMaxRuntime(state) {
  globalThis.__miniMaxTest = state
  const mocks = new Map([
    ['@tauri-apps/api/core', `export class Channel { constructor(callback) { this.onmessage = callback } }; export const invoke = (...args) => globalThis.__miniMaxTest.invoke(...args)`],
    ['@tauri-apps/plugin-store', `export const Store = { load: async () => ({ get: async key => globalThis.__miniMaxTest.store.get(key), set: async (key, value) => globalThis.__miniMaxTest.store.set(key, value), save: async () => {} }) }`],
    ['@tauri-apps/plugin-fs', `export const readFile = async () => new Uint8Array([1, 2, 3])`],
    ['@tauri-apps/plugin-os', `export const platform = () => 'linux'`],
    ['@/hooks/use-toast', `export const toast = value => { globalThis.__miniMaxTest.errors.push(value) }`],
    ['@/lib/web-search/settings', `export const loadWebSearchSettings = async () => ({ apiKeys: {}, provider: 'auto' })`],
    ['@/i18n/config', `export const DEFAULT_LOCALE = 'en'; export const LANGUAGE_STORAGE_KEY = 'language'; export const normalizeLocale = () => 'en'; export const loadMessagesWithFallback = async () => ({})`],
    ['next-intl', `export const createTranslator = () => key => key`],
    ['@/lib/config-center/client', `export const fetchConfigCenterConfig = async () => globalThis.__miniMaxTest.remote`],
    ['storefront-policy', `export const isMainlandChinaAppStore = async () => false; export const isBuiltInOpenAIProvider = () => false; export const excludeBuiltInOpenAIProviders = items => items`],
    ['sponsored-model-limits', `export const reserveSponsoredRequest = async (_config, body) => body`],
    ['../mcp/tools', `export const callTool = async (...args) => { globalThis.__miniMaxTest.toolCalls.push(args); return { content: [{ type: 'text', text: 'tool result' }] } }`],
    ['@/stores/mcp', `export const useMcpStore = { getState: () => ({}) }`],
    ['@/stores/chat', `export default { getState: () => ({ isTemporaryConversation: true }) }`],
    ['@/lib/context/loader', `export const memoryContextService = { getMemoryContext: async () => [], formatMemoryContext: () => '' }`],
    ['react/jsx-runtime', `export const jsx = () => null; export const jsxs = jsx`],
    ['lucide-react', `export const BotMessageSquare=()=>null, LayoutTemplate=BotMessageSquare, ScanText=BotMessageSquare, Store=BotMessageSquare, Drama=BotMessageSquare, FolderOpen=BotMessageSquare, DatabaseBackup=BotMessageSquare, ArchiveRestore=BotMessageSquare, ImageUp=BotMessageSquare, FileCog=BotMessageSquare, Book=BotMessageSquare, KeyboardIcon=BotMessageSquare, Volume2=BotMessageSquare, Settings=BotMessageSquare, Puzzle=BotMessageSquare, Sparkles=BotMessageSquare, PenTool=BotMessageSquare, Brain=BotMessageSquare, Globe2=BotMessageSquare, Palette=BotMessageSquare, Blocks=BotMessageSquare`],
  ])
  const result = await build({
    stdin: {
      contents: `export * from './src/lib/ai/minimax'; export * from './src/lib/ai/tauri-client'; export * from './src/lib/ai/utils'; export * from './src/lib/ai/chat'; export * from './src/lib/ai/provider-templates-runtime'; export { builtinProviderTemplates } from './src/app/core/setting/config';`,
      resolveDir: root,
    },
    absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
    plugins: [{ name: 'desktop-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const key = mocks.has(args.path) ? args.path : ['storefront-policy', 'sponsored-model-limits'].find(name => args.path.endsWith(`/${name}`))
        if (key) return { path: key, namespace: 'fixture' }
        if (args.path.startsWith('@/')) {
          const path = resolve(root, 'src', args.path.slice(2))
          for (const suffix of ['', '.ts', '.tsx', '.json']) if (existsSync(path + suffix)) return { path: path + suffix }
        }
      })
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks.get(args.path), loader: 'js' }))
    } }],
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
