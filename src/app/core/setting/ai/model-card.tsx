'use client'
import { useNoteGenLimitedUsage } from '@/hooks/use-notegen-limited-usage'
import { NoteGenModelLabel } from '@/components/notegen-model-label'
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ResponsiveSelect } from "@/components/responsive-select"
import {
  ChartScatter,
  ChevronDown,
  CircleCheck,
  CircleX,
  ListOrdered,
  LoaderCircle,
  MessageSquare,
  Mic,
  Trash2,
  Volume2,
  type LucideIcon,
} from "lucide-react"
import { ModelConfig, ModelType, AiConfig } from "../config"
import { useTranslations } from 'next-intl'
import ModelSelect from "./modelSelect"
import { useState, useRef } from "react"
import { createOpenAIClient } from "@/lib/ai/utils"
import { toast } from "@/hooks/use-toast"
import { blobToBytes, invokeAiBinary, invokeAiJson, invokeAiMultipart, resolveAiRequestConfig } from "@/lib/ai/tauri-client"

interface ModelCardProps {
  modelConfig: ModelConfig
  aiConfig: AiConfig
  mobile?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: <K extends keyof ModelConfig>(modelId: string, field: K, value: ModelConfig[K]) => void
  onDelete: (modelId: string) => void
}

interface RerankCheckResponse {
  results?: unknown[]
}

interface EmbeddingCheckResponse {
  data?: Array<{ embedding?: number[] }>
}

const modelTypeOptions: Array<{
  value: ModelType
  icon: LucideIcon
}> = [
  { value: 'chat', icon: MessageSquare },
  { value: 'tts', icon: Volume2 },
  { value: 'stt', icon: Mic },
  { value: 'embedding', icon: ChartScatter },
  { value: 'rerank', icon: ListOrdered },
]

