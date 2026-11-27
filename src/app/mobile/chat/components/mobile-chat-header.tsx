"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { History, MessageSquareDashed, MessageSquarePlus, Search, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import "dayjs/locale/zh-cn"
import "dayjs/locale/en"
import "dayjs/locale/ja"
import "dayjs/locale/pt-br"
import "dayjs/locale/de"
import useChatStore from "@/stores/chat"
import useSettingStore from "@/stores/setting"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { MobileMeSheet } from "@/app/mobile/components/mobile-me-sheet"

const SearchDialog = dynamic(
  () => import('@/components/search-dialog').then(module => module.SearchDialog),
  { ssr: false },
)

dayjs.extend(relativeTime)

function formatRelativeTime(timestamp: number, locale: string): string {
  let dayjsLocale = 'en'
  if (locale === '简体中文' || locale === 'zh') dayjsLocale = 'zh-cn'
  else if (locale === '日本語' || locale === 'ja') dayjsLocale = 'ja'
  else if (locale === 'Português' || locale === 'pt-BR') dayjsLocale = 'pt-br'
  else if (locale === 'Deutsch' || locale === 'de') dayjsLocale = 'de'
  return dayjs(timestamp).locale(dayjsLocale).fromNow()
}

export function MobileChatHeader() {
  const {
    startNewConversation,
    startTemporaryConversation,
    conversations,
    currentConversationId,
    isTemporaryConversation,
    switchConversation,
    deleteConversation,
    chats,
    loading,
  } = useChatStore()
  const { language } = useSettingStore()
  const tEmpty = useTranslations("record.chat.empty")
  const tInput = useTranslations("record.chat.input")
  const tSearch = useTranslations("search")

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const hasCurrentMessages = isTemporaryConversation
    ? chats.length > 0
    : conversations.some(
      (conversation) =>
        conversation.id === currentConversationId && conversation.messageCount > 0
    )
  const disableNewChat = (!hasCurrentMessages && !isTemporaryConversation) || loading

  const filteredConversations = useMemo(() => {
    return conversations
      .filter((conversation) => conversation.messageCount > 0)
      .filter((conversation) =>
        conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return b.updatedAt - a.updatedAt
      })
  }, [conversations, searchQuery])

  return (
    <>
      <header className="mobile-page-header w-full border-b px-2 flex items-center gap-2 bg-background">
        <MobileMeSheet />

        <div className="ml-auto flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            aria-label={tSearch("placeholder")}
            onClick={() => setSearchOpen(true)}
          >
            <Search />
          </Button>

          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={tEmpty("conversationHistory")}>
                <History className="size-4" />
              </Button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[85vh]">
              <DrawerHeader className="pb-2">
                <DrawerTitle>{tEmpty("conversationHistory")}</DrawerTitle>
              </DrawerHeader>
              <div className="px-4 pb-4">
                <div className="relative mb-3">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={tEmpty("searchPlaceholder")}
                    className="pl-8"
                  />
                </div>
                <div className="max-h-[56vh] overflow-y-auto">
                  {filteredConversations.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center">
                      {searchQuery
                        ? tEmpty("noMatchingConversations")
                        : tEmpty("noConversationHistory")}
                    </div>
                  ) : (
                    filteredConversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        className="mb-2 flex min-h-11 w-full items-stretch rounded-lg border transition-colors focus-within:bg-accent active:bg-accent"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 p-3 text-left"
                          onClick={() => {
                            switchConversation(conversation.id)
                            setDrawerOpen(false)
                          }}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{conversation.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatRelativeTime(conversation.updatedAt, language)}
                            </p>
                          </div>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="my-auto shrink-0 text-muted-foreground active:text-destructive"
                          onClick={() => deleteConversation(conversation.id)}
                          aria-label={tEmpty("deleteConversation")}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </DrawerContent>
          </Drawer>

          <Button
            variant={isTemporaryConversation ? "secondary" : "ghost"}
            size="icon"
            aria-label={tInput("temporaryChat")}
            onClick={startTemporaryConversation}
            disabled={loading || isTemporaryConversation}
          >
            <MessageSquareDashed />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label={tInput("newChat")}
            onClick={() => startNewConversation()}
            disabled={disableNewChat}
          >
            <MessageSquarePlus className="size-4" />
          </Button>

        </div>
      </header>
      {searchOpen ? <SearchDialog open mobile onOpenChange={setSearchOpen} /> : null}
    </>
  )
}
