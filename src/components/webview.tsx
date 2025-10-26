'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { X, ArrowLeft, ArrowRight, RotateCcw, ExternalLink } from 'lucide-react'

interface WebViewProps {
  url?: string
  onClose?: () => void
  title?: string
  onUrlChange?: (url: string) => void
  onInputChange?: (url: string) => void
}

export function WebView({ url: initialUrl = '', onClose, title = '瀏覽器', onUrlChange, onInputChange }: WebViewProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [inputUrl, setInputUrl] = useState(initialUrl)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  // 同步外部 URL 變化
  useEffect(() => {
    setCurrentUrl(initialUrl)
    setInputUrl(initialUrl)
  }, [initialUrl])

  const handleNavigate = () => {
    if (inputUrl) {
      // 確保 URL 有協議前綴
      let targetUrl = inputUrl
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl
      }
      setCurrentUrl(targetUrl)
      setInputUrl(targetUrl)
      onUrlChange?.(targetUrl)
      onInputChange?.(targetUrl)
    }
  }

  const handleBack = () => {
    // 這裡可以實現後退功能
    setCanGoBack(false)
  }

  const handleForward = () => {
    // 這裡可以實現前進功能
    setCanGoForward(false)
  }

  const handleReload = () => {
    // 重新載入頁面
    const iframe = document.getElementById('webview-iframe') as HTMLIFrameElement
    if (iframe) {
      iframe.src = iframe.src
    }
  }

  const handleExternalOpen = () => {
    if (currentUrl) {
      window.open(currentUrl, '_blank')
    }
  }

  return (
    <Card className="w-full h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* 網址欄和導航按鈕 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleBack}
              disabled={!canGoBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleForward}
              disabled={!canGoForward}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReload}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex-1 flex items-center gap-2">
            <Input
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleNavigate()}
              placeholder="輸入網址..."
              className="flex-1"
            />
            <Button size="sm" onClick={handleNavigate}>
              前往
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExternalOpen}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0">
        {currentUrl ? (
          <iframe
            id="webview-iframe"
            src={currentUrl}
            className="w-full h-full border-0"
            title="WebView"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            allowFullScreen
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            請輸入網址開始瀏覽
          </div>
        )}
      </CardContent>
    </Card>
  )
}