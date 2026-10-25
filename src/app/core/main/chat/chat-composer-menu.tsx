"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  FileText,
  Folder,
  Languages,
  ListTree,
  Package,
  Palette,
  Search,
  FilePlus2,
  WandSparkles,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { getMarkListItemContent } from "@/app/core/main/mark/mark-list-item-content"
import {
  getMarkTypeIconClasses,
  MARK_TYPE_ICONS,
} from "@/app/core/main/mark/mark-type-meta"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { useSettingsDialogStore } from "@/stores/settings-dialog"
import { getAllMarks, type Mark } from "@/db/marks"
import { getAllMarkdownFiles, type MarkdownFile } from "@/lib/files"
import { cn } from "@/lib/utils"
import { getDefaultArticleAbsolutePath, getWorkspacePath } from "@/lib/workspace"
import useCanvasStore from "@/stores/canvas"
import { useSkillsStore } from "@/stores/skills"
import type { CanvasProject } from "@/types/canvas"
import type { SkillMetadata } from "@/lib/skills/types"

export type ComposerMenuMode = "command" | "resource" | "skill"

export interface ChatComposerMenuHandle {
  moveSelection: (direction: -1 | 1) => void
  selectCurrent: () => void
}

interface ChatComposerMenuProps {
  mode: ComposerMenuMode | null
  query: string
  excludedItemKeys: ReadonlySet<string>
  onClose: () => void
  onCommandSelect: (prompt: string) => void
  onFileSelect: (file: MarkdownFile) => void
  onFolderSelect: (relativePath: string) => void
  onRecordSelect: (mark: Mark) => void
  onCanvasSelect: (project: CanvasProject) => void
  onSkillSelect: (skill: SkillMetadata) => void
}

interface ComposerMenuItem {
  key: string
  group: string
  label: string
  description: string
  searchText?: string
  icon: LucideIcon
  iconClassName?: string
  meta?: string
  onSelect: () => void
}

const COMMANDS = [
  { key: "summarize", icon: ListTree },
  { key: "organize", icon: WandSparkles },
  { key: "rewrite", icon: WandSparkles },
  { key: "translate", icon: Languages },
  { key: "searchNotes", icon: Search },
  { key: "createNote", icon: FilePlus2 },
] as const

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[\\/._-]+/g, " ")
    .trim()
}

export const ChatComposerMenu = forwardRef<
  ChatComposerMenuHandle,
  ChatComposerMenuProps
