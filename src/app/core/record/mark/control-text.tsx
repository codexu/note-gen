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
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Textarea } from "@/components/ui/textarea"
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CopySlash } from "lucide-react"
import { useEffect, useState, useCallback } from "react"
import emitter from "@/lib/emitter"
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'

export function ControlText() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('')
  const isMobile = useIsMobile() || checkIsMobileDevice()

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks } = useMarkStore()

  async function handleSuccess() {
    const resetText = text.replace(/'/g, '')
    await insertMark({ tagId: currentTagId, type: 'text', desc: resetText, content: resetText })
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
    
    // 记录完成后的导航处理（桌面端切换tab，移动端跳转页面）
    handleRecordComplete(router)
    
    setText('')
    setOpen(false)
  }

  const handleOpen = useCallback(() => {
    setOpen(true)
  }, [])

  useEffect(() => {
    emitter.on('quickRecordTextHandler', handleOpen)
    emitter.on('toolbar-shortcut-text', handleOpen)
    return () => {
      emitter.off('quickRecordTextHandler', handleOpen)
      emitter.off('toolbar-shortcut-text', handleOpen)
    }
  }, [handleOpen])

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            <TooltipButton icon={<CopySlash />} tooltipText={t('record.mark.type.text')} />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('record.mark.text.title')}</DrawerTitle>
              <DrawerDescription>
                {t('record.mark.text.description')}
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-4">
              <Textarea id="username" rows={10} defaultValue={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <DrawerFooter className="flex items-center justify-between">
              <p className="text-sm text-zinc-500 mr-4">{t('record.mark.text.characterCount', { count: text.length })}</p>
              <Button type="submit" onClick={handleSuccess}>{t('record.mark.text.save')}</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <TooltipButton icon={<CopySlash />} tooltipText={t('record.mark.type.text')} />
          </DialogTrigger>
          <DialogContent className="min-w-full md:min-w-[650px]">
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
      )}
    </>
  )
}

