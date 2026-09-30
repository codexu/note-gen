import { createHighlighterCore, splitLines, type HighlighterCore, type TokensResult } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { CodeHighlighterPlugin } from 'streamdown'

// Explicit imports keep unused grammars and themes out of the desktop bundle.
const languageLoaders = {
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
}

type SupportedLanguage = keyof typeof languageLoaders

const aliases: Record<string, SupportedLanguage> = {
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  bash: 'shellscript',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  yml: 'yaml',
  kt: 'kotlin',
  docker: 'dockerfile',
}

function resolveLanguage(language: string): SupportedLanguage | 'text' {
  const normalized = language.trim().toLowerCase()
  if (Object.hasOwn(aliases, normalized)) return aliases[normalized]
  if (Object.hasOwn(languageLoaders, normalized)) return normalized as SupportedLanguage
  return 'text'
}

let highlighter: HighlighterCore | null = null
let highlighterPromise: Promise<HighlighterCore> | null = null
const loadingLanguages = new Map<SupportedLanguage, Promise<void>>()
const results = new Map<string, TokensResult>()
const MAX_CACHED_RESULTS = 64

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    themes: [
      () => import('shiki/themes/github-light.mjs').then(module => module.default),
      () => import('shiki/themes/github-dark.mjs').then(module => module.default),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }).then(instance => {
    highlighter = instance
    return instance
  }).catch(error => {
    highlighterPromise = null
    throw error
  })
  return highlighterPromise
}

async function loadLanguage(language: SupportedLanguage | 'text') {
  const instance = await getHighlighter()
  if (language === 'text' || instance.getLoadedLanguages().includes(language)) return instance

  let loading = loadingLanguages.get(language)
  if (!loading) {
    loading = languageLoaders[language]().then(module => instance.loadLanguage(module.default))
      .finally(() => loadingLanguages.delete(language))
    loadingLanguages.set(language, loading)
  }
  await loading
  return instance
}

function plainTokens(code: string): TokensResult {
  return { tokens: splitLines(code).map(([content, offset]) => [{ content, offset }]) }
}

export const codeHighlighter: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => Object.keys(languageLoaders) as SupportedLanguage[],
  getThemes: () => ['github-light', 'github-dark'],
  supportsLanguage: language => resolveLanguage(language) !== 'text',
  highlight({ code, language }, callback) {
    const resolved = resolveLanguage(language)
    const key = `${resolved}\0${code}`
    const cached = results.get(key)
    if (cached) return cached

    const tokenize = (instance: HighlighterCore) => {
      const result = instance.codeToTokens(code, {
        lang: resolved,
        themes: { light: 'github-light', dark: 'github-dark' },
      })
      if (results.size >= MAX_CACHED_RESULTS) {
        const oldestKey = results.keys().next().value
        if (oldestKey !== undefined) results.delete(oldestKey)
      }
      results.set(key, result)
      return result
    }

    if (highlighter && (resolved === 'text' || highlighter.getLoadedLanguages().includes(resolved))) {
      try {
        return tokenize(highlighter)
      } catch (error) {
        console.error('[Code Highlighter] Failed to highlight code:', error)
        return plainTokens(code)
      }
    }

    void loadLanguage(resolved).then(instance => {
      const result = tokenize(instance)
      callback?.(result)
    }).catch(error => {
      console.error('[Code Highlighter] Failed to load grammar:', error)
      callback?.(plainTokens(code))
    })
    return null
  },
}
