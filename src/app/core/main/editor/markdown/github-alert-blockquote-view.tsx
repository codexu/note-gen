'use client'

import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { ResponsiveSelect } from '@/components/responsive-select'
import {
  GITHUB_ALERT_META,
  GITHUB_ALERT_TYPES,
  GitHubAlertBlockquote,
  parseGitHubAlertTitle,
  parseGitHubAlertType,
  type GitHubAlertType,
} from './github-alert-blockquote'

const NORMAL_BLOCKQUOTE_VALUE = 'BLOCKQUOTE'

function getTitleInputWidth(title: string) {
  const width = Array.from(title).reduce((total, character) => (
    total + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1)
  ), 0)

  return Math.max(4, Math.min(width, 40))
}

function GitHubAlertIcon({ alertType }: { alertType: GitHubAlertType }) {
  return (
    <svg
      className="markdown-alert-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path d={GITHUB_ALERT_META[alertType].iconPath} />
    </svg>
  )
}

function GitHubAlertBlockquoteView({ node, updateAttributes }: ReactNodeViewProps) {
  const t = useTranslations('editor.githubAlert')
  const alertType = parseGitHubAlertType(node.attrs.alertType)
  const storedTitle = parseGitHubAlertTitle(node.attrs.alertTitle)
  const defaultTitle = alertType ? GITHUB_ALERT_META[alertType].label : ''
  const displayedTitle = storedTitle ?? defaultTitle
  const [titleDraft, setTitleDraft] = useState(displayedTitle)
  const cancelTitleEditRef = useRef(false)

  useEffect(() => {
    setTitleDraft(displayedTitle)
  }, [displayedTitle])

  const commitTitle = () => {
    if (!alertType) return

    if (cancelTitleEditRef.current) {
      cancelTitleEditRef.current = false
      setTitleDraft(displayedTitle)
      return
    }

    const nextTitle = parseGitHubAlertTitle(titleDraft)
    const nextStoredTitle = nextTitle && nextTitle !== defaultTitle ? nextTitle : null
    setTitleDraft(nextStoredTitle ?? defaultTitle)
    if (nextStoredTitle !== storedTitle) updateAttributes({ alertTitle: nextStoredTitle })
  }

  if (!alertType) {
    return (
      <NodeViewWrapper as="blockquote">
        <NodeViewContent />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      as="blockquote"
      className={`markdown-alert markdown-alert-${alertType.toLowerCase()}`}
      data-github-alert={alertType.toLowerCase()}
    >
      <div className="markdown-alert-title" contentEditable={false}>
        <ResponsiveSelect
          title={t('changeType')}
          value={alertType}
          appearance="inline"
          className="markdown-alert-type-picker"
          triggerContent={<GitHubAlertIcon alertType={alertType} />}
          showChevron={false}
          options={[
            { value: NORMAL_BLOCKQUOTE_VALUE, label: t('normalQuote') },
            ...GITHUB_ALERT_TYPES.map(type => ({
              value: type,
              label: GITHUB_ALERT_META[type].label,
            })),
          ]}
          onValueChange={(value) => {
            if (value === NORMAL_BLOCKQUOTE_VALUE) {
              updateAttributes({ alertType: null, alertTitle: null })
              return
            }

            const nextType = parseGitHubAlertType(value)
            if (nextType) updateAttributes({ alertType: nextType })
          }}
        />
        <input
          className="markdown-alert-title-input"
          value={titleDraft}
          style={{ width: `${getTitleInputWidth(titleDraft || defaultTitle)}ch` }}
          maxLength={120}
          aria-label={t('titleLabel')}
          onChange={(event) => setTitleDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelTitleEditRef.current = true
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      <NodeViewContent className="markdown-alert-content" />
    </NodeViewWrapper>
  )
}

const renderGitHubAlertNodeView = ReactNodeViewRenderer(GitHubAlertBlockquoteView)

export const GitHubAlertBlockquoteEditor = GitHubAlertBlockquote.extend({
  addNodeView() {
    return props => {
      if (parseGitHubAlertType(props.node.attrs.alertType)) {
        return renderGitHubAlertNodeView(props)
      }

      const dom = document.createElement('blockquote')
      return { dom, contentDOM: dom }
    }
  },
})
