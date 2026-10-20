"use client"

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Check, GripVertical, MoreHorizontal, Pencil, Trash2, X, Zap } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import type { AgentPendingMessage } from "@/lib/agent/agent-session"
import { cn } from "@/lib/utils"
import type { AgentRequestSnapshot } from "./agent-session-context"
import { useChatAgentSession } from "./use-chat-agent-session"

interface QueuedMessageRowProps {
  message: AgentPendingMessage<AgentRequestSnapshot>
  editing: boolean
  editText: string
  onEditTextChange: (value: string) => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
  onSteer: () => void
}

function QueuedMessageRow({
  message,
  editing,
  editText,
  onEditTextChange,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onSteer,
}: QueuedMessageRowProps) {
  const t = useTranslations("record.chat.input.agent.deliveryMode")
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: message.id, disabled: editing })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex min-h-9 items-center gap-1 border-t border-border/60 px-1 py-1 first:border-t-0",
        isDragging && "relative opacity-60"
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        className="cursor-grab text-muted-foreground active:cursor-grabbing"
        aria-label={t("pending.reorder")}
        title={t("pending.reorder")}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>

      {editing ? (
        <Input
          autoFocus
          value={editText}
          className="h-7 min-w-0 flex-1"
          aria-label={t("pending.edit")}
          onChange={event => onEditTextChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault()
              onSaveEdit()
            } else if (event.key === "Escape") {
              event.preventDefault()
              onCancelEdit()
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate px-1 text-left text-sm text-foreground"
          title={message.request.requestText}
          onClick={onEdit}
        >
          {message.request.requestText}
        </button>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        {editing ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!editText.trim()}
              aria-label={t("pending.save")}
              title={t("pending.save")}
              onClick={onSaveEdit}
            >
              <Check />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("pending.cancel")}
              title={t("pending.cancel")}
              onClick={onCancelEdit}
            >
              <X />
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t("modes.steer.title")}
              title={t("modes.steer.description")}
              onClick={onSteer}
            >
              <Zap data-icon="inline-start" />
              <span className="hidden sm:inline">{t("modes.steer.title")}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("pending.remove")}
              title={t("pending.remove")}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("pending.more")}
                  title={t("pending.more")}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil />
                    {t("pending.edit")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  )
}

export function AgentPendingMessageList() {
  const { session } = useChatAgentSession()
  const [messages, setMessages] = useState<AgentPendingMessage<AgentRequestSnapshot>[]>(
    () => session.pendingMessages.filter(message => message.behavior === "followUp")
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    const refresh = () => {
      const queued = session.pendingMessages.filter(message => message.behavior === "followUp")
      setMessages(queued)
      if (editingId && !queued.some(message => message.id === editingId)) {
        setEditingId(null)
        setEditText("")
      }
    }

    refresh()
    return session.subscribe(event => {
      if (event.type === "queue_changed") refresh()
    })
  }, [editingId, session])

  if (messages.length === 0) return null

  const startEditing = (message: AgentPendingMessage<AgentRequestSnapshot>) => {
    setEditingId(message.id)
    setEditText(message.request.inputValue || message.request.requestText)
  }

  const saveEditing = (message: AgentPendingMessage<AgentRequestSnapshot>) => {
    const text = editText.trim()
    if (!text) return
    session.updatePendingRequest(message.id, {
      ...message.request,
      inputValue: text,
      requestText: text,
    })
    setEditingId(null)
    setEditText("")
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = messages.findIndex(message => message.id === active.id)
    const newIndex = messages.findIndex(message => message.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(messages, oldIndex, newIndex)
    setMessages(reordered)
    session.reorderFollowUps(reordered.map(message => message.id))
  }

  return (
    <div className="max-h-40 overflow-y-auto px-1 pt-1">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={messages.map(message => message.id)}
          strategy={verticalListSortingStrategy}
        >
          {messages.map(message => (
            <QueuedMessageRow
              key={message.id}
              message={message}
              editing={editingId === message.id}
              editText={editingId === message.id ? editText : ""}
              onEditTextChange={setEditText}
              onEdit={() => startEditing(message)}
              onCancelEdit={() => {
                setEditingId(null)
                setEditText("")
              }}
              onSaveEdit={() => saveEditing(message)}
              onDelete={() => session.removePendingMessage(message.id)}
              onSteer={() => session.steerPendingMessage(message.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}
