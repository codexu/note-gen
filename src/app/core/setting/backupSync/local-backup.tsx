'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Upload, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="space-y-6">
      {/* 导出备份 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t('export.title')}
          </CardTitle>
          <CardDescription>
            {t('export.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleExport} 
            disabled={isExporting}
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            {isExporting ? t('export.exporting') : t('export.button')}
          </Button>
        </CardContent>
      </Card>

      {/* 导入备份 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('import.title')}
          </CardTitle>
          <CardDescription>
            {t('import.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={handleImport} 
            disabled={isImporting}
          >
            <Upload className="h-4 w-4 mr-2" />
            {isImporting ? t('import.importing') : t('import.button')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
