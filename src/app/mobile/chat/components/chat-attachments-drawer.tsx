"use client"

import { MessageCirclePlus, ImageIcon, Camera, AtSign } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipButton } from "@/components/tooltip-button"
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerClose,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { FileSelector } from "@/app/core/record/chat/file-selector"
import { MarkdownFile } from "@/lib/files"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"

interface ChatAttachmentsDrawerProps {
  onImageSelect: () => void
  onCameraOpen: () => void
  onFileLink: (file: MarkdownFile) => void
}

export function ChatAttachmentsDrawer({
  onImageSelect,
  onCameraOpen,
  onFileLink,
}: ChatAttachmentsDrawerProps) {
  const t = useTranslations('mobile.chat.drawer')
  const [showFileSelector, setShowFileSelector] = useState(false)
  const { primaryModel } = useSettingStore()
  const { loading } = useChatStore()

  return (
    <>
      <Drawer>
        <DrawerTrigger asChild>
          <TooltipButton
            variant="ghost"
            size="icon"
            icon={<MessageCirclePlus className="size-4" />}
            tooltipText={t('attachments.title')}
            side="bottom"
          />
        </DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerTitle className="sr-only">
            {t('attachments.title')}
          </DrawerTitle>
          <div className="p-4 overflow-auto">
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                className="flex flex-col items-center justify-center p-3 gap-1 h-auto"
                onClick={onImageSelect}
              >
                <ImageIcon className="size-4" aria-hidden="true" />
                <span className="text-xs">{t('attachments.gallery')}</span>
              </Button>
              
              <Button
                variant="outline"
                className="flex flex-col items-center justify-center p-3 gap-1 h-auto"
                onClick={onCameraOpen}
              >
                <Camera className="size-4" />
                <span className="text-xs">{t('attachments.camera')}</span>
              </Button>
              
              <DrawerClose asChild>
                <Button
                  variant="outline"
                  className="flex flex-col items-center justify-center p-3 gap-1 h-auto"
                  disabled={!primaryModel || loading}
                  onClick={() => setShowFileSelector(true)}
                >
                  <AtSign className="size-4" />
                  <span className="text-xs">{t('attachments.linkNote')}</span>
                </Button>
              </DrawerClose>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {showFileSelector && (
        <FileSelector
          isOpen={showFileSelector}
          onClose={() => setShowFileSelector(false)}
          onFileSelect={(file) => {
            onFileLink(file)
            setShowFileSelector(false)
          }}
        />
      )}
    </>
  )
}
