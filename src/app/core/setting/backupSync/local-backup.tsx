'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { invoke } from '@tauri-apps/api/core';
import { save, open, ask } from '@tauri-apps/plugin-dialog';
import { useToast } from "@/hooks/use-toast";
import dayjs from 'dayjs';
import { isMobileDevice } from '@/lib/check';

export default function LocalBackup() {
  const t = useTranslations('settings.backupSync.localBackup');
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileDevice();

  const handleExport = async () => {
    try {
      setIsExporting(true);

      let filePath: string;

      if (isMobile) {
        // 移动端直接生成文件名，保存到应用目录
        filePath = `note-gen-backup-${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
      } else {
        // 桌面端弹出保存对话框
        const selectedPath = await save({
          title: t('exportDialog.title'),
          defaultPath: `note-gen-backup-${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.zip`,
          filters: [{
            name: 'ZIP Files',
            extensions: ['zip']
          }]
        });

        if (!selectedPath) {
          setIsExporting(false);
          return;
        }
        filePath = selectedPath;
      }

      // 调用后端命令导出AppData
      const savedPath = await invoke<string>('export_app_data', { outputPath: filePath });

      toast({
        title: t('exportSuccess'),
        description: isMobile
          ? `文件已保存到: ${savedPath}\n请在 Files App 中查看`
          : savedPath,
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

      // 移动端使用原生 file input，桌面端使用 Tauri dialog
      if (isMobile) {
        if (fileInputRef.current) {
          fileInputRef.current.click();
        }
        // 等待用户选择文件，onChange 会处理后续逻辑
        return;
      }

      // 桌面端使用 Tauri dialog
      const filePath = await open({
        title: t('importDialog.title'),
        multiple: false,
        directory: false,
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

      // 导入成功，询问用户是否立即重启
      const shouldRestart = await ask(t('restartConfirm'), {
        title: t('importSuccess'),
        kind: 'info'
      });

      if (shouldRestart) {
        // 移动端关闭程序，桌面端重启
        const { exit, relaunch } = await import('@tauri-apps/plugin-process')
        if (isMobile) {
          await exit(0)
        } else {
          await relaunch()
        }
      }
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

  // 处理移动端文件选择
  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setIsImporting(false);
      return;
    }

    const file = files[0];
    // 移动端选择的文件需要读取路径
    // 由于 webview 限制，需要通过后端处理
    try {
      // 获取文件路径 - 移动端使用 webkitRelativePath 或 name
      // 在 Tauri 中，可以通过读取文件内容然后保存到临时位置
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // 调用后端命令导入，传入文件内容
      await invoke('import_app_data_from_file', {
        fileName: file.name,
        fileContent: Array.from(uint8Array)
      });

      // 导入成功
      toast({
        title: t('importSuccess'),
        description: isMobile ? '请手动关闭应用后重新打开' : t('restartConfirm'),
      });
    } catch (error) {
      console.error('Import failed:', error);
      toast({
        title: t('importError'),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      // 重置 input
      event.target.value = '';
      setIsImporting(false);
    }
  };

  return (
    <>
      {/* 移动端文件选择 input */}
      {isMobile && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={handleFileInputChange}
          className="hidden"
        />
      )}

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
              {isExporting ? t('export.exporting') : (isMobile ? t('export.simpleButton') : t('export.button'))}
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
    </>
  );
}
