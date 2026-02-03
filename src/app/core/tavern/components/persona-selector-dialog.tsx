'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { User, Star, Link2 } from 'lucide-react'
import { TavernPersona } from '@/db/tavern'
import { convertFileSrc } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { parsePersonaConnections } from '@/lib/tavern/persona-types'

interface PersonaSelectorDialogProps {
  /** 是否打开 */
  open: boolean
  /** 关闭回调 */
  onOpenChange: (open: boolean) => void
  /** 可选的 Persona 列表 */
  personas: TavernPersona[]
  /** 当前角色卡 ID */
  cardId: number
  /** 当前角色卡名称 */
  cardName: string
  /** 选择回调 */
  onSelect: (persona: TavernPersona) => void
  /** 取消时使用默认 */
  defaultPersona?: TavernPersona | null
}

/**
 * Persona 选择器对话框
 * 当多个 Persona 绑定到同一角色时显示，让用户选择使用哪个
 */
export function PersonaSelectorDialog({
  open,
  onOpenChange,
  personas,
  cardId,
  cardName,
  onSelect,
  defaultPersona,
}: PersonaSelectorDialogProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const handleConfirm = () => {
    const persona = personas.find(p => p.id === selectedId)
    if (persona) {
      onSelect(persona)
      onOpenChange(false)
    }
  }

  const handleUseDefault = () => {
    if (defaultPersona) {
      onSelect(defaultPersona)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>选择 Persona</DialogTitle>
          <DialogDescription>
            多个 Persona 已绑定到 <strong>{cardName}</strong>，请选择要使用的身份
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[300px] mt-2">
          <div className="space-y-2 pr-4">
            {personas.map((persona) => {
              const connections = parsePersonaConnections(persona.connections || '[]')
              const isBoundToCard = connections.some(
                c => c.type === 'character' && c.id === cardId
              )

              return (
                <button
                  key={persona.id}
                  onClick={() => setSelectedId(persona.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors border-2',
                    'hover:bg-accent/50',
                    selectedId === persona.id
                      ? 'border-primary bg-accent'
                      : 'border-transparent'
                  )}
                >
                  <Avatar className="h-10 w-10">
                    {persona.avatarPath ? (
                      <AvatarImage src={convertFileSrc(persona.avatarPath)} />
                    ) : null}
                    <AvatarFallback>
                      <User className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate">{persona.name}</span>
                      {persona.isDefault && (
                        <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                      )}
                      {isBoundToCard && (
                        <Link2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {persona.description || '暂无描述'}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 mt-4">
          {defaultPersona && (
            <Button variant="outline" onClick={handleUseDefault}>
              使用默认
            </Button>
          )}
          <Button
            onClick={handleConfirm}
            disabled={selectedId === null}
          >
            确定
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
