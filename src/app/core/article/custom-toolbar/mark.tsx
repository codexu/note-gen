import { fetchAi } from "@/lib/ai";
import useArticleStore from "@/stores/article";
import { Highlighter, Plus } from "lucide-react";
import { MarkWrapper } from "../../record/mark/mark-item";
import { MarkLoading } from "../../record/mark/mark-loading";
import useMarkStore from "@/stores/mark";
import { Button } from "@/components/ui/button";
import { Mark, delMark } from "@/db/marks";
import { TooltipButton } from "@/components/tooltip-button";
import useSettingStore from "@/stores/setting";
import Vditor from "vditor";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import emitter from "@/lib/emitter";
import { useTranslations } from "next-intl";

export default function MarkInsert({editor}: {editor?: Vditor}) {
  const [open, setOpen] = useState(false)
  const { loading, setLoading } = useArticleStore()
  const { primaryModel } = useSettingStore()
  const { allMarks, queues, fetchAllMarks } = useMarkStore()
  const t = useTranslations('article.editor.toolbar.mark')

  async function handleBlock(mark: Mark) {
    setLoading(true)
    await delMark(mark.id)
    allMarks.splice(allMarks.findIndex(mark => mark.id === mark.id), 1)
    editor?.focus()
    switch (mark.type) {
      case 'text':
        editor?.insertValue(mark.content || '')
        break;
      case 'image':
        editor?.insertValue(`![${mark.desc}](${mark.url})`)
        break;
      default:
        if (primaryModel) {
          const req = `这是一段 OCR 识别的结果：${mark.content}进行整理，直接返回整理后的结果。`
          const res = await fetchAi(req)
          editor?.insertValue(res)
        } else {
          editor?.insertValue(mark.content || t('ocrNoContent'))
        }
        break;
    }
    setLoading(false)
  }

  async function openChangeHandler(e: boolean) {
    setOpen(e)
    if (e) {
      fetchAllMarks()
    }
  }

  useEffect(() => {
    emitter.on('toolbar-mark', () => {
      openChangeHandler(true)
    })
    return () => {
      emitter.off('toolbar-mark', () => {
        openChangeHandler(false)
      })
    }
  }, [editor])

  return (
    <Sheet open={open} onOpenChange={openChangeHandler}>
      <SheetTrigger asChild>
        <div>
          <TooltipButton tooltipText={t('tooltip')} icon={<Highlighter />} disabled={loading} />
        </div>
      </SheetTrigger>
      <SheetContent className="p-0 min-w-full lg:min-w-[500px]">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="max-h-[calc(100vh/1.5)] overflow-y-auto">
          {
            queues.map(mark => {
              return (
                <MarkLoading key={mark.queueId} mark={mark} />
              )
            })
          }
          {
            allMarks.length ?
            allMarks.map((mark) => (
              <div key={mark.id} className="flex items-center border-b last:border-none">
                <Button className="size-12 ml-2" onClick={() => handleBlock(mark)}variant="ghost"><Plus /></Button>
                <MarkWrapper mark={mark} />
              </div>
            )) :
            <div className="flex items-center justify-center text-zinc-500 text-xs text-center h-48">
              {t('noRecords')}
            </div>
          }
        </div>
      </SheetContent>
    </Sheet>
  )
}