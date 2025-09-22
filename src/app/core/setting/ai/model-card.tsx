'use client'
import { 
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Trash2, CircleCheck, CircleX, LoaderCircle } from "lucide-react"
import { ModelConfig, ModelType, AiConfig } from "../config"
import { useTranslations } from 'next-intl'
import ModelSelect from "./modelSelect"
import { useState, useRef } from "react"
import { createOpenAIClient } from "@/lib/ai"
import { toast } from "@/hooks/use-toast"
import { fetch } from "@tauri-apps/plugin-http"

interface ModelCardProps {
  modelConfig: ModelConfig
  aiConfig: AiConfig
  onUpdate: (modelId: string, field: keyof ModelConfig, value: any) => void
  onDelete: (modelId: string) => void
}

export default function ModelCard({ modelConfig, aiConfig, onUpdate, onDelete }: ModelCardProps) {
  const t = useTranslations('settings.ai')
  const [checkState, setCheckState] = useState<'ok' | 'error' | 'checking' | 'init'>('init')
  const abortControllerRef = useRef<AbortController | null>(null)

  const handleCheck = async () => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    setCheckState('checking')
    abortControllerRef.current = new AbortController()
    
    try {
      const aiStatus = await checkModelStatus(modelConfig, aiConfig, abortControllerRef.current.signal)
      if (aiStatus) {
        setCheckState('ok')
        toast({
          description: t('connectionSuccess'),
          className: 'border-green-500 bg-green-50 text-green-800'
        })
      } else {
        setCheckState('error')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      setCheckState('error')
    }
  }

  const checkModelStatus = async (model: ModelConfig, aiConfig: AiConfig, signal?: AbortSignal) => {
    try {
      if (!model.model || !aiConfig.baseURL) return false

      const fullAiConfig: AiConfig = {
        ...aiConfig,
        model: model.model,
        modelType: model.modelType,
        temperature: model.temperature,
        topP: model.topP,
        voice: model.voice,
        enableStream: model.enableStream
      }

      switch (model.modelType) {
        case 'rerank':
          const query = 'Apple'
          const documents = ["apple","banana","fruit","vegetable"]
          const response = await fetch(aiConfig.baseURL + '/rerank', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${aiConfig.apiKey}`,
              'Origin': "",
              ...(aiConfig.customHeaders || {})
            },
            body: JSON.stringify({
              model: model.model,
              query,
              documents
            }),
            signal
          })
          if (!response.ok) {
            throw new Error(`重排序请求失败: ${response.status} ${response.statusText}`)
          }
          const rerankData = await response.json()
          if (!rerankData || !rerankData.results) {
            throw new Error('重排序结果格式不正确')
          }
          return true

        case 'embedding':
          const testText = '测试文本'
          const embeddingData = await fetch(aiConfig.baseURL + '/embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${aiConfig.apiKey}`,
              'Origin': "",
              ...(aiConfig.customHeaders || {})
            },
            body: JSON.stringify({
              model: model.model,
              input: testText,
              encoding_format: 'float'
            }),
            signal
          })
          if (!embeddingData.ok) {
            throw new Error(`嵌入请求失败: ${embeddingData.status} ${embeddingData.statusText}`)
          }
          const embeddingDataJson = await embeddingData.json()
          if (!embeddingDataJson || !embeddingDataJson.data || !embeddingDataJson.data[0] || !embeddingDataJson.data[0].embedding) {
            throw new Error('嵌入结果格式不正确')
          }
          return true

        case 'audio':
          const testAudioText = '测试音频生成'
          const audioResponse = await fetch(aiConfig.baseURL + '/audio/speech', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${aiConfig.apiKey}`,
              'Origin': "",
              ...(aiConfig.customHeaders || {})
            },
            body: JSON.stringify({
              model: model.model,
              input: testAudioText,
              voice: model.voice || 'alloy'
            }),
            signal
          })
          if (!audioResponse.ok) {
            throw new Error(`音频生成请求失败: ${audioResponse.status} ${audioResponse.statusText}`)
          }
          const contentType = audioResponse.headers.get('content-type')
          if (!contentType || !contentType.includes('audio')) {
            throw new Error('音频模型返回格式不正确')
          }
          return true

        default:
          const openai = await createOpenAIClient(fullAiConfig)
          await openai.chat.completions.create({
            model: model.model,
            messages: [{
              role: 'user' as const,
              content: 'Hello'
            }],
            stream: model.enableStream !== false,
          })
          return true
      }
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : 'Error',
        variant: 'destructive'
      })
      return false
    }
  }

  const renderCheckIcon = () => {
    switch (checkState) {
      case 'ok':
        return <CircleCheck className="text-green-500 size-4" />
      case 'error':
        return <CircleX className="text-red-500 size-4" />
      case 'checking':
        return <LoaderCircle className="animate-spin size-4" />
      default:
        return null
    }
  }

  return (
    <AccordionItem value={modelConfig.id} className="border rounded-lg">
      <div className="flex items-center justify-between flex-wrap">
        <div className="flex-1">
          <AccordionTrigger className="w-full px-4 py-4 hover:no-underline">
            <div className="flex items-center">
              <span className="text-base font-semibold">
                {modelConfig.model || t('newModel')}
              </span>
              <Badge variant="secondary" className="ml-2">
                {t(`modelType.${modelConfig.modelType}`)}
              </Badge>
            </div>
          </AccordionTrigger>
        </div>
        <div className="flex items-center justify-end gap-2 p-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheck}
            disabled={!modelConfig.model || checkState === 'checking'}
          >
            {renderCheckIcon()}
            {t('checkConnection')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDelete(modelConfig.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>      
      <AccordionContent className="px-4 pb-4 space-y-4">
        {/* 模型选择 */}
        <div className="space-y-2">
          <Label>{t('model')}</Label>
          <ModelSelect
            model={modelConfig.model}
            setModel={(model) => onUpdate(modelConfig.id, 'model', model)}
            aiConfig={aiConfig}
          />
        </div>

        {/* 模型类型 */}
        <div className="space-y-2">
          <Label>{t('modelType.title')}</Label>
          <RadioGroup
            value={modelConfig.modelType}
            onValueChange={(value) => onUpdate(modelConfig.id, 'modelType', value as ModelType)}
            className="flex flex-wrap gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="chat" id={`chat-${modelConfig.id}`} />
              <Label htmlFor={`chat-${modelConfig.id}`}>{t('modelType.chat')}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="audio" id={`audio-${modelConfig.id}`} />
              <Label htmlFor={`audio-${modelConfig.id}`}>{t('modelType.audio')}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="embedding" id={`embedding-${modelConfig.id}`} />
              <Label htmlFor={`embedding-${modelConfig.id}`}>{t('modelType.embedding')}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="rerank" id={`rerank-${modelConfig.id}`} />
              <Label htmlFor={`rerank-${modelConfig.id}`}>{t('modelType.rerank')}</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Chat模型的特殊配置 */}
        {modelConfig.modelType === 'chat' && (
          <>
            <div className="space-y-2">
              <Label>Temperature</Label>
              <div className="flex gap-2 items-center">
                <Slider
                  className="flex-1"
                  value={[modelConfig.temperature || 0.7]}
                  max={2}
                  step={0.01}
                  onValueChange={(value) => onUpdate(modelConfig.id, 'temperature', value[0])}
                />
                <span className="text-sm text-muted-foreground w-12">
                  {(modelConfig.temperature || 0.7).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Top P</Label>
              <div className="flex gap-2 items-center">
                <Slider
                  className="flex-1"
                  value={[modelConfig.topP || 1.0]}
                  max={1}
                  min={0}
                  step={0.01}
                  onValueChange={(value) => onUpdate(modelConfig.id, 'topP', value[0])}
                />
                <span className="text-sm text-muted-foreground w-12">
                  {(modelConfig.topP || 1.0).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('enableStream')}</Label>
                <div className="text-sm text-muted-foreground">
                  {t('enableStreamDesc')}
                </div>
              </div>
              <Switch
                checked={modelConfig.enableStream !== false}
                onCheckedChange={(checked) => onUpdate(modelConfig.id, 'enableStream', checked)}
              />
            </div>
          </>
        )}

        {/* 音频模型的特殊配置 */}
        {modelConfig.modelType === 'audio' && (
          <div className="space-y-2">
            <Label>{t('voice')}</Label>
            <Input
              value={modelConfig.voice || ''}
              onChange={(e) => onUpdate(modelConfig.id, 'voice', e.target.value)}
              placeholder={t('voicePlaceholder')}
            />
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}
