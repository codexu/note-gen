'use client';

import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mic, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useSpeechRecognitionStore from '@/stores/speech-recognition';
import { toast } from '@/hooks/use-toast';

interface SpeechRecognitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTranscriptionComplete?: (text: string) => void;
  language?: string; // 语言选择：zh-CN, en-US 等
}

export function SpeechRecognitionDialog({
  open,
  onOpenChange,
  onTranscriptionComplete,
  language = 'zh-CN'
}: SpeechRecognitionDialogProps) {
  const t = useTranslations('recording');
  const {
    isRecognizing,
    transcript,
    interimTranscript,
    startRecognition,
    stopRecognition,
    resetState,
    isSupported
  } = useSpeechRecognitionStore();

  // 检查浏览器支持
  useEffect(() => {
    if (open && !isSupported()) {
      toast({
        title: t('error'),
        description: '当前浏览器不支持语音识别功能，请使用 Chrome、Edge 或 Safari',
        variant: 'destructive'
      });
      onOpenChange(false);
    }
  }, [open, isSupported]);

  // 关闭对话框时重置状态
  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open]);

  // 开始识别
  const handleStart = async () => {
    try {
      await startRecognition(language);
    } catch (error) {
      toast({
        title: t('error'),
        description: error instanceof Error ? error.message : t('startError'),
        variant: 'destructive'
      });
    }
  };

  // 停止识别并保存
  const handleStop = () => {
    stopRecognition();
    
    if (transcript) {
      onTranscriptionComplete?.(transcript);
      toast({
        title: t('success'),
        description: t('transcriptionSuccess')
      });
      onOpenChange(false);
    } else {
      toast({
        title: t('error'),
        description: t('transcriptionEmpty'),
        variant: 'destructive'
      });
    }
  };

  // 取消识别
  const handleCancel = () => {
    resetState();
    onOpenChange(false);
  };

  // 显示的文本（最终文本 + 临时文本）
  const displayText = transcript + (interimTranscript ? ` ${interimTranscript}` : '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            使用浏览器内置语音识别，免费且无需配置
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 识别状态指示器 */}
          <div className="flex items-center justify-center">
            <div className={`p-8 rounded-full ${isRecognizing ? 'bg-red-500/10 animate-pulse' : 'bg-muted'}`}>
              <Mic className={`size-12 ${isRecognizing ? 'text-red-500' : 'text-muted-foreground'}`} />
            </div>
          </div>

          {/* 状态文本 */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {isRecognizing ? '正在识别...' : '点击开始按钮开始语音识别'}
            </p>
          </div>

          {/* 识别结果显示区 */}
          <div className="min-h-[120px] p-4 border rounded-lg bg-muted/50">
            {displayText ? (
              <p className="text-sm whitespace-pre-wrap">
                <span className="text-foreground">{transcript}</span>
                {interimTranscript && (
                  <span className="text-muted-foreground italic"> {interimTranscript}</span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground text-center">
                识别结果将显示在这里
              </p>
            )}
          </div>

          {/* 控制按钮 */}
          <div className="flex justify-center gap-2">
            {!isRecognizing ? (
              <>
                <Button onClick={handleStart} size="lg">
                  <Mic className="mr-2 size-4" />
                  开始识别
                </Button>
                {transcript && (
                  <Button onClick={handleStop} variant="default" size="lg">
                    保存
                  </Button>
                )}
                <Button onClick={handleCancel} variant="outline" size="lg">
                  {t('cancel')}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={handleStop} variant="destructive" size="lg">
                  <Square className="mr-2 size-4" />
                  停止并保存
                </Button>
                <Button onClick={handleCancel} variant="outline" size="lg">
                  {t('cancel')}
                </Button>
              </>
            )}
          </div>

          {/* 提示信息 */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>💡 提示：</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>浏览器内置识别完全免费</li>
              <li>实时显示识别结果</li>
              <li>部分浏览器需要网络连接</li>
              <li>支持中文、英文等多种语言</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
