'use client'

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Home,
  Plus,
  X,
  ExternalLink,
  Star,
  StarOff
} from 'lucide-react'
import { cn } from "@/lib/utils"

interface Tab {
  id: string
  title: string
  url: string
  history: string[]
  historyIndex: number
}

interface Bookmark {
  id: string
  title: string
  url: string
}

interface WebviewToolbarProps {
  tabs: Tab[]
  activeTabId: string
  onTabSelect: (tabId: string) => void
  onNewTab: () => void
  onCloseTab: (tabId: string) => void
  currentUrl: string
  onUrlChange: (url: string) => void
  onGoBack: () => void
  onGoForward: () => void
  onReload: () => void
  onGoHome: () => void
  canGoBack: boolean
  canGoForward: boolean
  bookmarks?: Bookmark[]
  onAddBookmark?: (bookmark: Bookmark) => void
}

export function WebviewToolbar({
  tabs,
  activeTabId,
  onTabSelect,
  onNewTab,
  onCloseTab,
  currentUrl,
  onUrlChange,
  onGoBack,
  onGoForward,
  onReload,
  onGoHome,
  canGoBack,
  canGoForward,
  bookmarks = [],
  onAddBookmark
}: WebviewToolbarProps) {
  const [inputUrl, setInputUrl] = useState('')

  const isBookmarked = bookmarks.some(b => b.url === currentUrl)

  const handleUrlSubmit = () => {
    if (inputUrl.trim()) {
      let targetUrl = inputUrl.trim()
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl
      }
      onUrlChange(targetUrl)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleUrlSubmit()
    }
  }

  const handleAddBookmark = () => {
    if (currentUrl && onAddBookmark) {
      const bookmark: Bookmark = {
        id: Date.now().toString(),
        title: currentUrl,
        url: currentUrl
      }
      onAddBookmark(bookmark)
    }
  }

  const handleOpenExternal = () => {
    if (currentUrl) {
      window.open(currentUrl, '_blank')
    }
  }

  return (
    <div className="border-b bg-background">
      {/* 分頁欄 */}
      <div className="flex items-center border-b bg-muted/20">
        <div className="flex items-center flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-sm cursor-pointer hover:bg-accent/50 relative group min-w-0 border-r border-border/50",
                activeTabId === tab.id
                  ? "bg-background border-b-2 border-b-primary shadow-sm"
                  : "bg-transparent"
              )}
              onClick={() => onTabSelect(tab.id)}
            >
              <span className="max-w-32 truncate">
                {tab.title || '新分頁'}
              </span>
              {tabs.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground ml-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewTab}
          className="h-9 w-9 p-0 rounded-none border-l border-border/50 hover:bg-accent/50"
          title="新分頁"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* 工具列 */}
      <div className="flex items-center gap-2 p-2">
        {/* 導航按鈕 */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onGoBack}
            disabled={!canGoBack}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onGoForward}
            disabled={!canGoForward}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReload}
            className="h-8 w-8 p-0"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onGoHome}
            className="h-8 w-8 p-0"
          >
            <Home className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAddBookmark}
            disabled={!currentUrl}
            className="h-8 w-8 p-0"
          >
            {isBookmarked ? <Star className="h-4 w-4 fill-current" /> : <StarOff className="h-4 w-4" />}
          </Button>
        </div>

        {/* 網址列 */}
        <div className="flex-1 flex items-center gap-2">
          <Input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="輸入網址..."
            className="flex-1 h-8"
          />
          <Button size="sm" onClick={handleUrlSubmit} className="h-8">
            前往
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenExternal}
            className="h-8 w-8 p-0"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
