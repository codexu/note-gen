// 检测当前 AI 的可用性

import { checkAiStatus } from "@/lib/ai"
import useSettingStore from "@/stores/setting"
import { debounce } from "lodash-es"
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

export function AiCheck() {
  const [state, setState] = useState<'ok' | 'error' | 'checking'>('checking')
  const { aiType, apiKey, model, baseURL, embeddingModel, rerankingModel } = useSettingStore()

  async function check() {
    setState('checking')
    setTimeout(async() => {
      const aiStatus = await checkAiStatus()
      if (aiStatus) {
        setState('ok')
      } else {
        setState('error')
      }
    }, 500);
  }

  const debouncedCheck = useCallback(debounce(check, 500), [])

  useEffect(() => {
    debouncedCheck()
  }, [aiType, apiKey, model, baseURL, embeddingModel, rerankingModel])

  if (state === 'ok') {
    return <CircleCheck className="text-green-500 size-4" />
  } else if (state === 'error') {
    return <CircleX className="text-red-500 size-4" />
  } else {  
    return <LoaderCircle className="animate-spin size-4" />
  }
}
