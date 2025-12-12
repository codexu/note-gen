'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Files, Highlighter } from "lucide-react"
import { FileSidebar } from "../article/file"
import { NoteSidebar } from "../record/mark"
import { FileActions } from "../article/file/file-actions"
import { MarkActions } from "../record/mark/mark-actions"
import { useTranslations } from "next-intl"
import { useSidebarStore } from "@/stores/sidebar"

export function LeftSidebar() {
  const { leftSidebarTab, setLeftSidebarTab } = useSidebarStore()
  const t = useTranslations()

  const handleTabChange = (value: string) => {
    if (value === 'files' || value === 'notes') {
      setLeftSidebarTab(value)
    }
  }

  return (
    <div className="w-full h-full flex flex-col">
      <Tabs value={leftSidebarTab} onValueChange={handleTabChange} className="w-full h-full flex flex-col">
        <div className="w-full h-12 border-b flex items-center justify-between px-2">
          <TabsList>
            <TabsTrigger value="files" className="gap-2">
              <Files className="h-4 w-4" />
              <span>{t('navigation.files')}</span>
            </TabsTrigger>
            <TabsTrigger value="notes" className="gap-2">
              <Highlighter className="h-4 w-4" />
              <span>{t('navigation.record')}</span>
            </TabsTrigger>
          </TabsList>
          {leftSidebarTab === "files" && <FileActions />}
          {leftSidebarTab === "notes" && <MarkActions />}
        </div>
        <TabsContent value="files" className="flex-1 m-0 overflow-hidden">
          <FileSidebar />
        </TabsContent>
        <TabsContent value="notes" className="flex-1 m-0 overflow-hidden">
          <NoteSidebar />
        </TabsContent>
      </Tabs>
    </div>
  )
}
