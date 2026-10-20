'use client'

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { PluginMenuContext, PluginMenuLocation } from '@notegen/plugin-api'
import { getPluginMenuCommands, subscribePluginCommands } from '@/lib/plugins/command-registry'

export function usePluginEditorCommands(location: PluginMenuLocation, editor?: Editor | null, target?: Pick<PluginMenuContext, 'nodeKind'>) {
  const [, refresh] = useState(0)
  useEffect(() => {
    const update = () => refresh(value => value + 1)
    const dispose = subscribePluginCommands(update)
    editor?.on('transaction', update)
    return () => { dispose(); editor?.off('transaction', update) }
  }, [editor])
  return getPluginMenuCommands(location, editor && !editor.isDestroyed ? {
    editor: 'markdown', selection: !editor.state.selection.empty,
    readOnly: !editor.isEditable, codeBlock: editor.isActive('codeBlock'), ...target,
  } : {})
}
