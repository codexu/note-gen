'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TavernCard } from '@/db/tavern'
import { selectAndExportCharacter } from '@/lib/tavern'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { convertFileSrc } from '@tauri-apps/api/core'
import { X, User, FileText, MessageSquare, Settings, Download, Pencil } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

interface CharacterInfoProps {
  card: TavernCard
  onClose: () => void
}

export function CharacterInfo({ card, onClose }: CharacterInfoProps) {
  const [isExporting, setIsExporting] = useState(false)
  const { toast } = useToast()
  const router = useRouter()
  const avatarUrl = card.avatarPath ? convertFileSrc(card.avatarPath) : undefined
  const tags: string[] = card.tags ? JSON.parse(card.tags) : []
  const alternateGreetings: string[] = card.alternateGreetings 
    ? JSON.parse(card.alternateGreetings) 
    : []

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const result = await selectAndExportCharacter(card.id)
      if (result.success) {
        toast({
          title: '导出成功',
          description: `角色卡已保存到 ${result.path}`,
        })
      } else if (result.error !== '用户取消') {
        toast({
          title: '导出失败',
          description: result.error,
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col h-full w-80">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold">角色信息</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* 头像和基本信息 */}
          <div className="flex flex-col items-center text-center">
            <Avatar className="h-24 w-24 mb-3">
              <AvatarImage src={avatarUrl} alt={card.name} />
              <AvatarFallback className="text-2xl">
                {card.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-bold">{card.name}</h2>
            {card.creator && (
              <p className="text-sm text-muted-foreground">by {card.creator}</p>
            )}
            {card.characterVersion && (
              <p className="text-xs text-muted-foreground">v{card.characterVersion}</p>
            )}
            {/* 操作按钮 */}
            <div className="flex gap-2 mt-3">
              <Button
                variant="default"
                size="sm"
                onClick={() => router.push(`/core/tavern/editor?id=${card.id}`)}
              >
                <Pencil className="h-4 w-4 mr-2" />
                编辑角色
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isExporting}
              >
                {isExporting ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                导出
              </Button>
            </div>
          </div>

          {/* 标签 */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {tags.map((tag, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <Separator />

          {/* 详细信息折叠面板 */}
          <Accordion type="multiple" defaultValue={['description', 'personality']}>
            {/* 描述 */}
            {card.description && (
              <AccordionItem value="description">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    角色描述
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {card.description}
                  </p>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 性格 */}
            {card.personality && (
              <AccordionItem value="personality">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    性格特点
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {card.personality}
                  </p>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 场景 */}
            {card.scenario && (
              <AccordionItem value="scenario">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    场景设定
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {card.scenario}
                  </p>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 初始消息 */}
            {card.firstMes && (
              <AccordionItem value="firstMes">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    初始消息
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {card.firstMes}
                  </p>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 备选问候语 */}
            {alternateGreetings.length > 0 && (
              <AccordionItem value="alternateGreetings">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    备选问候语 ({alternateGreetings.length})
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {alternateGreetings.map((greeting, i) => (
                      <div
                        key={i}
                        className="p-2 rounded bg-muted text-sm text-muted-foreground"
                      >
                        {greeting.slice(0, 100)}
                        {greeting.length > 100 && '...'}
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 对话示例 */}
            {card.mesExample && (
              <AccordionItem value="mesExample">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    对话示例
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs">
                    {card.mesExample.slice(0, 500)}
                    {card.mesExample.length > 500 && '...'}
                  </p>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 创作者笔记 */}
            {card.creatorNotes && (
              <AccordionItem value="creatorNotes">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    创作者笔记
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {card.creatorNotes}
                  </p>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </div>
      </ScrollArea>
    </div>
  )
}
