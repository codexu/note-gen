'use client'

import { useEffect } from 'react'

interface SimpleWebViewProps {
  url?: string
}

export function SimpleWebView({ url }: SimpleWebViewProps) {
  useEffect(() => {
    // 當 URL 改變時，更新 iframe
    const iframe = document.getElementById('simple-webview-iframe') as HTMLIFrameElement
    if (iframe && url) {
      iframe.src = url
    }
  }, [url])

  return (
    <div className="w-full h-full">
      {url ? (
        <iframe
          id="simple-webview-iframe"
          src={url}
          className="w-full h-full border-0"
          title="Web Browser"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          allowFullScreen
        />
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          請輸入網址開始瀏覽
        </div>
      )}
    </div>
  )
}
