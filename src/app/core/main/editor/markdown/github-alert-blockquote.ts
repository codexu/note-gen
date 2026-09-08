import {
  mergeAttributes,
  Node,
  wrappingInputRule,
  type JSONContent,
  type MarkdownRendererHelpers,
  type MarkdownToken,
} from '@tiptap/core'
import type MarkdownIt from 'markdown-it'

export const GITHUB_ALERT_TYPES = [
  'NOTE',
  'TIP',
  'IMPORTANT',
  'WARNING',
  'CAUTION',
] as const

export type GitHubAlertType = (typeof GITHUB_ALERT_TYPES)[number]

interface GitHubAlertMeta {
  label: string
  iconPath: string
}

export const GITHUB_ALERT_META: Record<GitHubAlertType, GitHubAlertMeta> = {
  NOTE: {
    label: 'Note',
    iconPath: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  },
  TIP: {
    label: 'Tip',
    iconPath: 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z',
  },
  IMPORTANT: {
    label: 'Important',
    iconPath: 'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  },
  WARNING: {
    label: 'Warning',
    iconPath: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  },
  CAUTION: {
    label: 'Caution',
    iconPath: 'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  },
}

const GITHUB_ALERT_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\r\n]+))?(?:\r?\n|$)/
const BLOCKQUOTE_INPUT_RE = /^\s*>\s$/

function isGitHubAlertType(value: unknown): value is GitHubAlertType {
  return typeof value === 'string'
    && GITHUB_ALERT_TYPES.includes(value as GitHubAlertType)
}

export function parseGitHubAlertType(value: unknown): GitHubAlertType | null {
  const normalized = typeof value === 'string' ? value.toUpperCase() : null
  return isGitHubAlertType(normalized) ? normalized : null
}

export function parseGitHubAlertTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.replace(/[\r\n]+/g, ' ').trim()
  return normalized || null
}

function getGitHubAlertMarker(token: MarkdownToken) {
  const firstBlock = token.tokens?.[0]
  if (firstBlock?.type !== 'paragraph' || typeof firstBlock.text !== 'string') {
    return null
  }

  const match = firstBlock.text.match(GITHUB_ALERT_MARKER_RE)
  if (!match || !isGitHubAlertType(match[1])) {
    return null
  }

  return {
    alertType: match[1],
    alertTitle: parseGitHubAlertTitle(match[2]),
    marker: match[0],
  }
}

function stripMarkerFromBlockContent(content: JSONContent[], marker: string): JSONContent[] | null {
  const firstBlock = content[0]
  const firstInline = firstBlock?.content?.[0]
  if (
    firstBlock?.type !== 'paragraph'
    || firstInline?.type !== 'text'
    || typeof firstInline.text !== 'string'
    || !firstInline.text.startsWith(marker)
  ) {
    return null
  }

  const firstInlineText = firstInline.text.slice(marker.length)
  const firstBlockContent = [
    ...(firstInlineText ? [{ ...firstInline, text: firstInlineText }] : []),
    ...(firstBlock.content?.slice(1) ?? []),
  ]
  const nextFirstBlock: JSONContent = {
    ...firstBlock,
    content: firstBlockContent.length > 0 ? firstBlockContent : undefined,
  }

  if (firstBlockContent.length === 0 && content.length > 1) {
    return content.slice(1)
  }

  return [nextFirstBlock, ...content.slice(1)]
}

function renderBlockquoteChildren(node: JSONContent, helpers: MarkdownRendererHelpers) {
  return (node.content ?? []).map(child => {
    const content = helpers.renderChildren([child])
    const quoted = content
      .split('\n')
      .map(line => line.trim() === '' ? '>' : `> ${line}`)
      .join('\n')

    return { content, quoted }
  })
}

function renderGitHubAlertTitle(alertType: GitHubAlertType, alertTitle?: string | null) {
  const meta = GITHUB_ALERT_META[alertType]
  const title = alertTitle ?? meta.label
  return `<p class="markdown-alert-title"><svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${meta.iconPath}"></path></svg>${title}</p>`
}

