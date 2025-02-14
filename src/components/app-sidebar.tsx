'use client'

import { ImageUp, Search, Settings, Highlighter, SquarePen } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { usePathname } from 'next/navigation'
import { ModeToggle } from "./mode-toggle"
import Link from "next/link"
import AppStatus from "./app-status"
import { Store } from "@tauri-apps/plugin-store"
import { _t } from '@/locales/index'
 
// Menu items.
const items = [
  {
    title: _t('record'),
    url: "/core/record",
    icon: Highlighter,
    isActive: true,
  },
  {
    title: _t('article'),
    url: "/core/article",
    icon: SquarePen,
  },
  // {
  //   title: "绘图",
  //   url: "#",
  //   icon: PencilRuler,
  // },
  {
    title: _t('search'),
    url: "/core/search",
    icon: Search,
  },
  {
    title: _t('image'),
    url: "/core/image",
    icon: ImageUp,
  },
]
 
export function AppSidebar() {
  const pathname = usePathname()
  async function menuHandler(item: typeof items[0]) {
    const store = await Store.load('store.json')
    store.set('currentPage', item.url)
  }

  return (
    <Sidebar 
      collapsible="none"
      className="!w-[calc(var(--sidebar-width-icon)_+_1px)] border-r h-screen"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <AppStatus />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    disabled={item.url === '#'}
                    isActive={pathname === item.url}
                    tooltip={{
                      children: item.title,
                      hidden: false,
                    }}
                  >
                    <Link href={item.url} onClick={() => menuHandler(item)}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <ModeToggle />
        <SidebarMenuButton isActive={pathname === '/core/setting'} asChild className="md:h-8 md:p-0"
          tooltip={{
            children: _t("settings"),
            hidden: false,
          }}
        >
          <Link href="/core/setting">
            <div className="flex size-8 items-center justify-center rounded-lg">
              <Settings className="size-4" />
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  )
}
