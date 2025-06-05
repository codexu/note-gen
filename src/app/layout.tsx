'use client'
import { Toaster } from "@/components/ui/toaster"
import "./globals.scss";
import 'md-editor-rt/lib/style.css';
import 'md-editor-rt/lib/preview.css';
import 'react-photo-view/dist/react-photo-view.css';
import { Suspense } from "react";
import { NextIntlProvider } from "@/components/providers/NextIntlProvider";
import Script from "next/script";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <>
      <html lang="en" suppressHydrationWarning>
        <head>
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
