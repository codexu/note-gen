'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { useToast } from "@/hooks/use-toast";
import dayjs from 'dayjs';

export default function LocalBackup() {
  const t = useTranslations('settings.backupSync.localBackup');
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);

      // 选择保存位置
      const filePath = await save({
        title: t('exportDialog.title'),
        defaultPath: `note-gen-backup-${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.zip`,
        filters: [{
          name: 'ZIP Files',
          extensions: ['zip']
        }]
      });

      if (!filePath) {
        setIsExporting(false);
        return;
      }

      // 调用后端命令导出AppData
      await invoke('export_app_data', { outputPath: filePath });
      
      toast({
        title: t('exportSuccess'),
        description: filePath,
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: t('exportError'),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    try {
      setIsImporting(true);

      // 选择zip文件
      const filePath = await open({
        title: t('importDialog.title'),
        multiple: false,
        filters: [{
          name: 'ZIP Files',
          extensions: ['zip']
        }]
      });

      if (!filePath) {
        setIsImporting(false);
        return;
      }

      // 调用后端命令导入AppData
      await invoke('import_app_data', { zipPath: filePath });
      
      toast({
        title: t('importSuccess'),
        description: t('restartConfirm'),
      });
    } catch (error) {
      console.error('Import failed:', error);
      toast({
        title: t('importError'),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <ItemGroup className="gap-4">
      {/* 导出备份 */}
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Download className="size-4" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('export.title')}</ItemTitle>
          <ItemDescription>{t('export.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button 
            onClick={handleExport} 
            disabled={isExporting}
          >
            {isExporting ? t('export.exporting') : t('export.button')}
          </Button>
        </ItemActions>
      </Item>

      {/* 导入备份 */}
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Upload className="size-4" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('import.title')}</ItemTitle>
          <ItemDescription>{t('import.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button 
            onClick={handleImport} 
            disabled={isImporting}
          >
            {isImporting ? t('import.importing') : t('import.button')}
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}
