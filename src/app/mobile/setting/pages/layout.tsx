'use client'

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter()
  return <div className="flex flex-col w-full h-screen overflow-y-auto pt-24 pb-40">
    <div className="fixed top-0 left-0 right-0 z-10 flex items-center p-2 border-b bg-background">
      <Button variant="ghost" size="icon" onClick={() => router.back()}>
        <ArrowLeft />
      </Button>
    </div>
    <div className="flex-1 w-full p-2">
      {children}
    </div>
  </div>
}