'use client'
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormItem, SettingRow, SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { BotMessageSquare, Copy, Eye, EyeOff, X } from "lucide-react";
import ModelSelect from "./modelSelect";
import { AiConfig, ModelType } from "../config";
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

export default function AiPage() {
  const t = useTranslations('settings.ai');
  const {
    currentAi,
    setCurrentAi,
    aiModelList,
    setAiModelList
  } = useSettingStore()
  const [apiKey, setApiKey] = useState<string>('')
  const [baseURL, setBaseURL] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [aiTitle, setAiTitle] = useState<string>('')
  const [temperature, setTemperature] = useState<number>(0.7)
  const [topP, setTopP] = useState<number>(1.0)
  const [modelType, setModelType] = useState<ModelType>('chat')
  const [apiKeyVisible, setApiKeyVisible] = useState<boolean>(false)
  const [customHeaders, setCustomHeaders] = useState<string>('')

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
    setCustomHeaders(model.customHeaders ? JSON.stringify(model.customHeaders, null, 2) : '{}')
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
      case 'customHeaders':
        setCustomHeaders(JSON.stringify(value, null, 2))
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
    setAiModelList(aiModelList)
    const first = aiModelList[0]
    if (!first) return
    modelConfigSelectChange(first.key)
    setCurrentAi(first.key)
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
      if (currentAi) {
        setCurrentAi(currentAi)
        modelConfigSelectChange(currentAi)
      } else {
        const firstKey = aiModelList?.[0]?.key
        if (!firstKey) return
        setCurrentAi(firstKey)
        modelConfigSelectChange(firstKey)
      }
    }
    init()
  }, [])

  useEffect(() => {
    modelConfigSelectChange(currentAi)
  }, [currentAi])

  return (
    <SettingType id="ai" icon={<BotMessageSquare />} title={t('title')} desc={t('desc')}>
      <CreateConfig />
      {
        aiModelList.length > 0 && <>
        {/* 模型配置选择 */}
        <SettingRow>
          <FormItem title={t('modelConfigTitle')} desc={t('modelConfigDesc')}>
            <div className="flex items-center gap-2">
              <Select value={currentAi} onValueChange={modelConfigSelectChange}>
                <SelectTrigger className="w-full flex">
                  <div className="flex items-center gap-2">
                    <AiCheck />
                    { aiModelList.find(item => item.key === currentAi)?.title}
                    { aiModelList.find(item => item.key === currentAi)?.model && <span>({aiModelList.find(item => item.key === currentAi)?.model})</span>}
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {
                    aiModelList.map((item) => (
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
              <Button disabled={!aiModelList.length} variant={'outline'} onClick={copyConfig}><Copy />{t('copyConfig')}</Button>
              <Button disabled={!aiModelList.length} variant={'destructive'} onClick={deleteCustomModelHandler}><X />{t('deleteCustomModel')}</Button>
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
                <RadioGroupItem value="audio" id="audio" disabled />
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
            <FormItem title="自定义Headers" desc="自定义请求头 (JSON格式)">
              <Textarea
                value={customHeaders}
                onChange={(e) => {
                  setCustomHeaders(e.target.value)
                }}
                onBlur={(e) => {
                  try {
                    const headers = JSON.parse(e.target.value || '{}')
                    valueChangeHandler('customHeaders', headers)
                  } catch {
                    valueChangeHandler('customHeaders', {})
                  }
                }}
                className="h-24 resize-none font-mono text-sm"
              />
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
      </>
    }
    </SettingType>
  )
}