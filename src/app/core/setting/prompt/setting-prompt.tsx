'use client'
import { SettingType } from '../components/setting-base'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CardContent, Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash, Pencil, Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import usePromptStore, { Prompt } from '@/stores/prompt'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { OpenBroswer } from '@/components/open-broswer'

export function SettingPrompt({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations('settings')
  const commonT = useTranslations('common')
  const { promptList, initPromptData, addPrompt, updatePrompt, deletePrompt } = usePromptStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    initPromptData()
  }, [])

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

  // 打开新增对话框
  const handleOpenAddDialog = () => {
    setNewTitle('')
    setNewContent('')
    setDialogOpen(true)
  }

  return (
    <SettingType id={id} title={t('prompt.title')} desc={t('prompt.desc')} icon={icon}>
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
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
                  <Textarea
                    id="content"
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder={t('prompt.promptContentPlaceholder')}
                    rows={5}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>{commonT('cancel')}</Button>
                <Button onClick={handleAddPrompt}>{commonT('confirm')}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <OpenBroswer title="Awesome Prompts" url="https://github.com/f/awesome-chatgpt-prompts" className='text-sm' />
        </div>
        <div className="grid gap-4">
          {promptList.map((prompt) => (
            <Card key={prompt.id}>
              <CardContent className="p-4">
                {editingId === prompt.id ? (
                  <div className="flex flex-col gap-4">
                    <Input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder={t('prompt.promptTitlePlaceholder')}
                    />
                    <Textarea
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      placeholder={t('prompt.promptContentPlaceholder')}
                      rows={5}
                    />
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleCancelEdit}
                      >
                        <X className="h-4 w-4 mr-2" />
                        {commonT('cancel')}
                      </Button>
                      <Button 
                        size="sm" 
                        onClick={() => handleSaveEdit(prompt.id)}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        {commonT('save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <h3 className="font-medium">{prompt.title}</h3>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartEdit(prompt)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeletePrompt(prompt.id)}
                          disabled={prompt.isDefault}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
                      {prompt.content || t('prompt.noContent')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </SettingType>
  )
}
