'use client'
import useArticleStore from '@/stores/article'
import { useMemo } from 'react'
import CustomToolbar from './custom-toolbar'
import './style.scss'

import CustomFooter from './custom-footer'
import { getFileHandler } from '@/lib/fileHandlers'

export function MdEditor() {
  const { currentArticle, saveCurrentArticle, activeFilePath } = useArticleStore()
  const fileHandler = useMemo(() => {
    if (!activeFilePath) return undefined;
    return getFileHandler(activeFilePath);
  }, [activeFilePath]);

  const handleContentChange = (newContent: string) => {
    saveCurrentArticle(newContent);
  };

  return <div className='flex-1 w-full h-full lg:h-screen flex flex-col overflow-hidden dark:bg-zinc-950'>
    <CustomToolbar />
    {fileHandler && fileHandler.getEditorComponent({
      content: currentArticle,
      onChange: handleContentChange,
    })}
    <CustomFooter />
  </div>
}