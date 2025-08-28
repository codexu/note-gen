'use client'
import { createOpenAIClient } from "@/lib/ai"
import useSettingStore from "@/stores/setting"
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react"
import { useEffect, useState, useRef } from "react"
import { AiConfig } from "../config"
import { toast } from "@/hooks/use-toast"
import { fetch } from "@tauri-apps/plugin-http"
import { useTranslations } from 'next-intl'
import { debounce } from "lodash-es"

// 检测当前 AI 的可用性
export function AiCheck() {
  const [state, setState] = useState<'ok' | 'error' | 'checking' | 'init'>('init')
  const { currentAi, aiModelList } = useSettingStore()
  const t = useTranslations('settings.ai')
  const abortControllerRef = useRef<AbortController | null>(null)
  const debouncedCheckRef = useRef<ReturnType<typeof debounce> | null>(null)

  async function check() {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    setState('checking')
    const model = aiModelList.find(item => item.key === currentAi)
    if (!model) {
      setState('init')
      return
    }
    
    // 创建新的 AbortController
    abortControllerRef.current = new AbortController()
    
    try {
      const aiStatus = await checkAiStatus(model, abortControllerRef.current.signal)
      if (aiStatus) {
        setState('ok')
        toast({
          description: t('connectionSuccess'),
          className: 'border-green-500 bg-green-50 text-green-800'
        })
      } else {
        setState('error')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // 请求被取消，不需要处理
        return
      }
      setState('error')
    }
  }

  // 初始化 debounced 函数，1秒后执行
  if (!debouncedCheckRef.current) {
    debouncedCheckRef.current = debounce(check, 1000)
  }

  async function checkAiStatus(model: AiConfig, signal?: AbortSignal) {
    try {
      if (!model) return false

      switch (model.modelType) {
        // 重排序模型测试
        case 'rerank':
          const query = 'Apple';
          const documents = ["apple","banana","fruit","vegetable"];
          // 发送重排序测试请求
          const response = await fetch(model.baseURL + '/rerank', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${model.apiKey}`,
              'Origin': ""
            },
            body: JSON.stringify({
              model: model.model,
              query,
              documents
            }),
            signal
          });
          if (!response.ok) {
            throw new Error(`重排序请求失败: ${response.status} ${response.statusText}`);
          }
          
          const rerankData = await response.json();
          if (!rerankData || !rerankData.results) {
            throw new Error('重排序结果格式不正确');
          }
          return true
        // 嵌入模型测试
        case 'embedding':
          const testText = '测试文本';
          const embeddingData = await fetch(model.baseURL + '/embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${model.apiKey}`,
              'Origin': ""
            },
            body: JSON.stringify({
              model: model.model,
              input: testText,
              encoding_format: 'float'
            }),
            signal
          });
          if (!embeddingData.ok) {
            throw new Error(`嵌入请求失败: ${embeddingData.status} ${embeddingData.statusText}`);
          }
          
          const embeddingDataJson = await embeddingData.json();
          if (!embeddingDataJson || !embeddingDataJson.data || !embeddingDataJson.data[0] || !embeddingDataJson.data[0].embedding) {
            throw new Error('嵌入结果格式不正确');
          }
          if (!embeddingDataJson.data[0].embedding) {
            throw new Error('嵌入模型测试失败');
          }
          return true
        // 音频模型测试
        case 'audio':
          const testAudioText = '测试音频生成';
          const audioResponse = await fetch(model.baseURL + '/audio/speech', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${model.apiKey}`,
              'Origin': "",
              ...(model.customHeaders || {})
            },
            body: JSON.stringify({
              model: model.model,
              input: testAudioText,
              voice: model.voice || 'alloy'
            }),
            signal
          });
          if (!audioResponse.ok) {
            throw new Error(`音频生成请求失败: ${audioResponse.status} ${audioResponse.statusText}`);
          }
          
          // 检查返回的是否为音频数据
          const contentType = audioResponse.headers.get('content-type');
          if (!contentType || !contentType.includes('audio')) {
            throw new Error('音频模型返回格式不正确');
          }
          return true
        default:
          const openai = await createOpenAIClient(model)
          await openai.chat.completions.create({
            model: model.model || '',
            messages: [{
              role: 'user' as const,
              content: 'Hello'
            }],
            stream: true,
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

  useEffect(() => {
    const model = aiModelList.find(item => item.key === currentAi)
    if (model?.model) {
      debouncedCheckRef.current?.()
    } else {
      setState('init')
    }
  }, [aiModelList, currentAi])

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      debouncedCheckRef.current?.cancel()
    }
  }, [])

  if (state === 'ok') {
    return <CircleCheck className="text-green-500 size-4" />
  } else if (state === 'error') {
    return <CircleX className="text-red-500 size-4" />
  } else if (state === 'checking') {  
    return <LoaderCircle className="animate-spin size-4" />
  } else {
    return null
  }
}


