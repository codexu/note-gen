'use client'

// Fork（almanac ALMNC-9）：⌘K 命令面板。同一個輸入框搜尋筆記與指令（含外掛命令）。
// 外觀沿用 ui/command.tsx 在 v3 下的 Dialog 樣式（560px、距頂 16vh、輸入列 48px、清單 320px）；
// 搜尋合併與排序在 src/lib/anywhere/palette-search.ts（純函式、有單元測試），這裡只負責取資料與執行。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  FileText, Inbox, House, MessageSquarePlus, MessageCircleQuestion, Moon, PanelLeft, PanelRight, Search, Settings,
} from 'lucide-react'
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
} from '@/components/ui/command'
import { ShortcutKbd } from '@/components/fork/shortcut-kbd'
import { getPluginIcon } from '@/components/plugins/plugin-icon'
import {
  executePluginUserCommand, getPluginCommands, subscribePluginCommands, type RegisteredPluginCommand,
} from '@/lib/plugins/command-registry'
import { buildPaletteSections, noteTitleParts, type PaletteItem, type PaletteKind } from '@/lib/anywhere/palette-search'
import { useAnywhereStore } from '@/lib/anywhere/store'
import useVaultIndexStore from '@/stores/vault-index'
import useArticleStore from '@/stores/article'
import useChatStore from '@/stores/chat'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import { useSidebarStore } from '@/stores/sidebar'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

type CoreCommandId = 'ask' | 'newChat' | 'home' | 'inbox' | 'searchSidebar' | 'leftSidebar' | 'rightSidebar' | 'theme' | 'settings'

const CORE_COMMAND_ICONS: Record<CoreCommandId, typeof Search> = {
  ask: MessageCircleQuestion,
  newChat: MessageSquarePlus,
  home: House,
  inbox: Inbox,
  searchSidebar: Search,
  leftSidebar: PanelLeft,
  rightSidebar: PanelRight,
  theme: Moon,
  settings: Settings,
}
const CORE_COMMAND_SHORTCUT: Partial<Record<CoreCommandId, string>> = { ask: '⌘⇧A', home: '⌘⇧H' }
const CORE_COMMAND_ORDER: CoreCommandId[] = ['ask', 'newChat', 'home', 'inbox', 'searchSidebar', 'leftSidebar', 'rightSidebar', 'theme', 'settings']
const CORE_PREFIX = 'core:'
const PLUGIN_PREFIX = 'plugin:'
const NOTE_PREFIX = 'note:'

