import { TooltipButton } from "@/components/tooltip-button";
import { Undo2Icon } from "lucide-react";
import { ExposeParam } from "md-editor-rt";
import { RefObject } from "react";
import { undo } from '@codemirror/commands'
import { _t } from '@/locales/index';

export default function Undo({mdRef}: {mdRef: RefObject<ExposeParam>}) {
  async function handler() {
    const cordemirror = mdRef.current?.getEditorView()
    if (!cordemirror) return
    undo(cordemirror)
    mdRef.current?.focus()
  }
  return (
    <TooltipButton icon={<Undo2Icon />} tooltipText={_t('undo')} onClick={handler}>
    </TooltipButton>
  )
}
