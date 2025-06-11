'use client'
import { Toaster } from "@/components/ui/toaster"
import "./globals.scss";
import 'md-editor-rt/lib/style.css';
import 'md-editor-rt/lib/preview.css';
import 'react-photo-view/dist/react-photo-view.css';
import { Suspense } from "react";
import { NextIntlProvider } from "@/components/providers/NextIntlProvider";
import Script from "next/script";
import { Store } from '@tauri-apps/plugin-store'
import { redirect } from 'next/navigation'
import { useEffect } from 'react'
import { isMobileDevice } from '@/lib/check'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  async function init() {
    const store = await Store.load('store.json')
    const currentPage = await store.get<string>('currentPage')
    if (isMobileDevice()) {
      redirect('/mobile/chat')
    } else {
      redirect(currentPage || '/core/record')
    }
  }
  useEffect(() => {
    init()
  }, [])

  return (
    <>
      <html lang="en" suppressHydrationWarning>
        <head>
          {/* 移动端视口设置 */}
          <meta 
            name="viewport" 
            content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0, height=device-height"
          />
          {/* Define isSpace function globally to fix markdown-it issues with Next.js + Turbopack
          https://github.com/markdown-it/markdown-it/issues/1082#issuecomment-2749656365 */}
          <Script id="markdown-it-fix" strategy="beforeInteractive">
            {`
              if (typeof window !== 'undefined' && typeof window.isSpace === 'undefined') {
                window.isSpace = function(code) {
                  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0B || code === 0x0C || code === 0x0D;
                };
              }
            `}
          </Script>
        </head>
        <body suppressHydrationWarning>
          <Suspense>
            <NextIntlProvider>
              {children}
            </NextIntlProvider>
          </Suspense>
          <Toaster />
        </body>
      </html>
    </>
  );
}
