'use client'

import { useState, useEffect, useCallback } from 'react'
import { TavernCard, TavernChat, getCards, getDefaultPersona, TavernPersona } from '@/db/tavern'
import { waitForDbInit } from '@/db'
import { CharacterList } from './components/character-list'
import { ChatWindow } from './components/chat-window'
import { CharacterInfo } from './components/character-info'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

// 移动端视图状态
type MobileView = 'list' | 'chat' | 'info'

export default function TavernPage() {
  const [cards, setCards] = useState<TavernCard[]>([])
  const [selectedCard, setSelectedCard] = useState<TavernCard | null>(null)
  const [selectedChat, setSelectedChat] = useState<TavernChat | null>(null)
  const [persona, setPersona] = useState<TavernPersona | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [mobileView, setMobileView] = useState<MobileView>('list')
  
  // 检测移动端
  const isMobile = useIsMobile()

  // 加载角色卡列表和用户设定
  useEffect(() => {
    async function loadData() {
      try {
        // 等待数据库初始化完成
        await waitForDbInit()
        
        const [cardsData, personaData] = await Promise.all([
          getCards(),
          getDefaultPersona()
        ])
        setCards(cardsData)
        setPersona(personaData)
      } catch (error) {
        console.error('加载数据失败:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [])

  // 刷新角色卡列表
  const refreshCards = async () => {
    const cardsData = await getCards()
    setCards(cardsData)
  }

  // 选择角色卡
  const handleSelectCard = useCallback((card: TavernCard) => {
    setSelectedCard(card)
    setSelectedChat(null) // 重置聊天选择
    // 移动端自动切换到聊天视图
    if (isMobile) {
      setMobileView('chat')
    }
  }, [isMobile])

  // 移动端返回角色列表
  const handleBackToList = useCallback(() => {
    setMobileView('list')
  }, [])

  // 切换角色信息面板
  const handleToggleInfo = useCallback(() => {
    if (isMobile) {
      setMobileView(mobileView === 'info' ? 'chat' : 'info')
    } else {
      setShowInfo(!showInfo)
    }
  }, [isMobile, mobileView, showInfo])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    )
  }

  // 移动端布局
  if (isMobile) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden bg-background">
        {/* 移动端 - 角色列表视图 */}
        {mobileView === 'list' && (
          <div className="flex-1 flex flex-col">
            <CharacterList
              cards={cards}
              selectedCard={selectedCard}
              onSelectCard={handleSelectCard}
              onRefresh={refreshCards}
            />
          </div>
        )}

        {/* 移动端 - 聊天视图 */}
        {mobileView === 'chat' && selectedCard && persona && (
          <div className="flex-1 flex flex-col">
            <ChatWindow
              card={selectedCard}
              chat={selectedChat}
              persona={persona}
              onChatSelect={setSelectedChat}
              onToggleInfo={handleToggleInfo}
              onBack={handleBackToList}
              isMobile={true}
            />
          </div>
        )}

        {/* 移动端 - 角色信息视图 */}
        {mobileView === 'info' && selectedCard && (
          <div className="flex-1 flex flex-col">
            <div className="flex items-center gap-2 p-3 border-b border-border">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileView('chat')}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <span className="font-medium">角色信息</span>
            </div>
            <CharacterInfo
              card={selectedCard}
              onClose={() => setMobileView('chat')}
            />
          </div>
        )}
      </div>
    )
  }

  // 桌面端布局
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* 左侧 - 角色列表 (Telegram Sidebar 风格) */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col">
        <CharacterList
          cards={cards}
          selectedCard={selectedCard}
          onSelectCard={handleSelectCard}
          onRefresh={refreshCards}
        />
      </div>

      {/* 中间 - 聊天窗口 */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedCard && persona ? (
          <ChatWindow
            card={selectedCard}
            chat={selectedChat}
            persona={persona}
            onChatSelect={setSelectedChat}
            onToggleInfo={handleToggleInfo}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <div className="text-lg">选择一个角色开始对话</div>
              <div className="text-sm mt-2">或者导入新的角色卡</div>
            </div>
          </div>
        )}
      </div>

      {/* 右侧 - 角色信息面板 (可折叠) */}
      <div
        className={cn(
          'flex-shrink-0 border-l border-border overflow-hidden transition-all duration-300',
          showInfo ? 'w-80' : 'w-0'
        )}
      >
        {selectedCard && showInfo && (
          <CharacterInfo
            card={selectedCard}
            onClose={() => setShowInfo(false)}
          />
        )}
      </div>
    </div>
  )
}