export function AnywhereCommandPalette() {
  const t = useTranslations('anywhere')
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const open = useAnywhereStore(state => state.paletteOpen)
  const setOpen = useAnywhereStore(state => state.setPaletteOpen)
  const notes = useVaultIndexStore(state => state.notes)
  const [query, setQuery] = useState('')
  const [pluginCommands, setPluginCommands] = useState<RegisteredPluginCommand[]>(() => getPluginCommands())

  useEffect(() => subscribePluginCommands(() => setPluginCommands(getPluginCommands())), [])
  useEffect(() => { if (open) setQuery('') }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const core: PaletteItem[] = CORE_COMMAND_ORDER.map(id => ({
      id: `${CORE_PREFIX}${id}`,
      kind: 'command',
      title: t(`commands.${id}.title`),
      keywords: t(`commands.${id}.keywords`).split(/[,，]/).map(word => word.trim()).filter(Boolean),
    }))
    const plugins: PaletteItem[] = pluginCommands.filter(command => !command.disabled).map(command => ({
      id: `${PLUGIN_PREFIX}${command.id}`,
      kind: 'plugin',
      title: command.title,
      subtitle: command.pluginName,
      keywords: [command.description ?? '', ...(command.keywords ?? [])].filter(Boolean),
    }))
    const noteItems: PaletteItem[] = []
    for (const note of notes.values()) {
      if (!note.path.toLowerCase().endsWith('.md')) continue
      const { title, folder } = noteTitleParts(note.path)
      noteItems.push({
        id: `${NOTE_PREFIX}${note.path}`,
        kind: 'note',
        title,
        subtitle: folder,
        keywords: [...note.aliases, ...note.tags],
        mtime: note.mtime,
      })
    }
    return [...core, ...plugins, ...noteItems]
  }, [notes, pluginCommands, t])

  const sections = useMemo(() => buildPaletteSections(items, query), [items, query])
  const byId = useMemo(() => new Map(pluginCommands.map(command => [`${PLUGIN_PREFIX}${command.id}`, command])), [pluginCommands])

  const runCore = useCallback(async (id: CoreCommandId) => {
    const sidebar = useSidebarStore.getState()
    switch (id) {
      case 'ask': useAnywhereStore.getState().setChatOpen(true); break
      case 'newChat':
        await useChatStore.getState().startNewConversation()
        useAnywhereStore.getState().setChatOpen(true)
        break
      case 'home': useHomeStore.getState().show(); break
      case 'inbox': useInboxStore.getState().show(); break
      case 'searchSidebar': await sidebar.requestSidebarSearchFocus(); break
      case 'leftSidebar': await sidebar.toggleLeftSidebar(); break
      case 'rightSidebar': await sidebar.toggleRightSidebar(); break
      case 'theme': setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); break
      case 'settings': useSettingsDialogStore.getState().openSettings(); break
    }
  }, [resolvedTheme, setTheme])

  const openNote = useCallback(async (path: string) => {
    const sidebar = useSidebarStore.getState()
    await sidebar.showCenterPanel()
    router.push('/core/main')
    const article = useArticleStore.getState()
    await article.setActiveFilePath(path, true, { tabOpenMode: 'preview' })
    if (useArticleStore.getState().activeFilePath === path) article.setPendingFileRevealPath(path)
  }, [router])

  const run = useCallback(async (item: PaletteItem) => {
    setOpen(false)
    try {
      if (item.id.startsWith(CORE_PREFIX)) await runCore(item.id.slice(CORE_PREFIX.length) as CoreCommandId)
      else if (item.id.startsWith(PLUGIN_PREFIX)) await executePluginUserCommand(item.id.slice(PLUGIN_PREFIX.length))
      else if (item.id.startsWith(NOTE_PREFIX)) await openNote(item.id.slice(NOTE_PREFIX.length))
    } catch (error) {
      toast.error(item.title, { description: error instanceof Error ? error.message : String(error) })
    }
  }, [openNote, runCore, setOpen])

  const heading = (kind: PaletteKind) => t(`palette.group.${kind}`)

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t('palette.title')} description={t('palette.description')}>
      <Command shouldFilter={false} loop>
        <CommandInput value={query} onValueChange={setQuery} placeholder={t('palette.placeholder')} />
        <CommandList>
          {sections.length === 0 ? <CommandEmpty>{t('palette.empty')}</CommandEmpty> : null}
          {sections.map(section => (
            <CommandGroup key={section.kind} heading={heading(section.kind)}>
              {section.items.map(item => {
                const coreId = item.id.startsWith(CORE_PREFIX) ? item.id.slice(CORE_PREFIX.length) as CoreCommandId : null
                const pluginCommand = byId.get(item.id)
                const Icon = coreId ? CORE_COMMAND_ICONS[coreId] : pluginCommand ? getPluginIcon(pluginCommand.icon) : FileText
                const shortcut = coreId ? CORE_COMMAND_SHORTCUT[coreId] : undefined
                return (
                  <CommandItem key={item.id} value={item.id} onSelect={() => void run(item)}>
                    <Icon aria-hidden className="text-muted-ink" />
                    <span className="min-w-0 truncate">{item.title}</span>
                    {item.subtitle ? <span className="min-w-0 truncate text-xs text-faint">{item.subtitle}</span> : null}
                    {shortcut ? <CommandShortcut><ShortcutKbd shortcut={shortcut} /></CommandShortcut> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
