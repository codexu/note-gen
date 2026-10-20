'use client'
import { useState, useEffect, useRef } from "react";
import { useTranslations } from 'next-intl';
import { useLocalStorage } from 'react-use';
import { motion, useReducedMotion } from 'framer-motion';
import { Store } from "@tauri-apps/plugin-store";
import { v4 } from 'uuid';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ResponsiveSelect } from "@/components/responsive-select"
import { SettingType } from "../components/setting-base";
import { AiConfig, ModelConfig, ProxyMode, builtinProviderTemplates } from "../config";
import useSettingStore from "@/stores/setting";
import { noteGenModelKeys } from "@/app/model-config";
import { BotMessageSquare, Copy, Eye, EyeOff, KeyRound, LoaderCircle, Network, Plus, Server, Settings2, Trash2, X } from "lucide-react";
import { OpenBroswer } from "@/components/open-broswer";
import DefaultModelsSection from "./default-models";
import ModelCard from "./model-card";
import CreateConfig from "./create";
import { getCachedProviderTemplates, getProviderTemplateMatch, loadProviderTemplates } from "@/lib/ai/provider-templates-runtime";
import { isValidProxyURL } from "@/lib/ai/tauri-client";
import { excludeBuiltInOpenAIProviders, isMainlandChinaAppStore } from "@/lib/ai/storefront-policy";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

function getPlatformAvatarFallback(config: AiConfig) {
  const characterCount = config.templateSource === 'custom' ? 1 : 2
  const fallback = Array.from(config.title.trim()).slice(0, characterCount).join('').toUpperCase()
  return fallback || (config.templateSource === 'custom' ? '自' : 'AI')
}

function getCustomPlatformAvatarStyle(config: AiConfig) {
  if (config.templateSource !== 'custom') return undefined

  const platformName = config.title.trim() || '自定义平台'
  const hash = Array.from(platformName).reduce((value, character) => (
    Math.imul(value, 31) + (character.codePointAt(0) || 0)
  ), 17)
  const hue = Math.abs(hash) % 360

  return {
    backgroundColor: `hsl(${hue} 62% 42%)`,
    color: 'white',
  }
}

function getProviderPromotion(config: AiConfig, template?: AiConfig | null) {
  return template?.promotion || config.promotion
}

function getProviderOptionLabel(config: AiConfig, template?: AiConfig | null) {
  const count = config.models?.filter(model => model.model.trim()).length || 0
  return <ProviderTitle config={config} template={template} modelCount={count} />
}

function ProviderTitle({ config, template, modelCount }: { config: AiConfig; template?: AiConfig | null; modelCount?: number }) {
  const t = useTranslations('common.providerSponsor')
  const aiText = useTranslations('settings.ai')
  const shouldReduceMotion = useReducedMotion()
  const hasModels = modelCount !== undefined && modelCount > 0
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 240, damping: 28, mass: 0.8 }
  const sponsored = template ? template.sponsored === true : config.sponsored === true
  const promotion = getProviderPromotion(config, template)
  return (
    <motion.span initial="rest" whileHover="hovered" whileFocus="hovered" className="flex min-w-0 w-full items-center justify-start gap-1.5 text-left">
      <span className="min-w-0 flex-1 truncate" title={config.title}>{config.title}</span>
      <span className="grid h-5 shrink-0 items-center overflow-hidden">
        <motion.span
          className="col-start-1 row-start-1 inline-flex h-full items-center justify-self-end gap-1.5"
          variants={{
            rest: { y: '0%', opacity: 1 },
            hovered: { y: hasModels ? '-100%' : '0%', opacity: hasModels ? 0 : 1 },
          }}
          transition={hasModels ? transition : { duration: 0 }}
        >
          {sponsored && (
            <Badge variant="secondary" title={t('description')} aria-label={`${t('label')}: ${t('description')}`}>
              {t('label')}
            </Badge>
          )}
          {promotion && <ProviderPromotionText promotion={promotion} />}
        </motion.span>
        {hasModels && (
          <motion.span
            className="pointer-events-none col-start-1 row-start-1 flex h-full items-center justify-self-end"
            variants={{ rest: { y: '100%', opacity: 0 }, hovered: { y: '0%', opacity: 1 } }}
            transition={transition}
            title={aiText('modelCount', { count: modelCount })}
          >
            <Badge variant="secondary" className="tabular-nums" aria-label={aiText('modelCount', { count: modelCount })}>
              {modelCount}
            </Badge>
          </motion.span>
        )}
      </span>
    </motion.span>
  )
}

