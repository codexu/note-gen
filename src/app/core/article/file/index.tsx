'use client'

import React, { useEffect } from "react"
import { FileManager } from "./file-manager"
import { FileFooter } from "./file-footer"
import useArticleStore from "@/stores/article"

export function FileSidebar() {
  const { initCollapsibleList, initSortSettings, initShowCloudFiles } = useArticleStore()

  useEffect(() => {
    initCollapsibleList()
    initSortSettings()
    initShowCloudFiles()
  }, [])

  return (
    <div id="article-sidebar" className="w-full h-full flex flex-col">
      <div className="flex-1 overflow-x-hidden overflow-y-auto">
        <FileManager />
      </div>
      <FileFooter />
    </div>
  )
}