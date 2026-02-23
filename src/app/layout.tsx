'use client'
import { Toaster } from "@/components/ui/toaster"
import "./globals.css";
import 'react-photo-view/dist/react-photo-view.css';
import { Suspense, useEffect } from "react";
import { NextIntlProvider } from "@/components/providers/NextIntlProvider";
import Script from "next/script";
import { getSyncPushQueue } from "@/lib/sync/sync-push-queue";
import { ConsoleFilter } from "@/components/console-filter";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 初始化同步推送队列
  useEffect(() => {
    getSyncPushQueue()
  }, [])

  return (
    <>
      <html lang="en" suppressHydrationWarning>
        <head>
          {/* 移动端视口设置 */}
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover, height=device-height"
          />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
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
          <ConsoleFilter />
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
