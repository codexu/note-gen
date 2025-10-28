import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { ModelSelect } from "../components/model-select";
import { Gauge, Volume2, Mic } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useSettingStore from "@/stores/setting";

export function Setting() {
  const t = useTranslations('settings.audio');
  const { audioModel, setAiModelList } = useSettingStore();
  const [speed, setSpeed] = useState(1);

  // 加载TTS语速设置
  useEffect(() => {
    async function loadSpeed() {
      if (!audioModel) return;
      const store = await Store.load('store.json');
      const models = await store.get<any[]>('aiModelList');
      if (!models) return;
      
      // 查找TTS模型配置，适配新的多模型数据结构
      let currentSpeed = 1;
      for (const config of models) {
        // 检查新的 models 数组结构
        if (config.models && config.models.length > 0) {
          const targetModel = config.models.find((model: any) => 
            model.id === audioModel && model.modelType === 'tts'
          );
          if (targetModel && targetModel.speed !== undefined) {
            currentSpeed = targetModel.speed;
            break;
          }
        } else {
          // 向后兼容：处理旧的单模型结构
          if (config.key === audioModel && config.modelType === 'tts' && config.speed !== undefined) {
            currentSpeed = config.speed;
            break;
          }
        }
      }
      
      setSpeed(currentSpeed);
      setAiModelList(models);
    }
    loadSpeed();
  }, [audioModel]);

  // 保存TTS语速设置
  const handleSpeedChange = async (value: number[]) => {
    const newSpeed = value[0];
    setSpeed(newSpeed);
    
    if (!audioModel) return;
    
    const store = await Store.load('store.json');
    const models = await store.get<any[]>('aiModelList') || [];
    
    // 更新TTS模型的语速设置，适配新的多模型数据结构
    const updatedModels = models.map(config => {
      // 检查新的 models 数组结构
      if (config.models && config.models.length > 0) {
        const updatedConfig = { ...config };
        updatedConfig.models = config.models.map((model: any) => {
          if (model.id === audioModel && model.modelType === 'tts') {
            return { ...model, speed: newSpeed };
          }
          return model;
        });
        return updatedConfig;
      } else {
        // 向后兼容：处理旧的单模型结构
        if (config.key === audioModel && config.modelType === 'tts') {
          return { ...config, speed: newSpeed };
        }
        return config;
      }
    });
    
    setAiModelList(updatedModels);
    await store.set('aiModelList', updatedModels);
    await store.save();
  };

  return (
    <ItemGroup className="gap-6">
      {/* TTS朗读设置部分 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t('tts.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('tts.desc')}</p>
      </div>

      <ItemGroup className="gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon"><Volume2 className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('tts.model.title')}</ItemTitle>
            <ItemDescription>{t('tts.model.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ModelSelect modelKey="tts" />
          </ItemActions>
        </Item>

        {audioModel && (
          <Item variant="outline">
            <ItemMedia variant="icon"><Gauge className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('tts.speed.title')}</ItemTitle>
              <ItemDescription>{t('tts.speed.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <div className="flex items-center gap-4">
                <Slider
                  value={[speed]}
                  onValueChange={handleSpeedChange}
                  min={0.5}
                  max={2}
                  step={0.1}
                  className="w-[180px]"
                />
                <span className="text-zinc-500 w-10">{speed}x</span>
              </div>
            </ItemActions>
          </Item>
        )}
      </ItemGroup>

      {/* STT语音识别设置部分 */}
      <div className="space-y-2 mt-8">
        <h3 className="text-sm font-medium text-foreground">{t('stt.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('stt.desc')}</p>
      </div>

      <ItemGroup className="gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('stt.model.title')}</ItemTitle>
            <ItemDescription>{t('stt.model.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ModelSelect modelKey="stt" />
          </ItemActions>
        </Item>
      </ItemGroup>
    </ItemGroup>
  )
}
