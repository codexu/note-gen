'use client'
import { Input } from "@/components/ui/input";
import { FormItem, SettingRow, SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { BotMessageSquare, Eye, EyeOff, Plus, X, Copy, Trash2 } from "lucide-react";
import { AiConfig, ModelConfig } from "../config";
import { noteGenModelKeys } from '@/app/model-config';
import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button";
import { v4 } from 'uuid';
import { confirm } from '@tauri-apps/plugin-dialog';
import { OpenBroswer } from "@/components/open-broswer";
import { baseAiConfig } from "../config";
import DefaultModelsSection from "./default-models";
import ModelCard from "./model-card";
import CreateConfig from "./create";

export default function AiPage() {
  const t = useTranslations('settings.ai');
  const {
    currentAi,
    setCurrentAi,
    aiModelList,
    setAiModelList
  } = useSettingStore()

  // 过滤掉默认模型，只显示用户自定义模型
  const userCustomModels = aiModelList.filter(model => !noteGenModelKeys.includes(model.key) && model.title !== 'NoteGen Limited')
  const [apiKeyVisible, setApiKeyVisible] = useState<boolean>(false)
  const [headerPairs, setHeaderPairs] = useState<Array<{key: string, value: string, id: string}>>([])
  
  // 当前选中的AI配置
  const currentConfig = userCustomModels.find(model => model.key === currentAi)

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
    
    const newModel: ModelConfig = {
      id: v4(),
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
  }

  // 更新模型配置
  const updateModelConfig = async (modelId: string, field: keyof ModelConfig, value: any) => {
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
    const store = await Store.load('store.json')
    const aiModelList = await store.get<AiConfig[]>('aiModelList') || []
    const index = aiModelList.findIndex(item => item.key === config.key)
    
    if (index >= 0) {
      aiModelList[index] = config
      await store.set('aiModelList', aiModelList)
      setAiModelList(aiModelList)
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
    setCurrentAi(newConfig.key)
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
      setCurrentAi(remainingUserModels[0].key)
    } else {
      setCurrentAi('')
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
        enableStream: config.enableStream
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
    } else {
      setHeaderPairs([])
    }
  }, [currentConfig])

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const aiModelList = await store.get<AiConfig[]>('aiModelList')
      const currentAi = await store.get<string>('currentAi')
      
      if (aiModelList) {
        // 迁移旧配置
        const migratedList = aiModelList.map(migrateOldConfig)
        
        // 检查是否有配置被迁移，如果有则保存
        const hasChanges = migratedList.some((config, index) => 
          JSON.stringify(config) !== JSON.stringify(aiModelList[index])
        )
        
        if (hasChanges) {
          await store.set('aiModelList', migratedList)
          setAiModelList(migratedList)
        }
      }
      
      // 过滤出用户自定义模型
      const userModels = aiModelList?.filter(model => !noteGenModelKeys.includes(model.key)) || []
      
      if (currentAi && userModels.find(model => model.key === currentAi)) {
        // 如果当前选中的是用户自定义模型，则加载它
        setCurrentAi(currentAi)
      } else if (userModels.length > 0) {
        // 如果有用户自定义模型，选择第一个
        const firstUserModel = userModels[0]
        setCurrentAi(firstUserModel.key)
      } else {
        // 如果没有用户自定义模型，清空当前选择
        setCurrentAi('')
      }
    }
    init()
  }, [])

  return (
    <SettingType id="ai" icon={<BotMessageSquare />} title={t('title')} desc={t('desc')}>
      {/* 当没有用户自定义模型时显示默认模型区域 */}
      {userCustomModels.length === 0 && <DefaultModelsSection />}
      
      <CreateConfig hasCustomModels={userCustomModels.length > 0} />
      
      {userCustomModels.length > 0 && (
        <>
          {/* AI配置选择 */}
          <SettingRow>
            <FormItem title={t('modelConfigTitle')} desc={t('modelConfigDesc')}>
              <div className="flex items-center gap-2 md:flex-row flex-col">
                <Select value={currentAi} onValueChange={setCurrentAi}>
                  <SelectTrigger className="w-full">
                    <div className="flex items-center gap-2">
                      {currentConfig?.title || t('selectConfig')}
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {userCustomModels.map((item) => (
                      <SelectItem value={item.key} key={item.key}>
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 md:w-auto w-full">
                  <Button 
                    disabled={!currentConfig} 
                    variant="outline" 
                    onClick={copyConfig}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    {t('copyConfig')}
                  </Button>
                  <Button 
                    disabled={!currentConfig || noteGenModelKeys.includes(currentConfig?.key || '')} 
                    variant="destructive" 
                    onClick={deleteCurrentConfig}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('deleteCustomModel')}
                  </Button>
                </div>
              </div>
            </FormItem>
          </SettingRow>

          {/* 当前配置的基础设置 */}
          {currentConfig && (
            <>
              {/* 配置名称 */}
              <SettingRow>
                <FormItem title={t('modelTitle')} desc={t('modelTitleDesc')}>
                  <Input 
                    value={currentConfig.title} 
                    onChange={(e) => updateAiConfig({...currentConfig, title: e.target.value})} 
                  />
                </FormItem>
              </SettingRow>

              {/* BaseURL */}
              <SettingRow>
                <FormItem title="BaseURL" desc={t('modelBaseUrlDesc')}>
                  <Input 
                    value={currentConfig.baseURL || ''} 
                    onChange={(e) => updateAiConfig({...currentConfig, baseURL: e.target.value})} 
                  />
                </FormItem>
              </SettingRow>

              {/* API Key */}
              <SettingRow>
                <FormItem title="API Key">
                  <div className="flex gap-2">
                    <Input 
                      className="flex-1" 
                      value={currentConfig.apiKey || ''} 
                      type={apiKeyVisible ? 'text' : 'password'} 
                      onChange={(e) => updateAiConfig({...currentConfig, apiKey: e.target.value})} 
                    />
                    <Button variant="outline" size="icon" onClick={() => setApiKeyVisible(!apiKeyVisible)}>
                      {apiKeyVisible ? <Eye /> : <EyeOff />}
                    </Button>
                    {baseAiConfig.find(item => item.baseURL === currentConfig.baseURL)?.apiKeyUrl && (
                      <OpenBroswer
                        type="button"
                        url={baseAiConfig.find(item => item.baseURL === currentConfig.baseURL)?.apiKeyUrl || ''}
                        title={t('apiKeyUrl')}
                      />
                    )}
                  </div>
                </FormItem>
              </SettingRow>

              {/* 自定义Headers */}
              {!baseAiConfig.find(config => config.baseURL === currentConfig.baseURL) && (
                <SettingRow>
                  <FormItem title={t('customHeaders')} desc={t('customHeadersDesc')}>
                    <div className="space-y-2">
                      {headerPairs.map((pair, index) => (
                        <div key={pair.id} className="flex gap-2 items-center">
                          <Input
                            placeholder={t('headerKey')}
                            value={pair.key}
                            onChange={(e) => {
                              const newPairs = [...headerPairs]
                              newPairs[index].key = e.target.value
                              setHeaderPairs(newPairs)
                            }}
                            onBlur={() => {
                              const jsonObj = convertKeyValueToJson(headerPairs)
                              updateAiConfig({...currentConfig, customHeaders: jsonObj})
                            }}
                            className="flex-1"
                          />
                          <Input
                            placeholder={t('headerValue')}
                            value={pair.value}
                            onChange={(e) => {
                              const newPairs = [...headerPairs]
                              newPairs[index].value = e.target.value
                              setHeaderPairs(newPairs)
                            }}
                            onBlur={() => {
                              const jsonObj = convertKeyValueToJson(headerPairs)
                              updateAiConfig({...currentConfig, customHeaders: jsonObj})
                            }}
                            className="flex-1"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              const newPairs = headerPairs.filter((_, i) => i !== index)
                              setHeaderPairs(newPairs)
                              updateAiConfig({...currentConfig, customHeaders: convertKeyValueToJson(newPairs)})
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        onClick={() => setHeaderPairs([...headerPairs, {
                          key: '', value: '', id: Math.random().toString(36).substr(2, 9)
                        }])}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {t('addHeader')}
                      </Button>
                    </div>
                  </FormItem>
                </SettingRow>
              )}

              {/* 模型配置区域 */}
              <SettingRow>
                <FormItem title={t('models')} desc={t('modelsDesc')}>
                  <div className="space-y-4">
                    {/* 添加模型按钮 */}
                    <Button onClick={addNewModel} className="w-full">
                      <Plus className="h-4 w-4 mr-2" />
                      {t('addModel')}
                    </Button>
                    
                    {/* 模型卡片列表 */}
                    <div className="space-y-4">
                      {(currentConfig.models || []).map((modelConfig) => (
                        <ModelCard
                          key={modelConfig.id}
                          modelConfig={modelConfig}
                          aiConfig={currentConfig}
                          onUpdate={updateModelConfig}
                          onDelete={deleteModel}
                        />
                      ))}
                    </div>
                  </div>
                </FormItem>
              </SettingRow>
            </>
          )}
        </>
      )}
    </SettingType>
  )
}