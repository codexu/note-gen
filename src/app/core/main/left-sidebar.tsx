'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Files, Highlighter } from "lucide-react"
import { FileSidebar } from "../article/file"
import { NoteSidebar } from "../record/mark"
import { useState } from "react"
import { useTranslations } from "next-intl"

export function LeftSidebar() {
  const [activeTab, setActiveTab] = useState("files")
  const t = useTranslations()

  return (
    <div className="w-full h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col">
        <TabsList className="w-full h-12 rounded-none border-b justify-start px-2">
          <TabsTrigger value="files" className="gap-2">
            <Files className="h-4 w-4" />
            <span>{t('navigation.files')}</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <Highlighter className="h-4 w-4" />
            <span>{t('navigation.record')}</span>
          </TabsTrigger>
        </TabsList>
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
