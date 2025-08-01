import { TooltipButton } from "@/components/tooltip-button";
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { textToSpeechAndPlay, stopCurrentAudio } from "@/lib/audio";
import useSettingStore from "@/stores/setting";

export default function ReadAloud({value}: {value?: string}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { audioModel, aiModelList } = useSettingStore();
  const t = useTranslations('article.editor.floatbar.readAloud');

  async function handleReadAloud() {
    if (!value?.trim()) return;
    
    // 如果正在播放，则停止播放
    if (isPlaying) {
      stopCurrentAudio();
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    
    try {
      // 获取当前音频模型的speed配置
      const audioConfig = aiModelList.find(config => config.key === audioModel);
      const speed = audioConfig?.speed;
      
      // 调用朗读API，传入speed和状态回调
      await textToSpeechAndPlay(value, undefined, speed, (playing: boolean) => {
        setIsPlaying(playing);
        if (playing) {
          setIsLoading(false); // 开始播放时清除loading状态
        }
      });
    } catch (error) {
      console.error('朗读失败:', error);
      // 可以在这里添加错误提示
    } finally {
      setIsLoading(false);
      setIsPlaying(false);
    }
  }

  // 根据状态显示不同的图标
  const getIcon = () => {
    if (isLoading) {
      return <Loader2 className="animate-spin" />;
    }
    return isPlaying ? <VolumeX /> : <Volume2 />;
  };

  // 根据状态显示不同的提示文字
  const getTooltipText = () => {
    if (isLoading) {
      return t('loading');
    }
    return isPlaying ? t('stop') : t('start');
  };

  return (
    <TooltipButton 
      disabled={!value?.trim() || isLoading} 
      icon={getIcon()} 
      tooltipText={getTooltipText()} 
      onClick={handleReadAloud}
    />
  );
}
