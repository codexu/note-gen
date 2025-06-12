'use client'
import { Button } from '@/components/ui/button'
import { FileText, Menu } from 'lucide-react'
import useArticleStore from '@/stores/article'
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { FileManager } from '@/app/core/article/file/file-manager'
import { FileToolbar } from '@/app/core/article/file/file-toolbar'

export function WritingHeader() {
  const { activeFilePath } = useArticleStore()
  
  const fileName = activeFilePath ? 
    activeFilePath.split('/').pop() || activeFilePath : 
    'Untitled'

  return (
    <div className="h-12 w-full flex items-center justify-between border-b px-4 text-sm">
      <div className="flex items-center gap-2 truncate max-w-[70%]">
        <FileText className="h-4 w-4" />
        <span className="font-medium truncate">{fileName}</span>
      </div>
      
      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open files</span>
          </Button>
        </DrawerTrigger>
        <DrawerContent className="h-[85%]">
          <DrawerHeader className='hidden'>
            <DrawerTitle>Files</DrawerTitle>
          </DrawerHeader>
          <div className="p-4 h-full flex flex-col overflow-auto">
            <FileToolbar />
            <div className="flex-1">
              <FileManager />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
