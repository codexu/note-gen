import type { ReactNodeViewRendererOptions } from '@tiptap/react'

// For views whose React UI depends only on node attributes and marks.
// ProseMirror updates contentDOM and decorations without a React render.
export const updateNodeViewOnMarkupChange: NonNullable<ReactNodeViewRendererOptions['update']> = ({
  oldNode,
  newNode,
  updateProps,
}) => {
  if (!oldNode.sameMarkup(newNode)) {
    updateProps()
  }

  return true
}
