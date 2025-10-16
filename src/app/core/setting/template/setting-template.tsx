import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting";
import { SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { getTemplateRangeLabel, getTemplateRangeOptions } from '@/lib/template-range-utils';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash, Pencil } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirm } from '@tauri-apps/plugin-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export function SettingTemplate({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations();
  const { templateList, setTemplateList } = useSettingStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentTemplate, setCurrentTemplate] = useState<GenTemplate | null>(null);

  // Form states
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateContent, setTemplateContent] = useState('');
  const [templateRange, setTemplateRange] = useState<GenTemplateRange>(GenTemplateRange.All);
  const [templateStatus, setTemplateStatus] = useState(true);

  function createTemplateHandler() {
    const newTemplate: GenTemplate = {
      id: `${templateList.length + 1}`,
      status: templateStatus,
      title: templateTitle || t('settings.template.customTemplate'),
      content: templateContent,
      range: templateRange,
    };
    
    setTemplateList([...templateList, newTemplate]);
    resetForm();
    setDialogOpen(false);
  }

  function updateTemplateHandler() {
    if (!currentTemplate) return;
    
    setTemplateList(templateList.map(item => {
      if (item.id === currentTemplate.id) {
        return {
          ...item,
          title: templateTitle,
          content: templateContent,
          range: templateRange,
          status: templateStatus
        };
      }
      return item;
    }));
    
    setEditDialogOpen(false);
    resetForm();
  }

  function deleteTemplateHandler(id: string) {
    confirm(t('settings.template.deleteConfirm')).then(async (res) => {
      if (res) {
        setTemplateList(templateList.filter(item => item.id !== id));
      }
    });
  }

  function openAddDialog() {
    resetForm();
    setDialogOpen(true);
  }

  function openEditDialog(template: GenTemplate) {
    setCurrentTemplate(template);
    setTemplateTitle(template.title);
    setTemplateContent(template.content);
    setTemplateRange(template.range);
    setTemplateStatus(template.status);
    setEditDialogOpen(true);
  }

  function resetForm() {
    setTemplateTitle('');
    setTemplateContent('');
    setTemplateRange(GenTemplateRange.All);
    setTemplateStatus(true);
    setCurrentTemplate(null);
  }

  useEffect(() => {}, [templateList]);

  return (
    <SettingType id={id} icon={icon} title={t('settings.template.title')} desc={t('settings.template.desc')}>
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={openAddDialog}>
                <Plus className="h-4 w-4 mr-2" />
                {t('settings.template.addTemplate')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t('settings.template.addTemplate')}
                </DialogTitle>
                <DialogDescription>
                  {t('settings.template.addTemplateDesc') || t('settings.template.customTemplate')}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="title">{t('settings.template.name')}</Label>
                  <Input
                    id="title"
                    value={templateTitle}
                    onChange={(e) => setTemplateTitle(e.target.value)}
                    placeholder={t('settings.template.name')}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex justify-between">
                    <Label htmlFor="range">{t('settings.template.scope')}</Label>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="status">{t('settings.template.status')}</Label>
                      <Switch
                        id="status"
                        checked={templateStatus}
                        onCheckedChange={setTemplateStatus}
                      />
                    </div>
                  </div>
                  <Select 
                    value={templateRange} 
                    onValueChange={(value: GenTemplateRange) => setTemplateRange(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('settings.template.selectScope')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {getTemplateRangeOptions(t).map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="content">{t('settings.template.content')}</Label>
                  <Textarea
                    id="content"
                    rows={5}
                    value={templateContent}
                    onChange={(e) => setTemplateContent(e.target.value)}
                    placeholder={t('settings.template.content')}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel') || 'Cancel'}</Button>
                <Button onClick={createTemplateHandler}>{t('common.confirm') || 'Confirm'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        
        {/* Edit Template Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('settings.template.editTemplate') || 'Edit Template'}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-title">{t('settings.template.name')}</Label>
                <Input
                  id="edit-title"
                  value={templateTitle}
                  onChange={(e) => setTemplateTitle(e.target.value)}
                  placeholder={t('settings.template.name')}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <Label htmlFor="edit-range">{t('settings.template.scope')}</Label>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="edit-status">{t('settings.template.status')}</Label>
                    <Switch
                      id="edit-status"
                      checked={templateStatus}
                      onCheckedChange={setTemplateStatus}
                      disabled={currentTemplate?.id === '0'}
                    />
                  </div>
                </div>
                <Select 
                  value={templateRange} 
                  onValueChange={(value: GenTemplateRange) => setTemplateRange(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('settings.template.selectScope')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {getTemplateRangeOptions(t).map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-content">{t('settings.template.content')}</Label>
                <Textarea
                  id="edit-content"
                  rows={5}
                  value={templateContent}
                  onChange={(e) => setTemplateContent(e.target.value)}
                  placeholder={t('settings.template.content')}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t('common.cancel') || 'Cancel'}</Button>
              <Button onClick={updateTemplateHandler}>{t('common.confirm') || 'Confirm'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        
        <div className="grid gap-4">
          {templateList.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <div className={`${!item.status ? 'opacity-50' : ''}`}>
                      <h3 className="font-medium">{item.title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteTemplateHandler(item.id)}
                        disabled={item.id === '0'}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t('settings.template.scope')}: <span className="font-medium">{getTemplateRangeLabel(item.range, t)}</span>
                  </div>
                  <p className={`text-sm whitespace-pre-wrap mt-2 line-clamp-3 ${!item.status ? 'opacity-50' : ''}`}>
                    {item.content || t('settings.template.noContent') || 'No content'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </SettingType>
  );
}