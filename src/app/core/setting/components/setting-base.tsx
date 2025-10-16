export function SettingType(
  {id, title, icon, desc, children}:
  { id: string, title: string, icon?: React.ReactNode, desc?: string, children?: React.ReactNode}
) {
  return <div id={id} className="flex flex-col space-y-4">
    <div className="mb-4">
      <h2 className="text-xl w-full font-bold flex items-center gap-2 mb-2">
        {icon}
        {title}
      </h2>
      {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
    </div>
    {children}
  </div>
}

export function FormItem({title, desc, children}: { title: string, desc?: string, children: React.ReactNode}) {
  return <div className="flex flex-col w-full">
    <div className="text-sm mb-2 font-bold">{title}</div>
    {children}
    {desc && <p className="text-sm text-muted-foreground mt-2">{desc}</p>}
  </div>
}