function addGitHubAlertAttributes(
  token: MarkdownIt.Token,
  alertType: GitHubAlertType,
  alertTitle?: string | null,
) {
  const className = `markdown-alert markdown-alert-${alertType.toLowerCase()}`
  token.attrJoin('class', className)
  token.attrSet('data-github-alert', alertType.toLowerCase())
  if (alertTitle) token.attrSet('data-github-alert-title', alertTitle)
}

function findMatchingBlockquoteClose(tokens: MarkdownIt.Token[], startIndex: number) {
  let depth = 0

  for (let index = startIndex; index < tokens.length; index++) {
    if (tokens[index].type === 'blockquote_open') {
      depth++
    } else if (tokens[index].type === 'blockquote_close') {
      depth--
      if (depth === 0) return tokens[index]
    }
  }

  return null
}

export function configureGitHubAlertMarkdownIt(markdown: MarkdownIt) {
  markdown.core.ruler.after('inline', 'github_alerts', (state) => {
    for (let index = 0; index < state.tokens.length; index++) {
      const openToken = state.tokens[index]
      const paragraphOpen = state.tokens[index + 1]
      const inlineToken = state.tokens[index + 2]
      const paragraphClose = state.tokens[index + 3]
      if (
        openToken.type !== 'blockquote_open'
        || paragraphOpen?.type !== 'paragraph_open'
        || inlineToken?.type !== 'inline'
        || paragraphClose?.type !== 'paragraph_close'
      ) {
        continue
      }

      const match = inlineToken.content.match(GITHUB_ALERT_MARKER_RE)
      if (
        !match
        || !isGitHubAlertType(match[1])
      ) {
        continue
      }

      const remainingContent = inlineToken.content.slice(match[0].length)
      inlineToken.content = remainingContent
      inlineToken.children = []
      state.md.inline.parse(remainingContent, state.md, state.env, inlineToken.children)

      const alertTitle = parseGitHubAlertTitle(match[2])
      addGitHubAlertAttributes(openToken, match[1], alertTitle)
      const closeToken = findMatchingBlockquoteClose(state.tokens, index)
      if (closeToken) addGitHubAlertAttributes(closeToken, match[1], alertTitle)
    }
  })

  const defaultBlockquoteOpen = markdown.renderer.rules.blockquote_open
  const defaultBlockquoteClose = markdown.renderer.rules.blockquote_close

  markdown.renderer.rules.blockquote_open = (tokens, index, options, env, self) => {
    const alertType = parseGitHubAlertType(tokens[index].attrGet('data-github-alert'))
    const alertTitle = parseGitHubAlertTitle(tokens[index].attrGet('data-github-alert-title'))
    const openingTag = defaultBlockquoteOpen
      ? defaultBlockquoteOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options)

    return alertType
      ? `${openingTag}${renderGitHubAlertTitle(alertType, alertTitle ? markdown.utils.escapeHtml(alertTitle) : null)}<div class="markdown-alert-content">`
      : openingTag
  }

  markdown.renderer.rules.blockquote_close = (tokens, index, options, env, self) => {
    const alertType = parseGitHubAlertType(tokens[index].attrGet('data-github-alert'))
    if (alertType) return '</div>\n</blockquote>\n'

    return defaultBlockquoteClose
      ? defaultBlockquoteClose(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options)
  }
}

