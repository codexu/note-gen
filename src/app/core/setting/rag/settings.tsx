import { FormItem } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { RefreshCw, Trash } from "lucide-react";
import useRagSettingsStore from "@/stores/ragSettings";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clearVectorDb, initVectorDb } from "@/db/vector";
import { toast } from "@/hooks/use-toast";
import { confirm } from "@tauri-apps/plugin-dialog";

export function Settings() {
  const t = useTranslations('settings.rag');
  
  const { 
    chunkSize, 
    chunkOverlap, 
    resultCount, 
    similarityThreshold,
    initSettings,
    updateSetting,
    resetToDefaults
  } = useRagSettingsStore();

  useEffect(() => {
    initSettings();
  }, []);

  function handleDeleteVector() {
    confirm(t('deleteVectorConfirm')).then(async (result) => {
      if (result) {
        await clearVectorDb()
        await initVectorDb()
        toast({
          title: t('deleteVectorSuccess'),
          variant: 'default',
        })
      }
    })
  }

  const settings = [
    {
      title: t('chunkSize'),
      desc: t('chunkSizeDesc'),
      value: chunkSize,
      min: 100,
      max: 5000,
      step: 100,
      onChange: (value: number) => updateSetting('chunkSize', value)
    },
    {
      title: t('chunkOverlap'),
      desc: t('chunkOverlapDesc'),
      value: chunkOverlap,
      min: 0,
      max: 500,
      step: 50,
      onChange: (value: number) => updateSetting('chunkOverlap', value)
    },
    {
      title: t('resultCount'),
      desc: t('resultCountDesc'),
      value: resultCount,
      min: 1,
      max: 10,
      step: 1,
      onChange: (value: number) => updateSetting('resultCount', value)
    },
    {
      title: t('similarityThreshold'),
      desc: t('similarityThresholdDesc'),
      value: similarityThreshold,
      min: 0,
      max: 1,
      step: 0.01,
      onChange: (value: number) => updateSetting('similarityThreshold', value)
    }
  ]

  return (
    <Card className="rounded-lg border shadow-sm">
      <CardHeader>
        <CardTitle>{t('settingsTitle')}</CardTitle>
        <CardDescription>{t('settingsDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {settings.map((setting) => (
            <FormItem key={setting.title} title={setting.title} desc={setting.desc}>
              <div className="flex items-center gap-2">
              <Slider
                className="w-full md:w-96 my-2"
                value={[setting.value]}
                min={setting.min}
                max={setting.max}
                step={setting.step}
                onValueChange={(value) => setting.onChange(value[0])}
              />
              <span className="text-secondary-foreground text-sm">{setting.value}</span>
            </div>
            </FormItem>
          ))}
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          <Button variant="outline" onClick={resetToDefaults}>
            <RefreshCw className="size-4" /> {t('resetToDefaults')}
          </Button>
          <Button variant="destructive" onClick={handleDeleteVector}>
            <Trash className="size-4" /> {t('deleteVector')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}