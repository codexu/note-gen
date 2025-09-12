'use client'
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gem, Move3D, Eye, MessageSquare } from "lucide-react";
import Image from 'next/image';
import { open } from '@tauri-apps/plugin-shell'

export default function DefaultModelsSection() {
  const t = useTranslations('settings.ai.defaultModels');
  const { theme, systemTheme } = useTheme();
  
  // 确定当前主题
  const currentTheme = theme === 'system' ? systemTheme : theme;
  const isDark = currentTheme === 'dark';
  
  // SiliconFlow 图片URL
  const siliconFlowImageUrl = isDark 
    ? 'https://s2.loli.net/2025/09/10/KWPOA5XhIGmYTV9.png'
    : 'https://s2.loli.net/2025/09/10/gVhlriQ81PJabSY.png';

  const models = [
    {
      name: t('chatModel.name'),
      type: t('chatModel.type'),
      desc: t('chatModel.desc'),
      icon: <MessageSquare className="h-5 w-5" />,
      color: 'bg-blue-500'
    },
    {
      name: t('embeddingModel.name'),
      type: t('embeddingModel.type'),
      desc: t('embeddingModel.desc'),
      icon: <Move3D className="h-5 w-5" />,
      color: 'bg-green-500'
    },
    {
      name: t('visionModel.name'),
      type: t('visionModel.type'),
      desc: t('visionModel.desc'),
      icon: <Eye className="h-5 w-5" />,
      color: 'bg-purple-500'
    }
  ];

  function openInBrowser() {
    open('https://cloud.siliconflow.cn/i/O2ciJeZw')
  }

  return (
    <Card className="mb-6 relative">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gem className="h-5 w-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {t('desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 模型列表 */}
        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-3">
          {models.map((model, index) => (
            <div key={index} className="flex items-start gap-3 p-4 rounded-lg border bg-card">
              <div className={`p-2 rounded-md ${model.color} text-white`}>
                {model.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-xs">
                    {model.type}
                  </Badge>
                </div>
                <h4 className="font-medium text-sm mb-1 truncate">
                  {model.name}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {model.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
        <Image
          src={siliconFlowImageUrl}
          alt="SiliconFlow"
          width={240}
          height={60}
          className="h-10 w-auto object-contain cursor-pointer hover:shadow"
          unoptimized
          onClick={openInBrowser}
        />
      </CardContent>
    </Card>
  );
}
