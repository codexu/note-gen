'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { 
  Globe, 
  Settings, 
  MessageSquare, 
  FileText, 
  Image, 
  Download, 
  Upload,
  Trash2,
  Edit,
  Save,
  Search,
  Tag,
  Camera,
  Link,
  Palette,
  Zap,
  Shield,
  Monitor,
  Sun,
  Moon,
  Languages
} from 'lucide-react'
import { LanguageSwitch } from '@/components/language-switch'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function UITranslationTestPage() {
  const t = useTranslations()

  const settingsSections = [
    {
      key: 'ai',
      icon: <Zap className="h-5 w-5" />,
      title: t('settings.ai.title'),
      description: t('settings.ai.desc')
    },
    {
      key: 'sync',
      icon: <Download className="h-5 w-5" />,
      title: t('settings.sync.title'),
      description: t('settings.sync.desc')
    },
    {
      key: 'theme',
      icon: <Palette className="h-5 w-5" />,
      title: t('settings.theme.title'),
      description: 'Customize application appearance'
    },
    {
      key: 'file',
      icon: <FileText className="h-5 w-5" />,
      title: t('settings.file.title'),
      description: t('settings.file.desc')
    }
  ]

  const recordFeatures = [
    {
      icon: <MessageSquare className="h-5 w-5" />,
      title: 'AI Chat',
      description: t('record.chat.empty.features.0.chat')
    },
    {
      icon: <Link className="h-5 w-5" />,
      title: 'Record Link',
      description: 'Linked with your records'
    },
    {
      icon: <Camera className="h-5 w-5" />,
      title: 'Screenshot',
      description: 'Recognize clipboard records'
    },
    {
      icon: <FileText className="h-5 w-5" />,
      title: 'Organize',
      description: 'Organize your records into notes'
    }
  ]

  return (
    <div className="container mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2">
          <Globe className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">{t('app.title')} - English UI</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          {t('app.description')}
        </p>
        <div className="flex items-center justify-center gap-4">
          <Badge variant="outline" className="flex items-center gap-2">
            <Languages className="h-4 w-4" />
            Multi-language Support
          </Badge>
          <Badge variant="outline" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Complete UI Translation
          </Badge>
        </div>
      </div>

      {/* Language Switch Demo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-5 w-5" />
            Language Selection
          </CardTitle>
          <CardDescription>
            Switch between supported languages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <h3 className="font-medium">Current Language: {t('common.language')}</h3>
              <p className="text-sm text-muted-foreground">
                Change language to see UI translation in action
              </p>
            </div>
            <LanguageSwitch />
          </div>
        </CardContent>
      </Card>

      {/* Common Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Common UI Elements
          </CardTitle>
          <CardDescription>
            Frequently used interface elements with English translations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              {t('common.save')}
            </Button>
            <Button variant="outline" className="flex items-center gap-2">
              <Edit className="h-4 w-4" />
              {t('common.edit')}
            </Button>
            <Button variant="destructive" className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
            </Button>
            <Button variant="secondary" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>
          
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Theme Selection</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder={t('settings.theme.selectTheme')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">
                    <div className="flex items-center gap-2">
                      <Sun className="h-4 w-4" />
                      {t('common.light')}
                    </div>
                  </SelectItem>
                  <SelectItem value="dark">
                    <div className="flex items-center gap-2">
                      <Moon className="h-4 w-4" />
                      {t('common.dark')}
                    </div>
                  </SelectItem>
                  <SelectItem value="system">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4" />
                      {t('common.system')}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Sync Settings</Label>
              <div className="flex items-center space-x-2">
                <Switch id="auto-sync" />
                <Label htmlFor="auto-sync">{t('settings.sync.autoSync')}</Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings Sections */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {t('common.settings')} Sections
          </CardTitle>
          <CardDescription>
            All major settings categories with English labels
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {settingsSections.map((section) => (
              <div key={section.key} className="p-4 border rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  {section.icon}
                  <h3 className="font-medium">{section.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  {section.description}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Record Features */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Record & Chat Features
          </CardTitle>
          <CardDescription>
            Core recording and AI chat functionality
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recordFeatures.map((feature, index) => (
              <div key={index} className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  {feature.icon}
                  <h3 className="font-medium">{feature.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Form Elements */}
      <Card>
        <CardHeader>
          <CardTitle>Form Components</CardTitle>
          <CardDescription>
            Input forms with translated labels and placeholders
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Prompt Title</Label>
              <Input placeholder={t('settings.prompt.promptTitlePlaceholder')} />
            </div>
            <div className="space-y-2">
              <Label>Model Selection</Label>
              <Input placeholder={t('settings.ai.selectModel')} />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>Content</Label>
            <Textarea 
              placeholder={t('settings.prompt.promptContentPlaceholder')}
              className="min-h-[100px]"
            />
          </div>
          
          <div className="flex gap-2">
            <Button>{t('common.save')}</Button>
            <Button variant="outline">{t('common.cancel')}</Button>
          </div>
        </CardContent>
      </Card>

      {/* Status Messages */}
      <Card>
        <CardHeader>
          <CardTitle>Status Messages</CardTitle>
          <CardDescription>
            System status and feedback messages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-green-800">{t('common.success')}: Configuration saved</span>
            </div>
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span className="text-red-800">{t('common.error')}: Unable to connect to server</span>
            </div>
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span className="text-blue-800">Processing: {t('record.queue.ocr')}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* About Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t('settings.about.title')}
          </CardTitle>
          <CardDescription>
            {t('settings.about.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <h3 className="font-medium">Version</h3>
                <p className="text-sm text-muted-foreground">
                  {t('settings.about.version', { version: '1.0.0' })}
                </p>
              </div>
              <Button variant="outline">
                {t('settings.about.checkUpdate')}
              </Button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <Button variant="outline" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t('settings.about.items.releases.buttonName')}
              </Button>
              <Button variant="outline" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {t('settings.about.items.issues.buttonName')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center text-sm text-muted-foreground">
        <p>
          🌍 NoteGen now supports comprehensive English UI translations
        </p>
        <p className="mt-2">
          All interface elements, settings, and messages are available in English
        </p>
      </div>
    </div>
  )
} 