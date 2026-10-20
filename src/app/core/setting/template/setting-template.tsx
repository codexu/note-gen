import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting";
import { SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { getTemplateRangeLabel, getTemplateRangeOptions } from '@/lib/template-range-utils';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LayoutTemplate, Plus, Trash, Pencil } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { ResponsiveSelect } from "@/components/responsive-select";
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export function SettingTemplate({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations();
  const { templateList, setTemplateList } = useSettingStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentTemplate, setCurrentTemplate] = useState<GenTemplate | null>(null);
  const isMobile = useIsMobile() || checkIsMobileDevice()

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
          {isMobile ? (
            <Drawer open={dialogOpen} onOpenChange={setDialogOpen}>
              <DrawerTrigger asChild>
                <Button variant="outline" size="sm" onClick={openAddDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('settings.template.addTemplate')}
                </Button>
              </DrawerTrigger>
              <DrawerContent className="max-h-[92vh]">
                <DrawerHeader>
                  <DrawerTitle>
                    {t('settings.template.addTemplate')}
                  </DrawerTitle>
                  <DrawerDescription>
                    {t('settings.template.addTemplateDesc') || t('settings.template.customTemplate')}
                  </DrawerDescription>
                </DrawerHeader>
                <div className="grid min-h-0 gap-4 overflow-y-auto px-4">
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
                    <ResponsiveSelect
                      title={t('settings.template.scope')}
                      value={templateRange}
                      onValueChange={value => setTemplateRange(value as GenTemplateRange)}
                      placeholder={t('settings.template.selectScope')}
                      options={getTemplateRangeOptions(t)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="content">{t('settings.template.content')}</Label>
                    <Textarea
                      id="content"
                      rows={5}
                      maxRows={14}
                      value={templateContent}
                      onChange={(e) => setTemplateContent(e.target.value)}
                      placeholder={t('settings.template.content')}
                    />
                  </div>
                </div>
                <DrawerFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel') || 'Cancel'}</Button>
                  <Button onClick={createTemplateHandler}>{t('common.confirm') || 'Confirm'}</Button>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          ) : (
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
                    <ResponsiveSelect
                      title={t('settings.template.scope')}
                      value={templateRange}
                      onValueChange={value => setTemplateRange(value as GenTemplateRange)}
                      placeholder={t('settings.template.selectScope')}
                      options={getTemplateRangeOptions(t)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="content">{t('settings.template.content')}</Label>
                    <Textarea
                      id="content"
                      rows={5}
                      maxRows={14}
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
          )}
        </div>

        {templateList.length === 0 ? (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><LayoutTemplate /></EmptyMedia>
              <EmptyTitle>{t('settings.template.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('settings.template.emptyDesc')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openAddDialog}>
                <Plus data-icon="inline-start" />
                {t('settings.template.addTemplate')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {/* Edit Template Dialog/Drawer */}
        {isMobile ? (
          <Drawer open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DrawerContent className="max-h-[92vh]">
              <DrawerHeader>
                <DrawerTitle>
                  {t('settings.template.editTemplate') || 'Edit Template'}
                </DrawerTitle>
              </DrawerHeader>
              <div className="grid min-h-0 gap-4 overflow-y-auto px-4">
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
                  <ResponsiveSelect
                    title={t('settings.template.scope')}
                    value={templateRange}
                    onValueChange={value => setTemplateRange(value as GenTemplateRange)}
                    placeholder={t('settings.template.selectScope')}
                    options={getTemplateRangeOptions(t)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-content">{t('settings.template.content')}</Label>
                  <Textarea
                    id="edit-content"
                    rows={5}
                    maxRows={14}
                    value={templateContent}
                    onChange={(e) => setTemplateContent(e.target.value)}
                    placeholder={t('settings.template.content')}
                  />
                </div>
              </div>
              <DrawerFooter className="flex-row [&>*]:flex-1">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t('common.cancel') || 'Cancel'}</Button>
                <Button onClick={updateTemplateHandler}>{t('common.confirm') || 'Confirm'}</Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        ) : (
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
                  <ResponsiveSelect
                    title={t('settings.template.scope')}
                    value={templateRange}
                    onValueChange={value => setTemplateRange(value as GenTemplateRange)}
                    placeholder={t('settings.template.selectScope')}
                    options={getTemplateRangeOptions(t)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-content">{t('settings.template.content')}</Label>
                  <Textarea
                    id="edit-content"
                    rows={5}
                    maxRows={14}
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
        )}

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
