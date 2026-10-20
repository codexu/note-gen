'use client'
import { SettingType } from '../components/setting-base'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash, Pencil, Sparkles, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import usePromptStore, { Prompt } from '@/stores/prompt'
import useSettingStore from '@/stores/setting'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/responsive-dialog'
import { Label } from '@/components/ui/label'
import { OpenBroswer } from '@/components/open-broswer'
import { fetchAi } from '@/lib/ai/chat'
import { toast } from '@/hooks/use-toast'
import { useI18n } from '@/hooks/useI18n'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'

export function SettingPrompt({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations('settings')
  const { currentLocale } = useI18n();
  const commonT = useTranslations('common')
  const { promptList, initPromptData, addPrompt, updatePrompt, deletePrompt } = usePromptStore()
  const { systemPrompt, setSystemPrompt } = useSettingStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [systemPromptDialogOpen, setSystemPromptDialogOpen] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [systemPromptDraft, setSystemPromptDraft] = useState(systemPrompt)
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const systemPromptChanged = systemPromptDraft !== systemPrompt

  useEffect(() => {
    initPromptData()
  }, [])

  useEffect(() => {
    setSystemPromptDraft(systemPrompt)
  }, [systemPrompt])

  const handleSystemPromptDialogChange = (open: boolean) => {
    setSystemPromptDialogOpen(open)
    setSystemPromptDraft(systemPrompt)
  }

  const handleSaveSystemPrompt = async () => {
    await setSystemPrompt(systemPromptDraft)
    setSystemPromptDialogOpen(false)
    toast({
      description: t('prompt.systemPrompt.saveSuccess')
    })
  }

  const handleResetSystemPrompt = async () => {
    setSystemPromptDraft('')
  }

  // 添加新prompt
  const handleAddPrompt = async () => {
    if (!newTitle.trim()) return
    await addPrompt({
      title: newTitle,
      content: newContent
    })
    // 清空表单
    setNewTitle('')
    setNewContent('')
    setDialogOpen(false)
  }

  // 保存编辑中的prompt
  const handleSaveEdit = async (id: string) => {
    const prompt = promptList.find(p => p.id === id)
    if (!prompt) return

    if (!newTitle.trim()) return
    await updatePrompt({
      ...prompt,
      title: newTitle,
      content: newContent
    })
    setEditingId(null)
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingId(null)
  }

  // 开始编辑
  const handleStartEdit = (prompt: Prompt) => {
    setEditingId(prompt.id)
    setNewTitle(prompt.title)
    setNewContent(prompt.content)
  }

  // 删除prompt
  const handleDeletePrompt = async (id: string) => {
    await deletePrompt(id)
  }

  // 优化提示词
  const handleOptimizePrompt = async () => {
    if (!newContent.trim()) {
      toast({
        description: t('prompt.noContentToOptimize'),
        variant: 'destructive'
      })
      return
    }

    setIsOptimizing(true)
    try {
      const optimizationPrompt = `
      Please optimize the following prompt, use ${currentLocale} language, making it clearer, more specific, and more effective. 
      Maintain the original meaning while improving expression, adding necessary context, optimizing structure and logic. 
      Please directly return the optimized prompt content, without adding any additional explanation:

${newContent}`
      
      const optimizedContent = await fetchAi(optimizationPrompt)
      if (optimizedContent) {
        setNewContent(optimizedContent)
        toast({
          description: t('prompt.optimizeSuccess')
        })
      } else {
        toast({
          description: t('prompt.optimizeFailed'),
          variant: 'destructive'
        })
      }
    } catch {
      toast({
        description: t('prompt.optimizeFailed'),
        variant: 'destructive'
      })
    } finally {
      setIsOptimizing(false)
    }
  }

  // 打开新增对话框
  const handleOpenAddDialog = () => {
    setNewTitle('')
    setNewContent('')
    setDialogOpen(true)
  }

  return (
    <SettingType id={id} title={t('prompt.title')} desc={t('prompt.desc')} icon={icon}>
      <div className="flex flex-col gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon">
            <FileText className="size-4" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t('prompt.systemPrompt.title')}</ItemTitle>
            <ItemDescription>{t('prompt.systemPrompt.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ResponsiveDialog open={systemPromptDialogOpen} onOpenChange={handleSystemPromptDialogChange}>
              <ResponsiveDialogTrigger asChild>
                <Button type="button" variant="outline">
                  <Pencil data-icon="inline-start" />
                  {commonT('edit')}
                </Button>
              </ResponsiveDialogTrigger>
              <ResponsiveDialogContent className="max-h-[92vh] sm:max-w-3xl">
                <ResponsiveDialogHeader>
                  <ResponsiveDialogTitle>{t('prompt.systemPrompt.title')}</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription>
                    {t('prompt.systemPrompt.help')}
                  </ResponsiveDialogDescription>
                </ResponsiveDialogHeader>
                <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-4 sm:px-0">
                  <Label htmlFor="system-prompt">{t('prompt.systemPrompt.label')}</Label>
                  <Textarea
                    id="system-prompt"
                    value={systemPromptDraft}
                    onChange={(e) => setSystemPromptDraft(e.target.value)}
                    placeholder={t('prompt.systemPrompt.placeholder')}
                    rows={isMobile ? 10 : 16}
                    maxRows={30}
                  />
                </div>
                <ResponsiveDialogFooter className="mobile-prompt-dialog-footer gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleResetSystemPrompt}
                    disabled={!systemPromptDraft}
                  >
                    {t('prompt.systemPrompt.reset')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleSystemPromptDialogChange(false)}
                  >
                    {commonT('cancel')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSaveSystemPrompt}
                    disabled={!systemPromptChanged}
                  >
                    {commonT('save')}
                  </Button>
                </ResponsiveDialogFooter>
              </ResponsiveDialogContent>
            </ResponsiveDialog>
          </ItemActions>
        </Item>
        <div className="flex justify-between items-center">
          {isMobile ? (
            <Drawer open={dialogOpen} onOpenChange={setDialogOpen}>
              <DrawerTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleOpenAddDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('prompt.addPrompt')}
                </Button>
              </DrawerTrigger>
              <DrawerContent className="max-h-[92vh]">
                <DrawerHeader>
                  <DrawerTitle>
                    {t('prompt.addPrompt')}
                  </DrawerTitle>
                  <DrawerDescription>
                    {t('prompt.addPromptDesc')}
                  </DrawerDescription>
                </DrawerHeader>
                <div className="grid min-h-0 gap-4 overflow-y-auto px-4">
                  <div className="grid gap-2">
                    <Label htmlFor="title">{t('prompt.promptTitle')}</Label>
                    <Input
                      id="title"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder={t('prompt.promptTitlePlaceholder')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="content">{t('prompt.promptContent')}</Label>
                    <div className="space-y-2">
                      <Textarea
                        id="content"
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        placeholder={t('prompt.promptContentPlaceholder')}
                        rows={5}
                        maxRows={14}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleOptimizePrompt}
                        disabled={isOptimizing || !newContent.trim()}
                        className="w-full"
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        {isOptimizing ? t('prompt.optimizing') : t('prompt.optimizePrompt')}
                      </Button>
                    </div>
                  </div>
                </div>
                <DrawerFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>{commonT('cancel')}</Button>
                  <Button onClick={handleAddPrompt}>{commonT('confirm')}</Button>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          ) : (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleOpenAddDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('prompt.addPrompt')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {t('prompt.addPrompt')}
                  </DialogTitle>
                  <DialogDescription>
                    {t('prompt.addPromptDesc')}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="title">{t('prompt.promptTitle')}</Label>
                    <Input
                      id="title"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder={t('prompt.promptTitlePlaceholder')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="content">{t('prompt.promptContent')}</Label>
                    <div className="space-y-2">
                      <Textarea
                        id="content"
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        placeholder={t('prompt.promptContentPlaceholder')}
                        rows={5}
                        maxRows={16}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleOptimizePrompt}
                        disabled={isOptimizing || !newContent.trim()}
                        className="w-full"
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        {isOptimizing ? t('prompt.optimizing') : t('prompt.optimizePrompt')}
                      </Button>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>{commonT('cancel')}</Button>
                  <Button onClick={handleAddPrompt}>{commonT('confirm')}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <OpenBroswer
            title={t('prompt.promptLibrary')}
            url="https://github.com/topics/prompt-engineering"
            className="text-sm"
          />
        </div>
        <div className="grid gap-4">
          {promptList.map((prompt) => (
            <Item key={prompt.id} variant="outline" className="mobile-prompt-card">
              <ItemContent>
                <ItemTitle>{prompt.title}</ItemTitle>
                <ItemDescription className="whitespace-pre-wrap">
                  {prompt.content || t('prompt.noContent')}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="mobile-prompt-card-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleStartEdit(prompt)}
                >
                  <Pencil data-icon="inline-start" />
                  {commonT('edit')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleDeletePrompt(prompt.id)}
                  disabled={prompt.isDefault}
                >
                  <Trash data-icon="inline-start" />
                  {commonT('delete')}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </div>

        <ResponsiveDialog
          open={editingId !== null}
          onOpenChange={(open) => {
            if (!open) handleCancelEdit()
          }}
        >
          <ResponsiveDialogContent className="max-h-[92vh] sm:max-w-2xl">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{commonT('edit')} Prompt</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('prompt.addPromptDesc')}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className="grid min-h-0 gap-4 overflow-y-auto px-4 sm:px-0">
              <div className="grid gap-2">
                <Label htmlFor="edit-prompt-title">{t('prompt.promptTitle')}</Label>
                <Input
                  id="edit-prompt-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t('prompt.promptTitlePlaceholder')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-prompt-content">{t('prompt.promptContent')}</Label>
                <Textarea
                  id="edit-prompt-content"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder={t('prompt.promptContentPlaceholder')}
                  rows={8}
                  maxRows={16}
                />
              </div>
            </div>
            <ResponsiveDialogFooter className="mobile-prompt-dialog-footer gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleOptimizePrompt}
                disabled={isOptimizing || !newContent.trim()}
              >
                {isOptimizing ? t('prompt.optimizing') : t('prompt.optimizePrompt')}
              </Button>
              <Button type="button" variant="outline" onClick={handleCancelEdit}>
                {commonT('cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => editingId && handleSaveEdit(editingId)}
                disabled={!newTitle.trim()}
              >
                {commonT('save')}
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </div>
    </SettingType>
  )
}
