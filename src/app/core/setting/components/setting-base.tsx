export function SettingType(
  {id, title, icon, desc, children}:
  { id: string, title: string, icon?: React.ReactNode, desc?: string, children?: React.ReactNode}
) {
  return <div id={id} className="flex flex-col">
    <div className="mb-10">
      <h2 className="text-xl w-full font-bold flex items-center gap-2 mb-2">
        {icon}
        {title}
      </h2>
      {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
    </div>
    {children}
  </div>
}
export function SettingRow({border = false, children, className}: { border?: boolean, children: React.ReactNode, className?: string}) {
  return <div className={`${border ? "border-b py-4" : ""} flex justify-between text-sm items-center ${className}`}>
    {children}
  </div>
}

export function FormItem({title, desc, children}: { title: string, desc?: string, children: React.ReactNode}) {
  return <div className="flex flex-col mb-8 w-full">
    <div className="text-sm mb-2 font-bold">{title}</div>
    {children}
    {desc && <p className="text-sm text-muted-foreground mt-2">{desc}</p>}
  </div>
}

export function SettingPanel({children, title, desc}: {children: React.ReactNode, title?: string, desc?: string}) {
  return <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm mb-8">
    <div>
      {title && <div className="text-sm mb-2 font-bold">{title}</div>}
      {desc && <p className="text-sm text-muted-foreground mt-2">{desc}</p>}
    </div>
    {children}
  </div>
}
  