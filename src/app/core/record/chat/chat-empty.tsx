'use client'

import { useTranslations } from 'next-intl'
import useSettingStore from '@/stores/setting'
import usePromptStore from '@/stores/prompt'
import { useMemo } from 'react'
import { Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { isMobileDevice } from '@/lib/check'
import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { TypewriterEffectSmooth } from '@/components/ui/typewriter-effect'

export default function ChatEmpty() {
  const t = useTranslations('record.chat.empty')
  const { aiModelList, primaryModel } = useSettingStore()
  const { currentPrompt } = usePromptStore()
  const router = useRouter()
  const isMobile = isMobileDevice()

  // 获取当前模型名称
  const currentModelName = useMemo(() => {
    if (!primaryModel || !aiModelList) return t('noModel')
    
    // 遍历所有配置查找匹配的模型
    for (const config of aiModelList) {
      // 检查新的 models 数组结构
      if (config.models && config.models.length > 0) {
        const targetModel = config.models.find(model => model.id === primaryModel)
        if (targetModel) {
          return targetModel.model
        }
      } else {
        // 向后兼容：处理旧的单模型结构
        if (config.key === primaryModel) {
          return config.model || config.title
        }
      }
    }
    
    return primaryModel
  }, [primaryModel, aiModelList, t])

  return (
    <div className="relative w-full flex-1 flex flex-col items-center justify-center h-full overflow-hidden">
      {/* Background Ripple Effect - 完全撑开 */}
      <BackgroundRippleEffect />
      
      {/* Gradient fade overlay on edges for better content visibility */}
      <div 
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: `
            linear-gradient(to right, var(--background) 0%, transparent 10%, transparent 90%, var(--background) 100%),
            linear-gradient(to bottom, var(--background) 0%, transparent 10%, transparent 90%, var(--background) 100%)
          `
        }}
      />
      
      {/* Content Container - 单独设置 padding */}
      <div className="relative max-w-[340px] w-full space-y-6 z-20 p-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <TypewriterEffectSmooth
              words={[{ text: t('title') }]}
              className="text-2xl font-semibold tracking-tight"
              cursorClassName="bg-primary h-6 w-0.5 translate-y-1"
            />
          </div>
          <p className="text-muted-foreground text-sm">
            {t('subtitle')}
          </p>
        </div>

        {/* Info Cards - Single Column */}
        <div className="space-y-3">
          {/* Current Model */}
          <div className="px-4 rounded-lg border bg-card">
            <div className="flex h-10 items-center justify-between">
              <span className="text-xs min-w-24 text-muted-foreground">{t('currentModel')}</span>
              <span className="text-sm font-medium truncate ml-2">{currentModelName}</span>
            </div>
          </div>

          {/* Current Prompt */}
          <div className="px-4 rounded-lg border bg-card">
            <div className="flex h-10 items-center justify-between">
              <span className="text-xs min-w-24 text-muted-foreground">{t('currentPrompt')}</span>
              <span className="text-sm font-medium truncate ml-2">
                {currentPrompt?.title || t('noPrompt')}
              </span>
            </div>
          </div>

          <div className="h-2"></div>

          {/* Settings Link */}
          <div className='flex w-full justify-center items-center'>
            <button
              onClick={() => {
                const settingPath = isMobile ? '/mobile/setting/pages/ai' : '/core/setting/ai'
                router.push(settingPath)
              }}
              className="flex items-center justify-center gap-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors text-xs cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              {t('configureModel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}