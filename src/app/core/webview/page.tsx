'use client'
import { WebviewToolbar } from "./webview-toolbar"
import { SimpleWebView } from "./simple-webview"
import dynamic from 'next/dynamic'
import { useState } from "react"

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

function WebviewPage() {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: '1',
      title: '新分頁',
      url: '',
      history: [],
      historyIndex: -1
    }
  ])
  const [activeTabId, setActiveTabId] = useState('1')
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([
    { id: '1', title: 'GitHub', url: 'https://github.com' },
    { id: '2', title: 'Google', url: 'https://google.com' },
    { id: '3', title: 'Baidu', url: 'https://baidu.com' }
  ])

  const activeTab = tabs.find(tab => tab.id === activeTabId) || tabs[0]

  const createNewTab = () => {
    const newTab: Tab = {
      id: Date.now().toString(),
      title: '新分頁',
      url: '',
      history: [],
      historyIndex: -1
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) return // 至少保留一個分頁

    setTabs(prev => prev.filter(tab => tab.id !== tabId))
    if (activeTabId === tabId) {
      const remainingTabs = tabs.filter(tab => tab.id !== tabId)
      setActiveTabId(remainingTabs[0]?.id || '')
    }
  }

  const updateTab = (tabId: string, updates: Partial<Tab>) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, ...updates } : tab
    ))
  }

  const handleUrlChange = (url: string) => {
    updateTab(activeTabId, {
      url,
      title: url || '新分頁',
      history: [...activeTab.history.slice(0, activeTab.historyIndex + 1), url],
      historyIndex: activeTab.historyIndex + 1
    })
  }

  const handleNavigate = (url: string) => {
    handleUrlChange(url)
  }

  const handleGoBack = () => {
    if (activeTab.historyIndex > 0) {
      const newIndex = activeTab.historyIndex - 1
      const newUrl = activeTab.history[newIndex]
      updateTab(activeTabId, {
        url: newUrl,
        historyIndex: newIndex
      })
    }
  }

  const handleGoForward = () => {
    if (activeTab.historyIndex < activeTab.history.length - 1) {
      const newIndex = activeTab.historyIndex + 1
      const newUrl = activeTab.history[newIndex]
      updateTab(activeTabId, {
        url: newUrl,
        historyIndex: newIndex
      })
    }
  }

  const handleReload = () => {
    // 重新載入當前 URL
    const currentUrl = activeTab.url
    if (currentUrl) {
      handleUrlChange(currentUrl)
    }
  }

  const handleGoHome = () => {
    handleUrlChange('https://www.google.com')
  }

  const handleAddBookmark = (bookmark: Bookmark) => {
    setBookmarks(prev => [...prev, bookmark])
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 頂部工具列 */}
      <WebviewToolbar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={setActiveTabId}
        onNewTab={createNewTab}
        onCloseTab={closeTab}
        currentUrl={activeTab.url}
        onUrlChange={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onGoHome={handleGoHome}
        canGoBack={activeTab.historyIndex > 0}
        canGoForward={activeTab.historyIndex < activeTab.history.length - 1}
        bookmarks={bookmarks}
        onAddBookmark={handleAddBookmark}
      />

      {/* WebView 內容區域 */}
      <div className="flex-1 relative">
        <SimpleWebView
          url={activeTab.url}
        />
      </div>
    </div>
  )
}

export default dynamic(() => Promise.resolve(WebviewPage), { ssr: false })
