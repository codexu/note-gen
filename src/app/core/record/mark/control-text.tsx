import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CopySlash } from "lucide-react"
import { useState } from "react"

export function ControlText() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('')

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks } = useMarkStore()

  async function handleSuccess() {
    const resetText = text.replace(/'/g, '')
    await insertMark({ tagId: currentTagId, type: 'text', desc: resetText, content: resetText })
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
    setText('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <TooltipButton icon={<CopySlash />} tooltipText={t('record.mark.type.text')} />
      </DialogTrigger>
      <DialogContent className="min-w-[650px]">
        <DialogHeader>
          <DialogTitle>{t('record.mark.text.title')}</DialogTitle>
          <DialogDescription>
            {t('record.mark.text.description')}
          </DialogDescription>
        </DialogHeader>
        <Textarea id="username" rows={10} defaultValue={text} onChange={(e) => setText(e.target.value)} />
        <DialogFooter className="flex items-center justify-between">
          <p className="text-sm text-zinc-500 mr-4">{t('record.mark.text.characterCount', { count: text.length })}</p>
          <Button type="submit" onClick={handleSuccess}>{t('record.mark.text.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

