'use client'
import { ImageUp, Search, Settings, SquarePen, X } from "lucide-react"
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
import { usePathname, useRouter } from 'next/navigation'
import AppStatus from "./app-status"
import { Store } from "@tauri-apps/plugin-store"
import { PinToggle } from "./pin-toggle"
import { useTranslations } from 'next-intl'
import { useEffect, useState } from "react"
import useImageStore from "@/stores/imageHosting"
 
interface AppSidebarProps {
  onSearchClick?: () => void
}

export function AppSidebar({ onSearchClick }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations()
  const { imageRepoUserInfo } = useImageStore()
  const [items, setItems] = useState([
    {
      title: t('navigation.write'),
      url: "/core/main",
      icon: SquarePen,
      isActive: true,
    },
    {
      title: t('navigation.search'),
      url: "/core/search",
      icon: Search,
    },
  ])

  async function initGithubImageHosting() {
    const store = await Store.load('store.json')
    const githubImageUsername = await store.get<string>('githubImageUsername')
    const githubImageAccessToken = await store.get<string>('githubImageAccessToken')
    if (githubImageUsername && githubImageAccessToken && !items.find(item => item.url === '/core/image')) {
      setItems([...items, {
        title: t('navigation.githubImageHosting'),
        url: "/core/image",
        icon: ImageUp,
      }])
    }
  }

  async function menuHandler(item: typeof items[0]) {
    // 如果是搜索按钮，打开搜索对话框
    if (item.url === '/core/search') {
      onSearchClick?.()
      return
    }

    // 直接跳转到对应页面
    router.push(item.url)
    const store = await Store.load('store.json')
    store.set('currentPage', item.url)
  }

  useEffect(() => {
    initGithubImageHosting()
  }, [imageRepoUserInfo])

  return (
    <Sidebar 
      collapsible="none"
      className="!w-[calc(var(--sidebar-width-icon)_+_1px)] border-r h-[calc(100vh-36px)] mt-9"
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
                    <div className="cursor-pointer" onClick={() => menuHandler(item)}>
                      <item.icon />
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <PinToggle />
        <SidebarMenuButton 
          isActive={pathname.includes('/core/setting')} 
          className="md:h-8 md:p-0"
          tooltip={{
            children: pathname.includes('/core/setting') ? t('common.back') : t('common.settings'),
            hidden: false,
          }}
          onClick={() => {
            if (pathname.includes('/core/setting')) {
              router.push('/core/main')
            } else {
              router.push('/core/setting')
            }
          }}
        >
          <div className="flex size-8 items-center justify-center rounded-lg">
            {pathname.includes('/core/setting') ? (
              <X className="size-4" />
            ) : (
              <Settings className="size-4" />
            )}
          </div>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  )
}