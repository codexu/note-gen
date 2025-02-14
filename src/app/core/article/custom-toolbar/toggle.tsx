import { TooltipButton } from "@/components/tooltip-button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ExposeParam, ToolbarNames } from "md-editor-rt";
import { RefObject, useEffect, useState } from "react";
import { Settings } from "./settings.type";
import { Store } from "@tauri-apps/plugin-store";
import { _t } from '@/locales/index';

const toolbars: ToolbarNames[] = [
  'bold',
  'underline',
  'italic',
  '-',
  'strikeThrough',
  'sub',
  'sup',
  'quote',
  'unorderedList',
  'orderedList',
  'task',
  '-',
  'codeRow',
  'code',
  'link',
  'image',
  'table',
  'mermaid',
  'katex',
  '=',
  'catalog',
  'htmlPreview',
  'pageFullscreen',
]
export default function Toggle({mdRef, settings}: {mdRef: RefObject<ExposeParam>, settings: Settings}) {

  const [value, setValue] = useState(false)

  async function initValue() {
    const store = await Store.load('store.json')
    const toolbarState = await store.get<boolean>('toolbarState') || false
    setValue(toolbarState)
    if (toolbarState) {
      settings.setToolbar(toolbars)
    } else {
      settings.setToolbar([])
    }
  }

  useEffect(() => {
    initValue()
  }, [])

  async function handleSet() {
    const store = await Store.load('store.json')
    if (value) {
      settings.setToolbar([])
      await store.set('toolbarState', false)
    } else {
      settings.setToolbar(toolbars)
      await store.set('toolbarState', true)
    }
  }
  async function handleToggle() {
    mdRef.current?.focus()
    setValue(!value)
    handleSet()
  }

  return (
    <TooltipButton
      icon={value ? <ChevronUp /> : <ChevronDown />}
      tooltipText={value ? _t('hide_toolbar') : _t('expand_toolbar')}
      onClick={handleToggle}
    >
    </TooltipButton>
  )
}
