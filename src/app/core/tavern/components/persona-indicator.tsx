'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { User, Star, Lock, Link2, Unlock, ChevronDown } from 'lucide-react'
import {
  TavernPersona,
  TavernCard,
  TavernChat,
  getPersonas,
} from '@/db/tavern'
import { convertFileSrc } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import {
  parsePersonaConnections,
  type PersonaState,
} from '@/lib/tavern/persona-types'
import {
  getPersonaLockState,
  togglePersonaLock,
  togglePersonaCharacterBinding,
  resolvePersonaForChat,
  getConnectedPersonas,
} from '@/lib/tavern/persona-lock'
import { useToast } from '@/hooks/use-toast'
import { shouldShowPersonaNotification, shouldAutoLock } from '@/stores/tavern-persona-settings'

interface PersonaIndicatorProps {
  /** 当前 Persona */
  persona: TavernPersona
  /** 当前角色卡 */
  card: TavernCard
  /** 当前聊天 */
  chat: TavernChat | null
  /** Persona 变更回调 */
  onPersonaChange?: (persona: TavernPersona) => void
  /** 是否紧凑模式 */
  compact?: boolean
}

export function PersonaIndicator({
  persona,
  card,
  chat,
  onPersonaChange,
  compact = false,
}: PersonaIndicatorProps) {
  const { toast } = useToast()
  const [personas, setPersonas] = useState<TavernPersona[]>([])
  const [personaState, setPersonaState] = useState<PersonaState | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 加载 Persona 列表
  useEffect(() => {
    loadPersonas()
  }, [])

  // 加载 Persona 状态
  useEffect(() => {
    if (chat && persona) {
      loadPersonaState()
    }
  }, [chat?.id, persona?.id, card?.id])

  const loadPersonas = async () => {
    const data = await getPersonas()
    setPersonas(data)
  }

  const loadPersonaState = async () => {
    if (!chat || !persona) return
    const state = await getPersonaLockState(
      chat.id,
      persona.id,
      persona.isDefault,
      card?.id
    )
    setPersonaState(state)
  }

  // 切换聊天锁定
  const handleToggleChatLock = async () => {
    if (!chat || !persona) return
    setIsLoading(true)
    try {
      const isLocked = await togglePersonaLock(chat.id, persona.id)
      await loadPersonaState()
      if (shouldShowPersonaNotification()) {
        toast({
          title: isLocked ? '已锁定到聊天' : '已解除聊天锁定',
          description: isLocked
            ? `${persona.name} 已锁定到当前聊天`
            : `${persona.name} 不再锁定到当前聊天`,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  // 切换角色绑定
  const handleToggleCharacterBinding = async () => {
    if (!card || !persona) return
    setIsLoading(true)
    try {
      const isBound = await togglePersonaCharacterBinding(persona.id, card.id)
      await loadPersonaState()
      if (shouldShowPersonaNotification()) {
        toast({
          title: isBound ? '已绑定到角色' : '已解除角色绑定',
          description: isBound
            ? `${persona.name} 已绑定到 ${card.name}`
            : `${persona.name} 不再绑定到 ${card.name}`,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  // 切换 Persona
  const handleSelectPersona = async (newPersona: TavernPersona) => {
    if (newPersona.id === persona.id) return
    onPersonaChange?.(newPersona)
    
    // 自动锁定到聊天
    if (shouldAutoLock() && chat) {
      await togglePersonaLock(chat.id, newPersona.id)
      await loadPersonaState()
    }
    
    if (shouldShowPersonaNotification()) {
      toast({
        title: '已切换 Persona',
        description: shouldAutoLock() && chat
          ? `现在使用 ${newPersona.name}（已自动锁定）`
          : `现在使用 ${newPersona.name}`,
      })
    }
  }

  // 获取状态图标
  const renderStatusIcons = () => {
    if (!personaState) return null

    return (
      <TooltipProvider>
        <div className="flex items-center gap-0.5">
          {personaState.isDefault && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
              </TooltipTrigger>
              <TooltipContent>默认 Persona</TooltipContent>
            </Tooltip>
          )}
          {personaState.locked.chat && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="h-3 w-3 text-blue-500" />
              </TooltipTrigger>
              <TooltipContent>已锁定到当前聊天</TooltipContent>
            </Tooltip>
          )}
          {personaState.locked.character && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link2 className="h-3 w-3 text-green-500" />
              </TooltipTrigger>
              <TooltipContent>已绑定到 {card.name}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    )
  }

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
            <Avatar className="h-5 w-5">
              {persona.avatarPath ? (
                <AvatarImage src={convertFileSrc(persona.avatarPath)} />
              ) : null}
              <AvatarFallback className="text-[10px]">
                <User className="h-3 w-3" />
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium max-w-[80px] truncate">
              {persona.name}
            </span>
            {renderStatusIcons()}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            当前: {persona.name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {/* 锁定操作 */}
          <DropdownMenuItem
            onClick={handleToggleChatLock}
            disabled={isLoading || !chat}
          >
            {personaState?.locked.chat ? (
              <>
                <Unlock className="h-4 w-4 mr-2" />
                解除聊天锁定
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 mr-2" />
                锁定到当前聊天
              </>
            )}
          </DropdownMenuItem>
          
          <DropdownMenuItem
            onClick={handleToggleCharacterBinding}
            disabled={isLoading || !card}
          >
            {personaState?.locked.character ? (
              <>
                <Link2 className="h-4 w-4 mr-2 text-green-500" />
                解除角色绑定
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                绑定到 {card.name}
              </>
            )}
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            切换 Persona
          </DropdownMenuLabel>
          
          {personas.map((p) => {
            const connections = parsePersonaConnections(p.connections || '[]')
            const isBoundToCard = connections.some(
              c => c.type === 'character' && c.id === card.id
            )
            
            return (
              <DropdownMenuItem
                key={p.id}
                onClick={() => handleSelectPersona(p)}
                className={cn(
                  p.id === persona.id && 'bg-accent'
                )}
              >
                <Avatar className="h-5 w-5 mr-2">
                  {p.avatarPath ? (
                    <AvatarImage src={convertFileSrc(p.avatarPath)} />
                  ) : null}
                  <AvatarFallback className="text-[10px]">
                    <User className="h-3 w-3" />
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate">{p.name}</span>
                <div className="flex items-center gap-0.5 ml-2">
                  {p.isDefault && (
                    <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                  )}
                  {isBoundToCard && (
                    <Link2 className="h-3 w-3 text-green-500" />
                  )}
                </div>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // 完整模式 (用于侧边栏等)
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-accent/50">
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
          <span className="font-medium text-sm truncate">{persona.name}</span>
          {renderStatusIcons()}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {persona.description || '用户身份'}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={handleToggleChatLock}
            disabled={isLoading || !chat}
          >
            {personaState?.locked.chat ? (
              <>
                <Unlock className="h-4 w-4 mr-2" />
                解除聊天锁定
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 mr-2" />
                锁定到聊天
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleToggleCharacterBinding}
            disabled={isLoading || !card}
          >
            {personaState?.locked.character ? (
              <>
                <Link2 className="h-4 w-4 mr-2 text-green-500" />
                解除角色绑定
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                绑定到角色
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
