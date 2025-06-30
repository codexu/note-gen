import { fetchAiStreamToken } from "@/lib/ai";
import emitter from "@/lib/emitter";
import { useEffect } from "react";
import Vditor from "vditor";
import { useTranslations } from "next-intl";

export default function Continue({editor}: {editor?: Vditor}) {
  const t = useTranslations('article.editor.toolbar.continue')

  async function handler() {
    const button = editor?.vditor.toolbar?.elements?.continue?.childNodes[0] as HTMLButtonElement
    if (button) {
      button.classList.add('vditor-menu--disabled')
    }
    const content = editor?.getValue()
    editor?.focus()
    if (!content) return
    const selection = document.getSelection();
    const anchorOffset = selection?.anchorOffset
    const startContent = content.slice(0, anchorOffset);
    const endContent = content.slice(anchorOffset, content.length);
    const req = t('promptTemplate', {
      content: startContent,
      endContent: endContent
    })
    await fetchAiStreamToken(req, (text) => {
      editor?.insertValue(text)
    })
    if (button) {
      button.classList.remove('vditor-menu--disabled')
    }
  }

  useEffect(() => {
    emitter.on('toolbar-continue', handler)
    return () => {
      emitter.off('toolbar-continue', handler)
    }
  }, [editor])

  return (
    <></>
  )
}