export const GitHubAlertBlockquote = Node.create({
  name: 'blockquote',

  priority: 110,

  content: 'block+',

  group: 'block',

  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      alertType: {
        default: null,
        rendered: false,
      },
      alertTitle: {
        default: null,
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'blockquote[data-github-alert]',
        getAttrs: element => {
          const alertType = parseGitHubAlertType(element.getAttribute('data-github-alert'))
          return alertType
            ? {
                alertType,
                alertTitle: parseGitHubAlertTitle(element.getAttribute('data-github-alert-title')),
              }
            : false
        },
        contentElement: '.markdown-alert-content',
      },
      { tag: 'blockquote' },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const alertType = parseGitHubAlertType(node.attrs.alertType)
    if (!alertType) {
      return ['blockquote', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
    }

    const meta = GITHUB_ALERT_META[alertType]
    const alertTitle = parseGitHubAlertTitle(node.attrs.alertTitle)
    return [
      'blockquote',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: `markdown-alert markdown-alert-${alertType.toLowerCase()}`,
        'data-github-alert': alertType.toLowerCase(),
        ...(alertTitle ? { 'data-github-alert-title': alertTitle } : {}),
      }),
      [
        'p',
        { class: 'markdown-alert-title', contenteditable: 'false' },
        [
          'http://www.w3.org/2000/svg svg',
          {
            class: 'markdown-alert-icon',
            viewBox: '0 0 16 16',
            width: '16',
            height: '16',
            'aria-hidden': 'true',
          },
          ['path', { d: meta.iconPath }],
        ],
        alertTitle ?? meta.label,
      ],
      ['div', { class: 'markdown-alert-content' }, 0],
    ]
  },

  parseMarkdown: (token, helpers) => {
    const content = helpers.parseChildren(token.tokens ?? [])
    const alert = getGitHubAlertMarker(token)
    if (!alert) {
      return helpers.createNode('blockquote', undefined, content)
    }

    const strippedContent = stripMarkerFromBlockContent(content, alert.marker)
    return strippedContent
      ? helpers.createNode('blockquote', {
          alertType: alert.alertType,
          alertTitle: alert.alertTitle,
        }, strippedContent)
      : helpers.createNode('blockquote', undefined, content)
  },

  renderMarkdown: (node, helpers) => {
    if (!node.content) return ''

    const children = renderBlockquoteChildren(node, helpers)
    const alertType = parseGitHubAlertType(node.attrs?.alertType)
    if (!alertType) {
      return children.map(child => child.quoted).join('\n>\n')
    }

    const alertTitle = parseGitHubAlertTitle(node.attrs?.alertTitle)
    const marker = `> [!${alertType}]${alertTitle ? ` ${alertTitle}` : ''}`
    const onlyChild = node.content[0]
    if (
      node.content.length === 1
      && onlyChild.type === 'paragraph'
      && (!onlyChild.content || onlyChild.content.length === 0)
    ) {
      return marker
    }

    const body = children.map(child => child.quoted).join('\n>\n')
    return body ? `${marker}\n${body}` : marker
  },

  addCommands() {
    return {
      setBlockquote: () => ({ commands }) => commands.wrapIn(this.name),
      toggleBlockquote: () => ({ commands }) => commands.toggleWrap(this.name),
      unsetBlockquote: () => ({ commands }) => commands.lift(this.name),
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection
        const blockquoteDepth = $from.depth - 1
        const markerNode = $from.parent.childCount === 1 ? $from.parent.firstChild : null
        const markerText = markerNode?.isText && markerNode.marks.length === 0
          ? markerNode.text
          : null
        const markerMatch = markerText?.match(GITHUB_ALERT_MARKER_RE)
        if (
          !empty
          || !markerMatch
          || !isGitHubAlertType(markerMatch[1])
          || $from.parent.type.name !== 'paragraph'
          || markerNode?.text !== markerMatch[0]
          || $from.parentOffset !== $from.parent.content.size
          || blockquoteDepth < 1
          || $from.node(blockquoteDepth).type !== this.type
          || $from.index(blockquoteDepth) !== 0
        ) {
          return false
        }

        const blockquote = $from.node(blockquoteDepth)
        if (parseGitHubAlertType(blockquote.attrs.alertType)) {
          return false
        }

        const transaction = state.tr
          .setNodeMarkup($from.before(blockquoteDepth), undefined, {
            ...blockquote.attrs,
            alertType: markerMatch[1],
            alertTitle: parseGitHubAlertTitle(markerMatch[2]),
          })
        if (blockquote.childCount > 1) {
          transaction.delete($from.before($from.depth), $from.after($from.depth))
        } else {
          transaction.delete($from.start(), $from.end())
        }
        view.dispatch(transaction)
        return true
      },
      'Mod-Shift-b': () => this.editor.commands.toggleBlockquote(),
    }
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: BLOCKQUOTE_INPUT_RE,
        type: this.type,
      }),
    ]
  },
})
