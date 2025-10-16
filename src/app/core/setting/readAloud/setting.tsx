import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { ModelSelect } from "../components/model-select";
import { Gauge, Volume2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useSettingStore from "@/stores/setting";

export function Setting() {
  const t = useTranslations('settings.readAloud');
  const { audioModel, setAiModelList } = useSettingStore();
  const [speed, setSpeed] = useState(1);

  // 加载语速设置
  useEffect(() => {
    async function loadSpeed() {
      if (!audioModel) return;
      const store = await Store.load('store.json');
      const models = await store.get<any[]>('aiModelList');
      if (!models) return;
      
      // 查找音频模型配置，适配新的多模型数据结构
      let currentSpeed = 1;
      for (const config of models) {
        // 检查新的 models 数组结构
        if (config.models && config.models.length > 0) {
          const targetModel = config.models.find((model: any) => 
            model.id === audioModel && model.modelType === 'audio'
          );
          if (targetModel && targetModel.speed !== undefined) {
            currentSpeed = targetModel.speed;
            break;
          }
        } else {
          // 向后兼容：处理旧的单模型结构
          if (config.key === audioModel && config.modelType === 'audio' && config.speed !== undefined) {
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

  // 保存语速设置
  const handleSpeedChange = async (value: number[]) => {
    const newSpeed = value[0];
    setSpeed(newSpeed);
    
    if (!audioModel) return;
    
    const store = await Store.load('store.json');
    const models = await store.get<any[]>('aiModelList') || [];
    
    // 更新音频模型的语速设置，适配新的多模型数据结构
    const updatedModels = models.map(config => {
      // 检查新的 models 数组结构
      if (config.models && config.models.length > 0) {
        const updatedConfig = { ...config };
        updatedConfig.models = config.models.map((model: any) => {
          if (model.id === audioModel && model.modelType === 'audio') {
            return { ...model, speed: newSpeed };
          }
          return model;
        });
        return updatedConfig;
      } else {
        // 向后兼容：处理旧的单模型结构
        if (config.key === audioModel && config.modelType === 'audio') {
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
    <ItemGroup className="gap-4">
      <Item variant="outline">
        <ItemMedia variant="icon"><Volume2 className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('options.audioModel.title')}</ItemTitle>
          <ItemDescription>{t('options.audioModel.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ModelSelect modelKey="audio" />
        </ItemActions>
      </Item>
      {audioModel && (
        <Item variant="outline">
          <ItemMedia variant="icon"><Gauge className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('options.speed.title')}</ItemTitle>
            <ItemDescription>{t('options.speed.desc')}</ItemDescription>
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
  )
}