>(function ChatComposerMenu({
  mode,
  query,
  excludedItemKeys,
  onClose,
  onCommandSelect,
  onFileSelect,
  onFolderSelect,
  onRecordSelect,
  onCanvasSelect,
  onSkillSelect,
}, ref) {
  const t = useTranslations("record.chat.input.composerMenu")
  const projects = useCanvasStore(state => state.projects)
  const loadProjects = useCanvasStore(state => state.loadProjects)
  const skillsEnabled = useSkillsStore(state => state.enabled)
  const skills = useSkillsStore(state => state.skills)
  const skillsInitialized = useSkillsStore(state => state.initialized)
  const initSkills = useSkillsStore(state => state.initSkills)
  const refreshSkills = useSkillsStore(state => state.refreshSkills)
  const [workspaceRoot, setWorkspaceRoot] = useState("")
  const [files, setFiles] = useState<MarkdownFile[]>([])
  const [records, setRecords] = useState<Mark[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedItemRef = useRef<HTMLButtonElement>(null)

  const folders = useMemo(() => {
    const paths = new Set<string>()
    for (const file of files) {
      const segments = file.relativePath.replace(/\\/g, "/").split("/")
      for (let depth = 1; depth < segments.length; depth += 1) {
        paths.add(segments.slice(0, depth).join("/"))
      }
    }
    return [...paths].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    )
  }, [files])

  useEffect(() => {
    if (mode !== "resource") return

    let active = true
    setLoading(true)

    const fileTask = Promise.all([
      getAllMarkdownFiles(),
      getWorkspacePath().then(workspace => workspace.isCustom
        ? workspace.path : getDefaultArticleAbsolutePath('')),
    ]).then(([nextFiles, root]) => {
      if (!active) return
      setWorkspaceRoot(root)
      setFiles([...nextFiles].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true })
      ))
    })
    const recordTask = getAllMarks().then(nextRecords => {
      if (!active) return
      setRecords(nextRecords.filter(record => record.deleted === 0).slice(0, 200))
    })
    const canvasTask = projects.length === 0 ? loadProjects() : Promise.resolve()

    void Promise.allSettled([fileTask, recordTask, canvasTask]).then(() => {
      if (active) setLoading(false)
    })

    return () => {
      active = false
    }
  }, [loadProjects, mode, projects.length])

  useEffect(() => {
    if (mode !== "command" && mode !== "skill") return

    let active = true
    setLoading(true)
    void (skillsInitialized ? refreshSkills() : initSkills()).catch(error => {
      console.error('Failed to load composer skills:', error)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [initSkills, mode, refreshSkills, skillsInitialized])

  const items = useMemo<ComposerMenuItem[]>(() => {
    if (mode === "command" || mode === "skill") {
      return [
        ...(mode === "command" ? COMMANDS : []).map(({ key, icon }) => ({
          key: `command:${key}`,
          group: t("commands.title"),
          label: t(`commands.${key}.label`),
          description: t(`commands.${key}.description`),
          icon,
          onSelect: () => onCommandSelect(t(`commands.${key}.prompt`)),
        })),
        ...(skillsEnabled ? skills : [])
          .filter(skill => skill.enabled !== false && skill.userInvocable !== false)
          .map(skill => ({
            key: `skill:${skill.id}`,
            group: t("skills.title"),
            label: skill.name,
            description: skill.description,
            icon: Package,
            meta: t(`skills.scope.${skill.scope}`),
            onSelect: () => onSkillSelect(skill),
          })),
      ]
    }

    if (mode !== "resource") return []

    return [
      ...folders.map(relativePath => ({
        key: `folder:${relativePath}`,
        group: t("resources.folders"),
        label: relativePath.split("/").pop() || relativePath,
        description: relativePath,
        searchText: relativePath,
        icon: Folder,
        onSelect: () => onFolderSelect(relativePath),
      })),
      ...files.map(file => ({
        key: `file:${file.path}`,
        group: t("resources.files"),
        label: file.name,
        description: "",
        searchText: file.relativePath,
        icon: FileText,
        onSelect: () => onFileSelect(file),
      })),
      ...records.map(record => {
        const content = getMarkListItemContent(record)
        return {
          key: `record:${record.id}`,
          group: t("resources.records"),
          label: content.title || t("resources.untitledRecord"),
          description: content.preview || t("resources.recordFallback"),
          icon: MARK_TYPE_ICONS[record.type],
          iconClassName: getMarkTypeIconClasses(record.type),
          onSelect: () => onRecordSelect(record),
        }
      }),
      ...projects.map(project => ({
        key: `canvas:${project.id}`,
        group: t("resources.canvases"),
        label: project.title,
        description: t("resources.canvasSummary", {
          nodes: project.document.nodes.length,
          edges: project.document.edges.length,
        }),
        icon: Palette,
        onSelect: () => onCanvasSelect(project),
      })),
    ]
  }, [
    files,
    folders,
    mode,
    onCanvasSelect,
    onCommandSelect,
    onFileSelect,
    onFolderSelect,
    onRecordSelect,
    onSkillSelect,
    projects,
    records,
    skills,
    skillsEnabled,
    t,
  ])

  // 工作区引用可能是相对路径，本地附件则是绝对路径，统一后再去重。
  const availableItems = useMemo(() => {
    function normalizeItemKey(key: string) {
      if (!key.startsWith('file:') && !key.startsWith('folder:')) return key
      const separator = key.indexOf(':')
      const kind = key.slice(0, separator)
      let path = key.slice(separator + 1).replace(/\\/g, '/').replace(/\/+$/, '')
      if (workspaceRoot && !path.startsWith('/') && !/^[a-z]:\//i.test(path)) {
        path = `${workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`
      }
      return `${kind}:${path}`
    }
    const excluded = new Set([...excludedItemKeys].map(normalizeItemKey))
    return items.filter(item => !excluded.has(normalizeItemKey(item.key)))
  }, [excludedItemKeys, items, workspaceRoot])

  const filteredItems = useMemo(() => {
    const queryTerms = normalizeSearchText(query).split(/\s+/).filter(Boolean)
    if (queryTerms.length === 0) return availableItems

    return availableItems.filter(item => {
      const searchableText = normalizeSearchText(
        `${item.label} ${item.description} ${item.searchText || ""}`
      )
      return queryTerms.every(term => searchableText.includes(term))
    })
  }, [availableItems, query])

  const groups = useMemo(
    () => Array.from(new Set(filteredItems.map(item => item.group))),
    [filteredItems]
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [mode, query, excludedItemKeys])

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [query, selectedIndex])

  function selectItem(item: ComposerMenuItem) {
    item.onSelect()
    onClose()
  }

  useImperativeHandle(ref, () => ({
    moveSelection(direction) {
      if (filteredItems.length === 0) return
      setSelectedIndex(current =>
        (current + direction + filteredItems.length) % filteredItems.length
      )
    },
    selectCurrent() {
      const item = filteredItems[selectedIndex]
      if (item) selectItem(item)
    },
  }), [filteredItems, onClose, selectedIndex])

  if (mode === null) return null

  return (
    <div
      className="absolute inset-x-1 bottom-[calc(100%+0.375rem)] z-30 max-h-[min(22rem,46vh)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
      role="listbox"
      aria-label={mode === "resource" ? t("resources.title") : mode === "skill" ? t("skills.title") : t("commands.title")}
    >
      {loading && filteredItems.length === 0 ? (
        <div role="status" className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-muted-foreground">
          <Spinner className="size-4" />
          {t("loading")}
        </div>
      ) : filteredItems.length === 0 ? (
        <Empty className="gap-3 py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">{mode === "skill" ? <Package /> : <Search />}</EmptyMedia>
            <EmptyTitle>{availableItems.length === 0 && items.length > 0
              ? t("allAdded")
              : mode === "skill" && items.length === 0 ? t("skills.unavailable") : t("empty")}</EmptyTitle>
            {mode === "skill" && items.length === 0 && (
              <EmptyDescription>{t(skillsEnabled ? "skills.emptyDescription" : "skills.disabledDescription")}</EmptyDescription>
            )}
          </EmptyHeader>
          {mode === "skill" && items.length === 0 && (
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  onClose()
                  requestAnimationFrame(() => useSettingsDialogStore.getState().openSettings('skills'))
                }}
              >
                {t("skills.manage")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col gap-0.5">
          {groups.map(group => (
            <div key={group} className="flex flex-col">
              <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                {group}
              </div>
              {filteredItems.map((item, index) => {
                if (item.group !== group) return null
                const Icon = item.icon
                const selected = selectedIndex === index

                return (
                  <Button
                    key={item.key}
                    ref={selected ? selectedItemRef : undefined}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-auto min-h-10 w-full justify-start gap-3 rounded-lg px-2 py-2",
                      selected && "bg-muted"
                    )}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => selectItem(item)}
                  >
                    <Icon
                      data-icon="inline-start"
                      className={item.iconClassName}
                    />
                    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                      <span className="w-full truncate text-xs font-medium">
                        {item.label}
                      </span>
                      {item.description ? (
                        <span className="line-clamp-2 w-full whitespace-normal text-xs font-normal text-muted-foreground">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.meta ? (
                      <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">
                        {item.meta}
                      </span>
                    ) : null}
                  </Button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

ChatComposerMenu.displayName = "ChatComposerMenu"
