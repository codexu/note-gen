'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mic, Square, Play, Pause, Loader2 } from 'lucide-react';
import useRecordingStore from '@/stores/recording';
import useSettingStore from '@/stores/setting';
import { fetchAudioTranscription } from '@/lib/audio';
import { useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';

interface RecordingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTranscriptionComplete?: (text: string) => void;
}

export function RecordingDialog({ open, onOpenChange, onTranscriptionComplete }: RecordingDialogProps) {
  const t = useTranslations('recording');
  const router = useRouter();
  const { sttModel } = useSettingStore();
  const {
    isRecording,
    isPaused,
    recordingDuration,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
  } = useRecordingStore();

  const [isProcessing, setIsProcessing] = useState(false);

  // 格式化录音时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 检查是否配置了STT模型
  useEffect(() => {
    if (open && !sttModel) {
      toast({
        title: t('error'),
        description: t('noModelConfigured'),
        variant: 'destructive',
      });
      onOpenChange(false);
      // 跳转到设置页面
      router.push('/core/setting/audio');
    }
  }, [open, sttModel, router, onOpenChange, t]);

  // 开始录音
  const handleStart = async () => {
    try {
      await startRecording();
    } catch (error) {
      toast({
        title: t('error'),
        description: error instanceof Error ? error.message : t('startError'),
        variant: 'destructive',
      });
    }
  };

  // 暂停/继续录音
  const handlePauseResume = () => {
    if (isPaused) {
      resumeRecording();
    } else {
      pauseRecording();
    }
  };

  // 停止录音并识别
  const handleStop = async () => {
    try {
      setIsProcessing(true);
      const audioBlob = await stopRecording();
      
      if (!audioBlob) {
        toast({
          title: t('error'),
          description: t('noAudioData'),
          variant: 'destructive',
        });
        return;
      }

      // 调用STT API进行语音识别
      const transcription = await fetchAudioTranscription(audioBlob);
      
      if (transcription) {
        toast({
          title: t('success'),
          description: t('transcriptionSuccess'),
        });
        onTranscriptionComplete?.(transcription);
        onOpenChange(false);
      } else {
        toast({
          title: t('error'),
          description: t('transcriptionEmpty'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('语音识别失败:', error);
      toast({
        title: t('error'),
        description: error instanceof Error ? error.message : t('transcriptionError'),
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 取消录音
  const handleCancel = () => {
    cancelRecording();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-8">
          {/* 录音时长显示 */}
          <div className="text-5xl font-mono font-bold text-foreground">
            {formatDuration(recordingDuration)}
          </div>

          {/* 录音状态指示器 */}
          <div className="flex items-center gap-3">
            {isRecording && !isPaused && (
              <>
                <div className="size-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm text-muted-foreground">{t('recording')}</span>
              </>
            )}
            {isPaused && (
              <>
                <div className="size-3 rounded-full bg-yellow-500" />
                <span className="text-sm text-muted-foreground">{t('paused')}</span>
              </>
            )}
            {!isRecording && !isProcessing && (
              <span className="text-sm text-muted-foreground">{t('ready')}</span>
            )}
            {isProcessing && (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm text-muted-foreground">{t('processing')}</span>
              </>
            )}
          </div>

          {/* 控制按钮 */}
          <div className="flex gap-3">
            {!isRecording && !isProcessing && (
              <Button
                size="lg"
                onClick={handleStart}
                className="size-16 rounded-full"
              >
                <Mic className="size-6" />
              </Button>
            )}

            {isRecording && (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handlePauseResume}
                  className="size-16 rounded-full"
                >
                  {isPaused ? <Play className="size-6" /> : <Pause className="size-6" />}
                </Button>

                <Button
                  size="lg"
                  variant="destructive"
                  onClick={handleStop}
                  className="size-16 rounded-full"
                  disabled={isProcessing}
                >
                  <Square className="size-6" />
                </Button>
              </>
            )}
          </div>

          {/* 取消按钮 */}
          {(isRecording || isProcessing) && (
            <Button
              variant="ghost"
              onClick={handleCancel}
              disabled={isProcessing}
            >
              {t('cancel')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
