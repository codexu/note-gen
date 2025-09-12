'use client'
import { Input } from "@/components/ui/input";
import { FormItem, SettingRow, SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { BotMessageSquare, Copy, Eye, EyeOff, X, Plus } from "lucide-react";
import ModelSelect from "./modelSelect";
import { AiConfig, ModelType } from "../config";
import { noteGenModelKeys } from '@/app/model-config';
import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider"
import { v4 } from 'uuid';
import { confirm } from '@tauri-apps/plugin-dialog';
import { AiCheck } from "./check";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import CreateConfig from "./create";
import { Badge } from "@/components/ui/badge";
import { OpenBroswer } from "@/components/open-broswer";
import { baseAiConfig } from "../config";
import emitter from "@/lib/emitter";
import DefaultModelsSection from "./default-models";

export default function AiPage() {
  const t = useTranslations('settings.ai');
  const {
    currentAi,
    setCurrentAi,
    aiModelList,
    setAiModelList
  } = useSettingStore()

  // 过滤掉默认模型，只显示用户自定义模型
  const userCustomModels = aiModelList.filter(model => !noteGenModelKeys.includes(model.key))
  const [apiKey, setApiKey] = useState<string>('')
  const [baseURL, setBaseURL] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [aiTitle, setAiTitle] = useState<string>('')
  const [temperature, setTemperature] = useState<number>(0.7)
  const [topP, setTopP] = useState<number>(1.0)
  const [modelType, setModelType] = useState<ModelType>('chat')
  const [voice, setVoice] = useState<string>('')
  const [apiKeyVisible, setApiKeyVisible] = useState<boolean>(false)
  const [headerPairs, setHeaderPairs] = useState<Array<{key: string, value: string, id: string}>>([])

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

  // 通过本地存储查询当前的模型配置
  async function getModelByStore(key: string) {
    const model = aiModelList.find(item => item.key === key)
    return model
  }

  // 模型配置选择变更
  async function modelConfigSelectChange(key: string) {
    const store = await Store.load('store.json');
    const models = await store.get<AiConfig[]>('aiModelList')
    await store.set('currentAi', key)
    if (!models?.length) return
    const model = models.find(item => item.key === key)
    if (!model) return
    setCurrentAi(key)
    setAiTitle(model.title || '')
    setBaseURL(model.baseURL || '')
    setApiKey(model.apiKey || '')
    setModel(model.model || '')
    setTemperature(model.temperature || 0.7)
    setTopP(model.topP || 0.1)
    setModelType(model.modelType || 'chat')
    setVoice(model.voice || '')
    setHeaderPairs(parseHeadersToKeyValue(model.customHeaders))
  }

  // 数据变化保存
  async function valueChangeHandler<K extends keyof AiConfig>(key: K, value: AiConfig[K]) {
    switch (key) {
      case 'title':
        setAiTitle(value as string)
        break;
      case 'baseURL':
        emitter.emit('getSettingModelList')
        setBaseURL(value as string)
        break;
      case 'apiKey':
        emitter.emit('getSettingModelList')
        setApiKey(value as string)
        break;
      case 'model':
        setModel(value as string)
        break;
      case 'temperature':
        setTemperature(value as number)
        break;
      case 'topP':
        setTopP(value as number)
        break;
      case 'modelType':
        setModelType(value as ModelType)
        break;
      case 'voice':
        setVoice(value as string)
        break;
      case 'customHeaders':
        emitter.emit('getSettingModelList')
        setHeaderPairs(parseHeadersToKeyValue(value as Record<string, string>))
        break;
    }
    const model = await getModelByStore(currentAi)
    if (!model) return
    model[key] = value
    const store = await Store.load('store.json');
    const aiModelList = await store.get<AiConfig[]>('aiModelList')
    if (!aiModelList) return
    aiModelList[aiModelList.findIndex(item => item.key === currentAi)] = model
    setAiModelList(aiModelList)
    await store.set('aiModelList', aiModelList)
  }

  // 删除自定义模型
  async function deleteCustomModelHandler() {
    const res = await confirm(t('deleteCustomModelConfirm'))
    if (!res) return
    const model = await getModelByStore(currentAi)
    if (!model) return
    const store = await Store.load('store.json');
    const aiModelList = await store.get<AiConfig[]>('aiModelList')
    if (!aiModelList) return
    aiModelList.splice(aiModelList.findIndex(item => item.key === currentAi), 1)
    await store.set('aiModelList', aiModelList)
    setAiModelList(aiModelList);
    await deleteDefaultModel(store);
    
    // 删除后选择下一个用户自定义模型
    const remainingUserModels = aiModelList.filter(model => !noteGenModelKeys.includes(model.key))
    if (remainingUserModels.length > 0) {
      const nextModel = remainingUserModels[0]
      modelConfigSelectChange(nextModel.key)
      setCurrentAi(nextModel.key)
    } else {
      // 如果没有用户自定义模型了，清空选择
      setCurrentAi('')
    }
  }

  // 删除配置的默认模型
  async function deleteDefaultModel(store:Store) {
    const doDelete = async (key:string)=>{
      const model = await store.get<string>(key) || '';
      if (model == currentAi) await store.set(key, '');
    }
    const defaultModelKeys = [
      'primaryModel',
      'placeholderModel',
      'translateModel',
      'markDescModel',
      'embeddingModel',
      'rerankingModel',
      'imageMethodModel'
    ];
    defaultModelKeys.forEach(key => {
      doDelete(key)
    })
  }

  // 复制当前配置
  async function copyConfig() {
    const model = await getModelByStore(currentAi)
    if (!model) return

    const id = v4()
    const newModel: AiConfig = {
      ...model,
      key: id,
      title: `${model.title || 'Copy'} (Copy)`,
      modelType: model.modelType || 'chat', // Preserve the model type or default to chat
    }

    const store = await Store.load('store.json');
    const aiModelList = await store.get<AiConfig[]>('aiModelList')
    if (!aiModelList) return

    const updatedList = [...aiModelList, newModel]
    await store.set('aiModelList', updatedList)
    setAiModelList(updatedList)

    modelConfigSelectChange(id)
    setCurrentAi(newModel.key)
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const aiModelList = await store.get<AiConfig[]>('aiModelList')
      const currentAi = await store.get<string>('currentAi')
      
      // 过滤出用户自定义模型
      const userModels = aiModelList?.filter(model => !noteGenModelKeys.includes(model.key)) || []
      
      if (currentAi && userModels.find(model => model.key === currentAi)) {
        // 如果当前选中的是用户自定义模型，则加载它
        setCurrentAi(currentAi)
        modelConfigSelectChange(currentAi)
      } else if (userModels.length > 0) {
        // 如果有用户自定义模型，选择第一个
        const firstUserModel = userModels[0]
        setCurrentAi(firstUserModel.key)
        modelConfigSelectChange(firstUserModel.key)
      } else {
        // 如果没有用户自定义模型，清空当前选择
        setCurrentAi('')
      }
    }
    init()
  }, [])

  useEffect(() => {
    modelConfigSelectChange(currentAi)
  }, [currentAi])

  return (
    <SettingType id="ai" icon={<BotMessageSquare />} title={t('title')} desc={t('desc')}>
      {/* 当没有用户自定义模型时显示默认模型区域 */}
      {userCustomModels.length === 0 && <DefaultModelsSection />}
      
      <CreateConfig hasCustomModels={userCustomModels.length > 0} />
      {
        userCustomModels.length > 0 && <>
        {/* 模型配置选择 */}
        <SettingRow>
          <FormItem title={t('modelConfigTitle')} desc={t('modelConfigDesc')}>
            <div className="flex items-center gap-2 md:flex-row flex-col">
              <Select value={currentAi} onValueChange={modelConfigSelectChange}>
                <SelectTrigger className="w-full flex">
                  <div className="flex items-center gap-2">
                    <AiCheck />
                    { userCustomModels.find(item => item.key === currentAi)?.title}
                    { userCustomModels.find(item => item.key === currentAi)?.model && <span>({userCustomModels.find(item => item.key === currentAi)?.model})</span>}
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {
                    userCustomModels.map((item) => (
                      <SelectItem value={item.key} key={item.key}>
                        <div className="flex items-center gap-2">
                          <Badge>
                            {t(`modelType.${item.modelType || 'chat'}`)}
                          </Badge>
                          {item.title}
                          { item.model && <span>({item.model})</span>}
                        </div>
                      </SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 md:w-auto w-full">
                <Button disabled={!userCustomModels.length} variant={'outline'} onClick={copyConfig}><Copy />{t('copyConfig')}</Button>
                <Button disabled={!userCustomModels.length} variant={'destructive'} onClick={deleteCustomModelHandler}><X />{t('deleteCustomModel')}</Button>
              </div>
            </div>
          </FormItem>
        </SettingRow>
        {/* 模型名称 */}
        <SettingRow>
          <FormItem title={t('modelTitle')} desc={t('modelTitleDesc')}>
            <Input value={aiTitle} onChange={(e) => valueChangeHandler('title', e.target.value)} />
          </FormItem>
        </SettingRow>
        {/* BaseURL */}
        <SettingRow>
          <FormItem title="BaseURL" desc={t('modelBaseUrlDesc')}>
            <Input value={baseURL} onChange={(e) => valueChangeHandler('baseURL', e.target.value)} />
          </FormItem>
        </SettingRow>
        {/* API Key */}
        <SettingRow>
          <FormItem title="API Key">
            <div className="flex gap-2">
              <Input className="flex-1" value={apiKey} type={apiKeyVisible ? 'text' : 'password'} onChange={(e) => valueChangeHandler('apiKey', e.target.value)} />
              <Button variant="outline" size="icon" onClick={() => setApiKeyVisible(!apiKeyVisible)}>
                {apiKeyVisible ? <Eye /> : <EyeOff />}
              </Button>
              {
                baseAiConfig.find(item => item.baseURL === baseURL)?.apiKeyUrl &&
                <OpenBroswer
                  type="button"
                  url={baseAiConfig.find(item => item.baseURL === baseURL)?.apiKeyUrl || ''}
                  title={t('apiKeyUrl')}
                />
              }
            </div>
          </FormItem>
        </SettingRow>
        {/* 模型 */}
        <SettingRow>
          <FormItem title="Model" desc={t('modelDesc')}>
            <ModelSelect model={model} setModel={(model) => valueChangeHandler('model', model)} />
          </FormItem>
        </SettingRow>
        {/* 模型类型 */}
        <SettingRow>
          <FormItem title={t('modelType.title')} desc={t('modelType.desc')}>
            <RadioGroup
              value={modelType}
              onValueChange={(value) => valueChangeHandler('modelType', value as ModelType)}
              className="flex flex-wrap gap-6 m-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="chat" id="chat" />
                <Label htmlFor="chat">{t('modelType.chat')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="image" id="image" disabled />
                <Label htmlFor="image" className="text-muted-foreground">{t('modelType.image')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="video" id="video" disabled />
                <Label htmlFor="video" className="text-muted-foreground">{t('modelType.video')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="audio" id="audio" />
                <Label htmlFor="audio" className="text-muted-foreground">{t('modelType.audio')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="embedding" id="embedding" />
                <Label htmlFor="embedding">{t('modelType.embedding')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="rerank" id="rerank" />
                <Label htmlFor="rerank">{t('modelType.rerank')}</Label>
              </div>
            </RadioGroup>
          </FormItem>
        </SettingRow>
        {/* 自定义Headers */}
        {!baseAiConfig.find(config => config.baseURL === baseURL) && (
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
                        valueChangeHandler('customHeaders', jsonObj)
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
                        valueChangeHandler('customHeaders', jsonObj)
                      }}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const newPairs = headerPairs.filter((_, i) => i !== index)
                        setHeaderPairs(newPairs)
                        valueChangeHandler('customHeaders', convertKeyValueToJson(newPairs))
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
        {
          modelType === 'chat' && (
            <>
              <SettingRow>
                <FormItem title="Temperature" desc={t('temperatureDesc')}>
                  <div className="flex gap-2 py-2">
                    <Slider
                      className="w-64"
                      value={[temperature]}
                      max={2}
                      step={0.01}
                      onValueChange={(value) => valueChangeHandler('temperature', value[0])}
                    />
                    <span className="text-zinc-500">{temperature}</span>
                  </div>
                </FormItem>
            </SettingRow>
            <SettingRow>
              <FormItem title="Top P" desc={t('topPDesc')}>
                <div className="flex gap-2 py-2">
                  <Slider
                    className="w-64"
                    value={[topP]}
                    max={1}
                    min={0}
                    step={0.01}
                    onValueChange={(value) => valueChangeHandler('topP', value[0])}
                  />
                  <span className="text-zinc-500">{topP}</span>
                </div>
              </FormItem>
            </SettingRow>
          </>)
        }
        {
          modelType === 'audio' && (
            <SettingRow>
              <FormItem title={t('voice')} desc={t('voiceDesc')}>
                <Input
                  value={voice}
                  onChange={(e) => valueChangeHandler('voice', e.target.value)}
                  placeholder={t('voicePlaceholder')}
                />
              </FormItem>
            </SettingRow>
          )
        }
      </>
    }
    </SettingType>
  )
}