function ProviderPromotionText({ promotion }: { promotion: string }) {
  const shouldReduceMotion = useReducedMotion()

  return (
      <motion.span
        title={promotion}
        animate={shouldReduceMotion ? undefined : { backgroundPosition: ['0% 50%', '100% 50%'] }}
        className="shrink-0 whitespace-nowrap bg-clip-text text-xs font-medium text-transparent"
        style={{
          backgroundImage: 'linear-gradient(90deg, hsl(var(--promotion-gradient-start)) 0%, hsl(var(--promotion-gradient-middle)) 16.667%, hsl(var(--promotion-gradient-end)) 33.333%, hsl(var(--promotion-gradient-start)) 50%, hsl(var(--promotion-gradient-middle)) 66.667%, hsl(var(--promotion-gradient-end)) 83.333%, hsl(var(--promotion-gradient-start)) 100%)',
          backgroundPosition: '0% 50%',
          backgroundSize: '200% 100%',
        }}
        transition={{ duration: 6, ease: 'linear', repeat: Infinity, repeatType: 'loop' }}
      >
        {promotion}
      </motion.span>
  )
}

export default function AiPage({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations('settings.ai');
  const {
    aiModelList,
    setAiModelList
  } = useSettingStore()
  const [hideBuiltInOpenAI, setHideBuiltInOpenAI] = useState<boolean | null>(null)

  // 过滤掉默认模型，只显示用户自定义模型
  const visibleAiModelList = hideBuiltInOpenAI !== false
    ? excludeBuiltInOpenAIProviders(aiModelList)
    : aiModelList
  const userCustomModels = visibleAiModelList.filter(model => !noteGenModelKeys.includes(model.key) && model.title !== 'NoteGen Limited')
  const [apiKeyVisible, setApiKeyVisible] = useState<boolean>(false)
  const [headerPairs, setHeaderPairs] = useState<Array<{key: string, value: string, id: string}>>([])
  const [expandedModels, setExpandedModels] = useState<string[]>([])
  const [providerTemplates, setProviderTemplates] = useState<AiConfig[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [addingTemplateKey, setAddingTemplateKey] = useState('')
  const [activeTab, setActiveTab] = useState('connection')
  const aiModelListRef = useRef(aiModelList)
  const isTitleComposingRef = useRef(false)

  useEffect(() => {
    aiModelListRef.current = aiModelList
  }, [aiModelList])
  
  // 使用 useLocalStorage 记录当前选择的AI配置
  const [selectedAiConfig, setSelectedAiConfig] = useLocalStorage<string>('ai-config-selected', '')
  
  // 当前选中的AI配置
  const currentConfig = userCustomModels.find(model => model.key === selectedAiConfig)
  const currentProviderTemplate = currentConfig?.templateSource === 'custom'
    ? null
    : getProviderTemplateMatch(currentConfig, providerTemplates)
  const currentPlatformNameEditable = currentConfig?.templateSource === 'custom' || !currentProviderTemplate
  const proxyURLInvalid = currentConfig?.proxyMode === 'custom' && !isValidProxyURL(currentConfig.proxyURL)
  const getConfiguredModelCount = (config: AiConfig) => config.models?.filter(model => model.model.trim()).length || 0
  const sortedUserCustomModels = [...userCustomModels].sort((left, right) => (
    getConfiguredModelCount(right) - getConfiguredModelCount(left)
  ))
  const configuredModelCount = currentConfig ? getConfiguredModelCount(currentConfig) : 0
  const providerConfigured = Boolean(currentConfig?.baseURL && configuredModelCount > 0)
  const configuredTemplateKeys = new Set(userCustomModels.flatMap(config => {
    if (config.templateSource === 'custom') return []
    const template = getProviderTemplateMatch(config, providerTemplates)
    return template ? [template.templateKey || template.key] : []
  }))
  const availableProviderTemplates = providerTemplates.filter(template => (
    !configuredTemplateKeys.has(template.templateKey || template.key)
  ))
  
  const parseHeadersToKeyValue = (headers: Record<string, string> = {}) => {
    return Object.entries(headers).map(([key, value]) => ({
      key, value: String(value), id: Math.random().toString(36).substr(2, 9)
    }))
  }

  const convertKeyValueToJson = (pairs: Array<{key: string, value: string}>) => {
    const obj: Record<string, string> = {}
    pairs.forEach(pair => { if (pair.key.trim()) obj[pair.key.trim()] = pair.value })
    return obj
  }

  // 添加新模型
  const addNewModel = async () => {
    if (!currentConfig) return
    
    const newModelId = v4()
    const newModel: ModelConfig = {
      id: newModelId,
      model: '',
      modelType: 'chat',
      temperature: 0.7,
      topP: 1.0,
      enableStream: true
    }
    
    const updatedConfig = {
      ...currentConfig,
      models: [...(currentConfig.models || []), newModel]
    }
    
    await updateAiConfig(updatedConfig)
    
    // 自动展开新创建的模型
    setExpandedModels(prev => [...prev, newModelId])
  }

  // 删除模型
  const deleteModel = async (modelId: string) => {
    if (!currentConfig) return
    
    const confirmed = await confirm('确定要删除这个模型吗？')
    if (!confirmed) return
    
    const updatedConfig = {
      ...currentConfig,
      models: (currentConfig.models || []).filter(m => m.id !== modelId)
    }
    
    await updateAiConfig(updatedConfig)
    
    // 从展开列表中移除被删除的模型
    setExpandedModels(prev => prev.filter(id => id !== modelId))
  }

  // 更新模型配置
  const updateModelConfig = async <K extends keyof ModelConfig>(modelId: string, field: K, value: ModelConfig[K]) => {
    if (!currentConfig) return
    
    const updatedModels = (currentConfig.models || []).map(model => 
      model.id === modelId ? { ...model, [field]: value } : model
    )
    
    const updatedConfig = {
      ...currentConfig,
      models: updatedModels
    }
    
    await updateAiConfig(updatedConfig)
  }

  // 更新AI配置到store
  const updateAiConfig = async (config: AiConfig) => {
    const updatedList = aiModelListRef.current.map(item =>
      item.key === config.key ? config : item
    )

    if (!updatedList.some(item => item.key === config.key)) return

    // Keep input state in sync with native IME composition. Waiting for the
    // async store round trip before updating React state resets the input to an
    // older composition value and duplicates partial Pinyin syllables.
    aiModelListRef.current = updatedList
    setAiModelList(updatedList)

  }

  const addProviderFromTemplate = async (template: AiConfig) => {
    const templateKey = template.templateKey || template.key
    if (addingTemplateKey || configuredTemplateKeys.has(templateKey)) return

    setAddingTemplateKey(templateKey)
    try {
      const id = v4()
      const newProvider: AiConfig = {
        ...template,
        key: id,
        templateKey,
        templateSource: template.templateSource || 'builtin',
        modelType: 'chat',
      }
      const updatedList = [newProvider, ...aiModelListRef.current]
      const store = await Store.load('store.json')

      await store.set('aiModelList', updatedList)
      await store.save()
      aiModelListRef.current = updatedList
      setAiModelList(updatedList)
      setSelectedAiConfig(id)
      setActiveTab('connection')
    } finally {
      setAddingTemplateKey('')
    }
  }

  // 复制当前配置
  const copyConfig = async () => {
    if (!currentConfig) return

    const id = v4()
    const newConfig: AiConfig = {
      ...currentConfig,
      key: id,
      title: `${currentConfig.title || 'Copy'} (Copy)`,
      // 复制models数组
      models: currentConfig.models?.map(model => ({
        ...model,
        id: v4() // 给每个模型生成新的ID
      })) || []
    }

    const store = await Store.load('store.json')
    const aiModelList = await store.get<AiConfig[]>('aiModelList') || []
    const updatedList = [...aiModelList, newConfig]
    
    await store.set('aiModelList', updatedList)
    setAiModelList(updatedList)
    setSelectedAiConfig(newConfig.key)
  }

  // 删除当前配置
  const deleteCurrentConfig = async () => {
    if (!currentConfig) return
    
    // 检查是否是NoteGen默认模型
    if (noteGenModelKeys.includes(currentConfig.key)) {
      return // 不能删除默认模型
    }

    const confirmed = await confirm(t('deleteCustomModelConfirm'))
    if (!confirmed) return

    const store = await Store.load('store.json')
    const aiModelList = await store.get<AiConfig[]>('aiModelList') || []
    const updatedList = aiModelList.filter(item => item.key !== currentConfig.key)
    
    await store.set('aiModelList', updatedList)
    setAiModelList(updatedList)

    // 删除后选择下一个用户自定义模型
    const remainingUserModels = updatedList.filter(model => !noteGenModelKeys.includes(model.key))
    if (remainingUserModels.length > 0) {
      setSelectedAiConfig(remainingUserModels[0].key)
    } else {
      setSelectedAiConfig('')
    }
  }


  // 迁移旧配置到新格式
  const migrateOldConfig = (config: AiConfig): AiConfig => {
    // 如果已经有models数组，直接返回
    if (config.models && config.models.length > 0) {
      return config
    }
    
    // 如果有旧的model配置，迁移到models数组
    if (config.model) {
      const migratedModel: ModelConfig = {
        id: v4(),
        model: config.model,
        modelType: config.modelType || 'chat',
        temperature: config.temperature,
        topP: config.topP,
        voice: config.voice,
        enableStream: config.enableStream,
        maxTokens: config.maxTokens,
        contextWindow: config.contextWindow,
        tokenLimitParam: config.tokenLimitParam,
        enableWebSearch: config.enableWebSearch,
        webSearchProvider: config.webSearchProvider,
        webSearchApiKey: config.webSearchApiKey,
      }
      
      return {
        ...config,
        models: [migratedModel]
      }
    }
    
    return config
  }

  // 当选中的配置改变时，更新headers
  useEffect(() => {
    if (currentConfig) {
      setHeaderPairs(parseHeadersToKeyValue(currentConfig.customHeaders))
      setApiKeyVisible(false)
    } else {
      setHeaderPairs([])
    }
  }, [currentConfig])

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json')
      const shouldHideBuiltInOpenAI = await isMainlandChinaAppStore()
      setHideBuiltInOpenAI(shouldHideBuiltInOpenAI)
      let templates: AiConfig[] = []
      try {
        const cachedTemplates = await getCachedProviderTemplates()
        if (cachedTemplates.length > 0) {
          setProviderTemplates(shouldHideBuiltInOpenAI
            ? excludeBuiltInOpenAIProviders(cachedTemplates)
            : cachedTemplates)
          setLoadingTemplates(false)
        }

        templates = await loadProviderTemplates(builtinProviderTemplates)
        if (shouldHideBuiltInOpenAI) {
          templates = excludeBuiltInOpenAIProviders(templates)
        }
        setProviderTemplates(templates)
      } finally {
        setLoadingTemplates(false)
      }

      // 模板平台是默认平台：只补齐缺失项，不修改任何已有用户配置。
      // 再次读取 Store，避免模板加载期间用户新建的平台被旧快照覆盖。
      const storedAiModelList = await store.get<AiConfig[]>('aiModelList') || []
      const migratedList = storedAiModelList.map(migrateOldConfig)
      const existingPlatforms = migratedList.filter(model => (
        !noteGenModelKeys.includes(model.key) && model.title !== 'NoteGen Limited'
      ))
      const missingTemplates = templates.filter(template => {
        const templateKey = template.templateKey || template.key
        return !existingPlatforms.some(config => {
          if (config.templateSource === 'custom') return false
          if (config.templateKey === templateKey) return true
          return Boolean(config.baseURL && template.baseURL && config.baseURL === template.baseURL)
        })
      })
      const defaultPlatforms = missingTemplates.map(template => ({
        ...template,
        key: v4(),
        templateKey: template.templateKey || template.key,
        templateSource: template.templateSource || 'builtin' as const,
        modelType: 'chat' as const,
      }))
      const nextAiModelList = [...migratedList, ...defaultPlatforms]
      const hasChanges = defaultPlatforms.length > 0 || migratedList.some((config, index) => (
        JSON.stringify(config) !== JSON.stringify(storedAiModelList[index])
      ))

      if (hasChanges) {
        await store.set('aiModelList', nextAiModelList)
        await store.save()
      }
      aiModelListRef.current = nextAiModelList
      setAiModelList(nextAiModelList)

      const userModels = nextAiModelList.filter(model => (
        !noteGenModelKeys.includes(model.key) && model.title !== 'NoteGen Limited'
      ))
      
      // 如果已经有保存的选择，且该配置仍然存在，则使用它
      if (selectedAiConfig && userModels.find(model => model.key === selectedAiConfig)) {
        // 已经有保存的选择，不需要做任何事情
        return
      } else if (userModels.length > 0) {
        // 如果没有保存的选择或选择的配置不存在，选择第一个
        const firstUserModel = userModels[0]
        setSelectedAiConfig(firstUserModel.key)
      } else {
        // 如果没有用户自定义模型，清空选择
        setSelectedAiConfig('')
      }
    }
    init()
  }, [])

  return (
    <SettingType id="ai" icon={<BotMessageSquare />} title={t('title')} desc={t('desc')}>
      {userCustomModels.length === 0 && <DefaultModelsSection />}
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <Card size="sm" className="lg:sticky lg:top-2">
              <CardHeader>
                <CardTitle>{t('providerListTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="lg:hidden">
                  <ResponsiveSelect
                    title={t('selectConfig')}
                    value={selectedAiConfig || ''}
                    placeholder={t('selectConfig')}
                    onValueChange={value => {
                      if (value.startsWith('template:')) {
                        const templateKey = value.slice('template:'.length)
                        const template = availableProviderTemplates.find(item => (item.templateKey || item.key) === templateKey)
                        if (template) void addProviderFromTemplate(template)
                      } else {
                        setSelectedAiConfig(value)
                        setActiveTab('connection')
                      }
                    }}
                    options={[
                      ...sortedUserCustomModels.map(provider => {
                        const template = provider.templateSource === 'custom'
                          ? null
                          : getProviderTemplateMatch(provider, providerTemplates)
                        return {
                          value: provider.key,
                          label: getProviderOptionLabel(provider, template),
                        }
                      }),
                      ...availableProviderTemplates.map(template => ({
                        value: `template:${template.templateKey || template.key}`,
                        label: getProviderOptionLabel(template),
                      })),
                    ]}
                  />
                </div>

                <div className="app-panel-scrollbar hidden max-h-[52vh] flex-col gap-3 overflow-y-auto pr-1 lg:flex">
                  <ItemGroup className="gap-2">
                    {sortedUserCustomModels.map(provider => {
                      const selected = provider.key === selectedAiConfig
                      const count = getConfiguredModelCount(provider)
                      const providerTemplate = provider.templateSource === 'custom'
                        ? null
                        : getProviderTemplateMatch(provider, providerTemplates)
                      return (
                        <Item
                          className="group/provider flex-nowrap text-left data-[state=on]:border-primary data-[state=on]:bg-primary/5"
                          data-state={selected ? 'on' : 'off'}
                          key={provider.key}
                          asChild
                          variant="outline"
                          size="sm"
                        >
                          <motion.button initial="rest" whileHover="hovered" whileFocus="hovered" type="button" onClick={() => {
                            setSelectedAiConfig(provider.key)
                            setActiveTab('connection')
                          }}>
                            <ItemMedia variant="default" className="shrink-0">
                              <Avatar size="sm">
                                <AvatarImage src={providerTemplate?.icon || provider.icon} alt={provider.title} />
                                <AvatarFallback
                                  className={provider.templateSource === 'custom' ? 'text-base font-semibold' : undefined}
                                  style={getCustomPlatformAvatarStyle(provider)}
                                >
                                  {getPlatformAvatarFallback(provider)}
                                </AvatarFallback>
                              </Avatar>
                            </ItemMedia>
                            <ItemContent className="min-w-0">
                              <ItemTitle className="min-w-0 w-full"><ProviderTitle config={provider} template={providerTemplate} modelCount={count} /></ItemTitle>
                            </ItemContent>
                          </motion.button>
                        </Item>
                      )
                    })}
                  </ItemGroup>

                  {loadingTemplates ? (
                    <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                      <LoaderCircle className="animate-spin" />{t('loadingProviderTemplates')}
                    </div>
                  ) : null}

                  {availableProviderTemplates.map(template => {
                    const templateKey = template.templateKey || template.key
                    return (
                      <Item className="group/provider flex-nowrap text-left" key={templateKey} asChild variant="outline" size="sm">
                        <motion.button
                          initial="rest"
                          whileHover="hovered"
                          whileFocus="hovered"
                          type="button"
                          disabled={Boolean(addingTemplateKey)}
                          onClick={() => void addProviderFromTemplate(template)}
                        >
                          <ItemMedia variant="default" className="shrink-0">
                            <Avatar size="sm">
                              <AvatarImage src={template.icon} alt={template.title} />
                              <AvatarFallback>{getPlatformAvatarFallback(template)}</AvatarFallback>
                            </Avatar>
                          </ItemMedia>
                          <ItemContent className="min-w-0">
                            <ItemTitle className="min-w-0 w-full"><ProviderTitle config={template} modelCount={0} /></ItemTitle>
                          </ItemContent>
                          {addingTemplateKey === templateKey ? (
                            <ItemActions><LoaderCircle className="animate-spin" /></ItemActions>
                          ) : null}
                        </motion.button>
                      </Item>
                    )
                  })}
                </div>

                <div className="border-t pt-3 [&>button]:w-full">
                  <CreateConfig
                    onConfigCreated={(configId) => setSelectedAiConfig(configId)}
                  />
                </div>
              </CardContent>
            </Card>

            {currentConfig ? (
              <div className="flex min-w-0 flex-col gap-4">
                <Card>
                  <CardHeader>
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar>
                        <AvatarImage src={currentProviderTemplate?.icon || currentConfig.icon} alt={currentConfig.title} />
                        <AvatarFallback
                          className={currentConfig.templateSource === 'custom' ? 'text-base font-semibold' : undefined}
                          style={getCustomPlatformAvatarStyle(currentConfig)}
                        >
                          {getPlatformAvatarFallback(currentConfig)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="flex flex-wrap items-center gap-2">
                          {currentPlatformNameEditable ? (
                            <Input
                              aria-label={t('modelTitle')}
                              className="h-8 w-52 max-w-full font-semibold"
                              key={currentConfig.key}
                              defaultValue={currentConfig.title}
                              onChange={(event) => {
                                if (isTitleComposingRef.current) return
                                void updateAiConfig({ ...currentConfig, title: event.target.value })
                              }}
                              onCompositionStart={() => { isTitleComposingRef.current = true }}
                              onCompositionEnd={(event) => {
                                const input = event.currentTarget
                                window.setTimeout(() => {
                                  isTitleComposingRef.current = false
                                  void updateAiConfig({ ...currentConfig, title: input.value })
                                }, 0)
                              }}
                            />
                          ) : (
                            <span className="truncate">{currentConfig.title}</span>
                          )}
                          <Badge variant={providerConfigured ? 'secondary' : 'outline'}>
                            {providerConfigured ? t('providerReady') : t('providerIncomplete')}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="truncate">{currentConfig.baseURL || t('endpointMissing')}</CardDescription>
                      </div>
                    </div>
                    {mobile ? (
                      <div className="mt-2 grid w-full grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          className="w-full"
                          aria-label={t('copyConfig')}
                          onClick={copyConfig}
                        >
                          <Copy data-icon="inline-start" />
                          {t('copyConfig')}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          aria-label={t('deleteCustomModel')}
                          onClick={deleteCurrentConfig}
                        >
                          <Trash2 data-icon="inline-start" />
                          {t('deleteCustomModel')}
                        </Button>
                      </div>
                    ) : (
                      <CardAction className="flex gap-2">
                        <Button variant="outline" size="sm" aria-label={t('copyConfig')} onClick={copyConfig}>
                          <Copy data-icon="inline-start" />{t('copyConfig')}
                        </Button>
                        <Button variant="outline" size="icon-sm" aria-label={t('deleteCustomModel')} onClick={deleteCurrentConfig}>
                          <Trash2 />
                        </Button>
                      </CardAction>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline"><Server />{t('modelCount', { count: configuredModelCount })}</Badge>
                      <Badge variant="outline"><Network />{currentConfig.proxyMode === 'direct' ? t('proxyModeDirect') : currentConfig.proxyMode === 'custom' ? t('proxyModeCustom') : t('proxyModeInherit')}</Badge>
                      {currentProviderTemplate ? <Badge variant="outline">{t('templateProvider')}</Badge> : <Badge variant="outline">{t('customProvider')}</Badge>}
                    </div>
                  </CardContent>
                </Card>

                <Tabs orientation="horizontal" value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className={mobile ? "grid !h-11 w-full grid-cols-2 items-center !overflow-hidden !p-1" : "grid h-9 w-full grid-cols-2"}>
                    <TabsTrigger
                      className={mobile ? "!h-9 !min-h-9 !justify-center !py-0" : "!justify-center"}
                      value="connection"
                    >
                      <Settings2 data-icon="inline-start" />{t('connectionTab')}
                    </TabsTrigger>
                    <TabsTrigger
                      className={mobile ? "!h-9 !min-h-9 !justify-center !py-0" : "!justify-center"}
                      value="models"
                    >
                      <BotMessageSquare data-icon="inline-start" />{t('modelsTab')}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="connection">
                    <Card>
                      <CardHeader>
                        <CardTitle>{t('connectionTitle')}</CardTitle>
                        <CardDescription>{t('connectionDesc')}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <FieldGroup>
                          <Field>
                            <FieldLabel htmlFor={`provider-url-${currentConfig.key}`}>{t('apiEndpoint')}</FieldLabel>
                            <Input
                              id={`provider-url-${currentConfig.key}`}
                              value={currentConfig.baseURL || ''}
                              placeholder="https://api.example.com/v1"
                              onChange={event => void updateAiConfig({ ...currentConfig, baseURL: event.target.value })}
                            />
                            <FieldDescription>{t('modelBaseUrlDesc')}</FieldDescription>
                          </Field>

                          <Field>
                            <FieldLabel htmlFor={`provider-key-${currentConfig.key}`}>API Key</FieldLabel>
                            <InputGroup>
                              <InputGroupAddon><KeyRound /></InputGroupAddon>
                              <InputGroupInput
                                id={`provider-key-${currentConfig.key}`}
                                value={currentConfig.apiKey || ''}
                                type={apiKeyVisible ? 'text' : 'password'}
                                placeholder={t('apiKeyPlaceholder')}
                                onChange={event => void updateAiConfig({ ...currentConfig, apiKey: event.target.value })}
                              />
                              <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                  size="icon-xs"
                                  aria-label={apiKeyVisible ? t('hideApiKey') : t('showApiKey')}
                                  onClick={() => setApiKeyVisible(current => !current)}
                                >
                                  {apiKeyVisible ? <EyeOff /> : <Eye />}
                                </InputGroupButton>
                              </InputGroupAddon>
                            </InputGroup>
                            {currentProviderTemplate?.apiKeyUrl ? (
                              <FieldDescription><OpenBroswer url={currentProviderTemplate.apiKeyUrl} title={t('apiKeyUrl')} /></FieldDescription>
                            ) : null}
                          </Field>

                          <Field data-invalid={proxyURLInvalid || undefined}>
                            <FieldLabel>{t('proxyModeTitle')}</FieldLabel>
                            <ResponsiveSelect
                              title={t('proxyModeTitle')}
                              value={currentConfig.proxyMode || 'inherit'}
                              onValueChange={value => void updateAiConfig({ ...currentConfig, proxyMode: value as ProxyMode })}
                              options={[
                                { value: 'inherit', label: t('proxyModeInherit') },
                                { value: 'direct', label: t('proxyModeDirect') },
                                { value: 'custom', label: t('proxyModeCustom') },
                              ]}
                            />
                            {currentConfig.proxyMode === 'custom' ? (
                              <Input
                                id="ai-provider-proxy-url"
                                value={currentConfig.proxyURL || ''}
                                placeholder={t('proxyURLPlaceholder')}
                                aria-invalid={proxyURLInvalid}
                                aria-describedby={proxyURLInvalid ? 'ai-provider-proxy-url-error' : undefined}
                                onChange={event => void updateAiConfig({ ...currentConfig, proxyURL: event.target.value })}
                              />
                            ) : null}
                            {proxyURLInvalid ? <FieldError id="ai-provider-proxy-url-error">{t('proxyURLInvalid')}</FieldError> : null}
                            <FieldDescription>{t('proxyModeDesc')}</FieldDescription>
                          </Field>

                          {!currentProviderTemplate ? (
                            <Collapsible>
                              <Card size="sm">
                                <CardHeader>
                                  <CardTitle>{t('customHeaders')}</CardTitle>
                                  <CardDescription>{t('customHeadersDesc')}</CardDescription>
                                  <CardAction>
                                    <CollapsibleTrigger asChild>
                                      <Button variant="ghost" size="sm">{t('manageHeaders')}</Button>
                                    </CollapsibleTrigger>
                                  </CardAction>
                                </CardHeader>
                                <CollapsibleContent>
                                  <CardContent>
                                    <FieldGroup>
                                      {headerPairs.map((pair, index) => (
                                        <Field
                                          key={pair.id}
                                          orientation={mobile ? 'vertical' : 'horizontal'}
                                          className={mobile ? 'rounded-lg border p-2' : undefined}
                                        >
                                          <Input
                                            aria-label={t('headerKey')}
                                            placeholder={t('headerKey')}
                                            value={pair.key}
                                            onChange={event => {
                                              const pairs = [...headerPairs]
                                              pairs[index] = { ...pairs[index], key: event.target.value }
                                              setHeaderPairs(pairs)
                                              void updateAiConfig({
                                                ...currentConfig,
                                                customHeaders: convertKeyValueToJson(pairs),
                                              })
                                            }}
                                          />
                                          <Input
                                            aria-label={t('headerValue')}
                                            placeholder={t('headerValue')}
                                            value={pair.value}
                                            onChange={event => {
                                              const pairs = [...headerPairs]
                                              pairs[index] = { ...pairs[index], value: event.target.value }
                                              setHeaderPairs(pairs)
                                              void updateAiConfig({
                                                ...currentConfig,
                                                customHeaders: convertKeyValueToJson(pairs),
                                              })
                                            }}
                                          />
                                          <Button
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label={t('removeHeader')}
                                            onClick={() => {
                                              const pairs = headerPairs.filter((_, pairIndex) => pairIndex !== index)
                                              setHeaderPairs(pairs)
                                              void updateAiConfig({ ...currentConfig, customHeaders: convertKeyValueToJson(pairs) })
                                            }}
                                          ><X /></Button>
                                        </Field>
                                      ))}
                                      <Button
                                        variant="outline"
                                        onClick={() => setHeaderPairs(current => [...current, { key: '', value: '', id: v4() }])}
                                      ><Plus data-icon="inline-start" />{t('addHeader')}</Button>
                                    </FieldGroup>
                                  </CardContent>
                                </CollapsibleContent>
                              </Card>
                            </Collapsible>
                          ) : null}
                        </FieldGroup>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="models">
                    <Card>
                      <CardHeader>
                        <CardTitle>{t('models')}</CardTitle>
                        <CardDescription>{t('modelsDesc')}</CardDescription>
                        <CardAction>
                          <Button size="sm" onClick={addNewModel}><Plus data-icon="inline-start" />{t('addModel')}</Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        {(currentConfig.models || []).length > 0 ? (
                          <div className="flex flex-col gap-3">
                            {(currentConfig.models || []).map(modelConfig => (
                              <ModelCard
                                key={modelConfig.id}
                                modelConfig={modelConfig}
                                aiConfig={currentConfig}
                                mobile={mobile}
                                open={expandedModels.includes(modelConfig.id)}
                                onOpenChange={open => setExpandedModels(current => open
                                  ? current.includes(modelConfig.id) ? current : [...current, modelConfig.id]
                                  : current.filter(id => id !== modelConfig.id)
                                )}
                                onUpdate={updateModelConfig}
                                onDelete={deleteModel}
                              />
                            ))}
                          </div>
                        ) : (
                          <Empty className="border">
                            <EmptyHeader>
                              <EmptyMedia variant="icon"><BotMessageSquare /></EmptyMedia>
                              <EmptyTitle>{t('noModelsTitle')}</EmptyTitle>
                              <EmptyDescription>{t('noModelsDesc')}</EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                              <Button size="sm" onClick={addNewModel}><Plus data-icon="inline-start" />{t('addModel')}</Button>
                            </EmptyContent>
                          </Empty>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Server /></EmptyMedia>
                  <EmptyTitle>{t('selectProviderTitle')}</EmptyTitle>
                  <EmptyDescription>{t('selectProviderDesc')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
      </div>
    </SettingType>
  )
}
