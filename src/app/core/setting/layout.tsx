'use client'

export default function SettingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div id="setting-page" className="flex h-full">
      <div className="flex-1 p-8 overflow-y-auto h-full">
        <div className="mx-auto w-full max-w-5xl">
          {children}
        </div>
      </div>
    </div>
  )
}
