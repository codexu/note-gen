import { SettingPanel } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { ModelSelect } from "./model-select";
import { Gauge } from "lucide-react";
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
      
      const currentModel = models.find(m => m.key === audioModel);
      if (currentModel?.speed !== undefined) {
        setSpeed(currentModel.speed);
      }
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
    
    const updatedModels = models.map(model => {
      if (model.key === audioModel) {
        return { ...model, speed: newSpeed };
      }
      return model;
    });
    setAiModelList(updatedModels);
    
    await store.set('aiModelList', updatedModels);
    await store.save();
  };

  return (
    <>
      <ModelSelect />
      {audioModel && (
        <SettingPanel 
          title={t('options.speed.title')} 
          desc={t('options.speed.desc')} 
          icon={<Gauge className="size-4" />}
        >
          <div className="flex gap-2 py-2">
            <Slider
              className="w-64"
              value={[speed]}
              min={0.25}
              max={4}
              step={0.25}
              onValueChange={handleSpeedChange}
            />
            <span className="text-zinc-500 w-10">{speed}x</span>
          </div>
        </SettingPanel>
      )}
    </>
  )
}