export default function ModelCard({
  modelConfig,
  aiConfig,
  mobile = false,
  open,
  onOpenChange,
  onUpdate,
  onDelete,
}: ModelCardProps) {
  const { detail: limitedDetail, activeModelName: limitedName } = useNoteGenLimitedUsage()
  const t = useTranslations('settings.ai')
  const tc = useTranslations('common')
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
          description: t('connectionSuccess')
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
      const requestConfig = await resolveAiRequestConfig(fullAiConfig)

      switch (model.modelType) {
        case 'rerank':
          const query = 'Apple'
          const documents = ["apple","banana","fruit","vegetable"]
          const rerankData = await invokeAiJson<RerankCheckResponse>({
            config: requestConfig,
            path: '/rerank',
            method: 'POST',
            body: {
              model: model.model,
              query,
              documents
            }
          }, signal)
          if (!rerankData || !rerankData.results) {
            throw new Error('重排序结果格式不正确')
          }
          return true

        case 'embedding':
          const testText = '测试文本'
          const embeddingDataJson = await invokeAiJson<EmbeddingCheckResponse>({
            config: requestConfig,
            path: '/embeddings',
            method: 'POST',
            body: {
              model: model.model,
              input: testText,
              encoding_format: 'float'
            }
          }, signal)
          if (!embeddingDataJson || !embeddingDataJson.data || !embeddingDataJson.data[0] || !embeddingDataJson.data[0].embedding) {
            throw new Error('嵌入结果格式不正确')
          }
          return true

        case 'tts':
          const testAudioText = '测试音频生成'
          const ttsBuffer = await invokeAiBinary({
            config: requestConfig,
            path: '/audio/speech',
            method: 'POST',
            body: {
              model: model.model,
              input: testAudioText,
              voice: model.voice || 'alloy'
            }
          }, signal)
          if (!ttsBuffer.byteLength) {
            throw new Error('TTS模型返回格式不正确')
          }
          return true

        case 'stt':
          const testAudioBlob = new Blob([new Uint8Array(100)], { type: 'audio/webm' })
          try {
            await invokeAiMultipart({
              config: requestConfig,
              path: '/audio/transcriptions',
              fileFieldName: 'file',
              fields: {
                model: model.model
              },
              file: {
                bytes: await blobToBytes(testAudioBlob),
                fileName: 'test.webm',
                contentType: 'audio/webm',
              }
            }, signal)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('401') || message.includes('403')) {
              throw new Error(message)
            }
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
        return <CircleCheck data-icon="inline-start" className="text-primary" />
      case 'error':
        return <CircleX data-icon="inline-start" className="text-destructive" />
      case 'checking':
        return <LoaderCircle data-icon="inline-start" className="animate-spin" />
      default:
        return null
    }
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card size="sm">
        {mobile ? (
          <CardHeader
            className="cursor-pointer gap-3"
            onClick={() => onOpenChange(!open)}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <CardTitle className="min-w-0 flex-1 break-words text-base font-semibold">
                <NoteGenModelLabel model={modelConfig.model || t('newModel')} builtin={aiConfig.key === 'note-gen-free'} limitedName={limitedName} limitedDetail={limitedDetail} />
              </CardTitle>
              <div onClick={(event) => event.stopPropagation()}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="group shrink-0"
                    aria-label={t('models')}
                  >
                    <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <div
              className="flex items-center justify-between gap-3 border-t border-border/60 pt-3"
              onClick={(event) => event.stopPropagation()}
            >
              <Badge variant="secondary">
                {t(`modelType.${modelConfig.modelType}`)}
              </Badge>
              <ButtonGroup>
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
                  size="icon-sm"
                  aria-label={tc('delete')}
                  onClick={() => onDelete(modelConfig.id)}
                >
                  <Trash2 />
                </Button>
              </ButtonGroup>
            </div>
          </CardHeader>
        ) : (
          <CardHeader
            className="cursor-pointer items-center"
            onClick={() => onOpenChange(!open)}
          >
            <CardTitle className="flex min-w-0 items-center gap-2">
              <span className="truncate"><NoteGenModelLabel model={modelConfig.model || t('newModel')} builtin={aiConfig.key === 'note-gen-free'} limitedName={limitedName} limitedDetail={limitedDetail} /></span>
              <Badge variant="secondary">
                {t(`modelType.${modelConfig.modelType}`)}
              </Badge>
            </CardTitle>
            <CardAction
              className="row-span-1 flex items-center gap-2 self-center"
              onClick={(event) => event.stopPropagation()}
            >
              <ButtonGroup>
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
                  size="icon-sm"
                  aria-label={tc('delete')}
                  onClick={() => onDelete(modelConfig.id)}
                >
                  <Trash2 />
                </Button>
              </ButtonGroup>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="group"
                  aria-label={t('models')}
                >
                  <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                </Button>
              </CollapsibleTrigger>
            </CardAction>
          </CardHeader>
        )}

        <CollapsibleContent>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel>{t('model')}</FieldLabel>
                <ModelSelect
                  model={modelConfig.model}
                  setModel={(model) => onUpdate(modelConfig.id, 'model', model)}
                  aiConfig={aiConfig}
                />
              </Field>

              <Field>
                <FieldLabel>{t('modelType.title')}</FieldLabel>
                {mobile ? (
                  <ResponsiveSelect
                    title={t('modelType.title')}
                    value={modelConfig.modelType}
                    onValueChange={value => onUpdate(modelConfig.id, 'modelType', value as ModelType)}
                    options={modelTypeOptions.map(({ value }) => ({
                      value,
                      label: t(`modelType.${value}`),
                    }))}
                  />
                ) : (
                  <Tabs
                    className="w-full"
                    orientation="horizontal"
                    value={modelConfig.modelType}
                    onValueChange={(value) => onUpdate(modelConfig.id, 'modelType', value as ModelType)}
                  >
                    <TabsList className="grid h-8 w-full grid-cols-5">
                      {modelTypeOptions.map(({ value, icon: Icon }) => (
                        <TabsTrigger
                          key={value}
                          value={value}
                          title={t(`modelType.${value}`)}
                          className="min-w-0 !w-auto !justify-center px-1"
                        >
                          <Icon data-icon="inline-start" />
                          <span className="truncate">{t(`modelType.${value}`)}</span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
              </Field>

              {modelConfig.modelType === 'chat' && (
                <Collapsible className="flex flex-col gap-3">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="group w-full justify-between bg-transparent px-0 hover:bg-transparent data-[state=open]:bg-transparent"
                    >
                      <span>{t('advancedParameters')}</span>
                      <ChevronDown
                        data-icon="inline-end"
                        className="transition-transform group-data-[state=open]:rotate-180"
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <FieldGroup>
                          <Field>
                            <FieldLabel>{t('maxTokens')}</FieldLabel>
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={modelConfig.maxTokens ?? ''}
                              placeholder={t('maxTokensPlaceholder')}
                              onChange={(event) => {
                                const value = event.target.value
                                onUpdate(modelConfig.id, 'maxTokens', value === '' ? undefined : Number(value))
                              }}
                            />
                            <FieldDescription>{t('maxTokensDesc')}</FieldDescription>
                          </Field>

                          <Field>
                            <FieldLabel>{t('contextWindow')}</FieldLabel>
                            <Input
                              type="number"
                              min={1024}
                              step={1024}
                              value={modelConfig.contextWindow ?? ''}
                              placeholder={t('contextWindowPlaceholder')}
                              onChange={(event) => {
                                const value = event.target.value
                                onUpdate(modelConfig.id, 'contextWindow', value === '' ? undefined : Number(value))
                              }}
                            />
                            <FieldDescription>{t('contextWindowDesc')}</FieldDescription>
                          </Field>

                          <Field>
                            <FieldLabel>{t('tokenLimitParam')}</FieldLabel>
                            <RadioGroup
                              value={modelConfig.tokenLimitParam || 'max_completion_tokens'}
                              onValueChange={(value) => onUpdate(
                                modelConfig.id,
                                'tokenLimitParam',
                                value as ModelConfig['tokenLimitParam']
                              )}
                            >
                              <Field orientation="horizontal" className={mobile ? 'mobile-setting-token-option' : undefined}>
                                <RadioGroupItem
                                  value="max_completion_tokens"
                                  id={`max-completion-tokens-${modelConfig.id}`}
                                />
                                <FieldLabel htmlFor={`max-completion-tokens-${modelConfig.id}`}>
                                  max_completion_tokens
                                </FieldLabel>
                              </Field>
                              <Field orientation="horizontal" className={mobile ? 'mobile-setting-token-option' : undefined}>
                                <RadioGroupItem
                                  value="max_tokens"
                                  id={`max-tokens-${modelConfig.id}`}
                                />
                                <FieldLabel htmlFor={`max-tokens-${modelConfig.id}`}>
                                  max_tokens
                                </FieldLabel>
                              </Field>
                            </RadioGroup>
                            <FieldDescription>{t('tokenLimitParamDesc')}</FieldDescription>
                          </Field>

                          <Field>
                            <FieldLabel>Temperature</FieldLabel>
                            <div className="flex items-center gap-3">
                              <Slider
                                className="flex-1"
                                value={[modelConfig.temperature ?? 0.7]}
                                max={2}
                                step={0.01}
                                onValueChange={(value) => onUpdate(modelConfig.id, 'temperature', value[0])}
                              />
                              <Badge variant="outline">
                                {(modelConfig.temperature ?? 0.7).toFixed(2)}
                              </Badge>
                            </div>
                          </Field>

                          <Field>
                            <FieldLabel>Top P</FieldLabel>
                            <div className="flex items-center gap-3">
                              <Slider
                                className="flex-1"
                                value={[modelConfig.topP ?? 1.0]}
                                max={1}
                                min={0}
                                step={0.01}
                                onValueChange={(value) => onUpdate(modelConfig.id, 'topP', value[0])}
                              />
                              <Badge variant="outline">
                                {(modelConfig.topP ?? 1.0).toFixed(2)}
                              </Badge>
                            </div>
                          </Field>

                          <Field orientation="horizontal" className={mobile ? 'mobile-setting-inline-switch-field' : undefined}>
                            <FieldContent>
                              <FieldTitle>{t('enableStream')}</FieldTitle>
                              <FieldDescription>{t('enableStreamDesc')}</FieldDescription>
                            </FieldContent>
                            <Switch
                              checked={modelConfig.enableStream !== false}
                              onCheckedChange={(checked) => onUpdate(modelConfig.id, 'enableStream', checked)}
                            />
                          </Field>
                    </FieldGroup>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {modelConfig.modelType === 'tts' && (
                <Field>
                  <FieldLabel>{t('voice')}</FieldLabel>
                  <Input
                    value={modelConfig.voice || ''}
                    onChange={(event) => onUpdate(modelConfig.id, 'voice', event.target.value)}
                    placeholder={t('voicePlaceholder')}
                  />
                </Field>
              )}
            </FieldGroup>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
