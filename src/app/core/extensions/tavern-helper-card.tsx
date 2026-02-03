'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Wand2, Settings, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useExtensionsStore } from '@/stores/extensions'
import { TAVERN_HELPER_VERSION } from '@/lib/tavern-helper/core/types'

export function TavernHelperCard() {
  const t = useTranslations('extensions.tavernHelper')
  const { tavernHelper, setTavernHelperEnabled, updateTavernHelperSettings } = useExtensionsStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleToggle = async (enabled: boolean) => {
    await setTavernHelperEnabled(enabled)
  }

  const handleLogLevelChange = async (level: string) => {
    await updateTavernHelperSettings({ logLevel: level })
  }

  const handleConsoleToggle = async (enabled: boolean) => {
    await updateTavernHelperSettings({ enableConsole: enabled })
  }

  const handleMaxHistoryChange = async (value: string) => {
    const num = parseInt(value, 10)
    if (!isNaN(num) && num > 0) {
      await updateTavernHelperSettings({ maxHistory: num })
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Wand2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {t('name')}
                <span className="text-xs font-normal text-muted-foreground px-2 py-0.5 bg-muted rounded">
                  v{TAVERN_HELPER_VERSION.toString()}
                </span>
              </CardTitle>
              <CardDescription className="mt-1">
                {t('description')}
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={tavernHelper.enabled}
            onCheckedChange={handleToggle}
          />
        </div>
      </CardHeader>

      {tavernHelper.enabled && (
        <CardContent className="pt-0">
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  {t('settings.title')}
                </span>
                {settingsOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              {/* 日志级别 */}
              <div className="flex items-center justify-between">
                <div>
                  <Label>{t('settings.logLevel.label')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.logLevel.description')}
                  </p>
                </div>
                <Select
                  value={tavernHelper.settings.logLevel as string}
                  onValueChange={handleLogLevelChange}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debug">Debug</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warn">Warn</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 控制台输出 */}
              <div className="flex items-center justify-between">
                <div>
                  <Label>{t('settings.console.label')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.console.description')}
                  </p>
                </div>
                <Switch
                  checked={tavernHelper.settings.enableConsole as boolean}
                  onCheckedChange={handleConsoleToggle}
                />
              </div>

              {/* 历史记录上限 */}
              <div className="flex items-center justify-between">
                <div>
                  <Label>{t('settings.maxHistory.label')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.maxHistory.description')}
                  </p>
                </div>
                <Input
                  type="number"
                  className="w-32"
                  value={tavernHelper.settings.maxHistory as number}
                  onChange={(e) => handleMaxHistoryChange(e.target.value)}
                  min={100}
                  max={10000}
                />
              </div>

              {/* 功能列表 */}
              <div className="pt-2 border-t">
                <Label className="text-sm font-medium">{t('features.title')}</Label>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>• {t('features.variables')}</li>
                  <li>• {t('features.messages')}</li>
                  <li>• {t('features.generate')}</li>
                  <li>• {t('features.macros')}</li>
                  <li>• {t('features.inject')}</li>
                  <li>• {t('features.events')}</li>
                </ul>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      )}
    </Card>
  )
}
