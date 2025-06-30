'use client'
import { createOpenAIClient, fetchEmbedding } from "@/lib/ai"
import useSettingStore from "@/stores/setting"
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { AiConfig } from "../config"
import { toast } from "@/hooks/use-toast"

// 检测当前 AI 的可用性
export function AiCheck() {
  const [state, setState] = useState<'ok' | 'error' | 'checking' | 'init'>('init')
  const { currentAi, aiModelList } = useSettingStore()

  async function check() {
    setState('checking')
    const model = aiModelList.find(item => item.key === currentAi)
    if (!model) {
      setState('init')
      return
    }
    const aiStatus = await checkAiStatus(model)
    if (aiStatus) {
      setState('ok')
    } else {
      setState('error')
    }
  }

  async function checkAiStatus(model: AiConfig) {
    try {
      if (!model) return false
      switch (model.modelType) {
        // 重排序模型测试
        case 'rerank':
          const testQuery = '测试查询';
          const testDocuments = [
            '这是一个测试文档', 
            '这是另一个测试文档'
          ];
          // 发送重排序测试请求
          const response = await fetch(model.baseURL + '/rerank', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${model.apiKey}`
            },
            body: JSON.stringify({
              model: model,
              query: testQuery,
              documents: testDocuments
            })
          });
          
          if (!response.ok) {
            throw new Error(`重排序请求失败: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          if (!data || !data.results) {
            throw new Error('重排序结果格式不正确');
          }
        // 嵌入模型测试
        case 'embedding':
          const testText = '测试文本';
          const embedding = await fetchEmbedding(testText);
          if (!embedding) {
            throw new Error('嵌入模型测试失败');
          }
        default:
          const openai = await createOpenAIClient(model)
          await openai.chat.completions.create({
            model: model.model || '',
            messages: [{
              role: 'user' as const,
              content: 'Hello'
            }],
          })
      }
      return true
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
      check()
    } else {
      setState('init')
    }
  }, [currentAi, aiModelList])

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


