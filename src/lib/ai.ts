import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import OpenAI from 'openai';
import { AiConfig } from "@/app/core/setting/config";
import { fetch } from "@tauri-apps/plugin-http";

/**
 * 获取当前的prompt内容
 */
async function getPromptContent(): Promise<string> {
  const store = await Store.load('store.json')
  const currentPromptId = await store.get<string>('currentPromptId')
  let promptContent = ''
  
  if (currentPromptId) {
    const promptList = await store.get<Array<{id: string, content: string}>>('promptList')
    if (promptList) {
      const currentPrompt = promptList.find(prompt => prompt.id === currentPromptId)
      if (currentPrompt && currentPrompt.content) {
        promptContent = currentPrompt.content
      }
    }
  }
  
  return promptContent
}

/**
 * 获取AI设置
 */
async function getAISettings(modelType?: string): Promise<AiConfig | undefined> {
  const store = await Store.load('store.json')
  const aiConfigs = await store.get<AiConfig[]>('aiModelList')
  const modelKey = await store.get(modelType || 'primaryModel')
  if (!modelKey) {
    const primaryModel = await store.get<string>('primaryModel')
    return aiConfigs?.find(item => item.key === primaryModel)
  } else {
    return aiConfigs?.find(item => item.key === modelKey)
  }
}

/**
 * 检查AI服务配置是否有效
 */
async function validateAIService(baseURL: string | undefined): Promise<string | null> {
  if (!baseURL) {
    toast({
      title: 'AI 错误',
      description: '请先设置 AI 地址',
      variant: 'destructive',
    })
    return null
  }
  return baseURL
}

/**
 * 处理AI请求错误
 */
export function handleAIError(error: any, showToast = true): string | null {
  console.error(error)
  const errorMessage = error instanceof Error ? error.message : '未知错误'
  
  if (showToast) {
    toast({
      description: errorMessage || 'AI错误',
      variant: 'destructive',
    })
  }
  
  return `请求失败: ${errorMessage}`
}

// 嵌入请求响应类型
interface EmbeddingResponse {
  object: string;
  model: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * 获取嵌入模型信息
 */
async function getEmbeddingModelInfo() {
  const store = await Store.load('store.json');
  const embeddingModel = await store.get<string>('embeddingModel');
  if (!embeddingModel) return null;
  
  const aiModelList = await store.get<AiConfig[]>('aiModelList');
  if (!aiModelList) return null;
  
  const modelInfo = aiModelList.find(item => 
    item.key === embeddingModel && item.modelType === 'embedding'
  );
  
  return modelInfo || null;
}

/**
 * 获取重排序模型信息
 */
export async function getRerankModelInfo() {
  const store = await Store.load('store.json');
  const rerankModel = await store.get<string>('rerankingModel');
  if (!rerankModel) return null;
  
  const aiModelList = await store.get<AiConfig[]>('aiModelList');
  if (!aiModelList) return null;
  
  const modelInfo = aiModelList.find(item => 
    item.key === rerankModel && item.modelType === 'rerank'
  );
  
  return modelInfo || null;
}

/**
 * 检查是否有重排序模型可用
 */
export async function checkRerankModelAvailable(): Promise<boolean> {
  try {
    // 获取重排序模型信息
    const modelInfo = await getRerankModelInfo();
    if (!modelInfo) return false;
    
    const { baseURL, apiKey, model } = modelInfo;
    if (!baseURL || !apiKey || !model) return false;
    
    // 测试重排序模型
    const testQuery = '测试查询';
    const testDocuments = [
      '这是一个测试文档', 
      '这是另一个测试文档'
    ];
    
    // 发送测试请求
    const response = await fetch(baseURL + '/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        query: testQuery,
        documents: testDocuments
      })
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    return !!(data && data.results);
  } catch (error) {
    console.error('重排序模型检查失败:', error);
    return false;
  }
}

/**
 * 请求嵌入向量
 * @param text 需要嵌入的文本
 * @returns 嵌入向量结果，如果失败则返回null
 */
export async function fetchEmbedding(text: string): Promise<number[] | null> {
  try {
    if (text.length) {
      // 获取嵌入模型信息
      const modelInfo = await getEmbeddingModelInfo();
      if (!modelInfo) {
        throw new Error('未配置嵌入模型或模型配置不正确');
      }
      
      const { baseURL, apiKey, model } = modelInfo;

      if (!baseURL || !apiKey || !model) {
        throw new Error('嵌入模型配置不完整');
      }
      
      // 发送嵌入请求
      const response = await fetch(baseURL + '/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          input: text,
          encoding_format: 'float'
        })
      });

      if (!response.ok) {
        throw new Error(`嵌入请求失败: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as EmbeddingResponse;
      if (!data || !data.data || !data.data[0] || !data.data[0].embedding) {
        throw new Error('嵌入结果格式不正确');
      }
      
      return data.data[0].embedding;
    }
    
    return null;
  } catch (error) {
    handleAIError(error);
    return null;
  }
}

/**
 * 使用重排序模型重新排序检索的文档
 * @param query 用户查询
 * @param documents 要重新排序的文档列表
 * @returns 重新排序后的文档列表
 */
export async function rerankDocuments(
  query: string,
  documents: {id: number, filename: string, content: string, similarity: number}[]
): Promise<{id: number, filename: string, content: string, similarity: number}[]> {
  try {
    // 检查是否有文档需要重排序
    if (!documents.length) {
      return documents;
    }
    
    // 获取重排序模型信息
    const modelInfo = await getRerankModelInfo();
    if (!modelInfo) {
      // 如果没有配置重排序模型，返回原始排序
      return documents;
    }
    
    const { baseURL, apiKey, model } = modelInfo;
    
    if (!baseURL || !apiKey || !model) {
      return documents; // 配置不完整，返回原始排序
    }
    
    // 构建重排序请求数据
    // 注意：这里使用了OpenAI的格式，但可能需要根据实际使用的模型调整
    const passages = documents.map(doc => doc.content);
    
    const response = await fetch(baseURL + '/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        query: query,
        documents: passages
      })
    });
    
    if (!response.ok) {
      throw new Error(`重排序请求失败: ${response.status} ${response.statusText}`);
    }
    
    // 解析响应
    const data = await response.json();
    
    // 检查响应格式
    if (!data || !data.results) {
      throw new Error('重排序结果格式不正确');
    }
    
    // 处理重排序结果
    // 将原始文档与新的相似度分数结合
    const rerankResults = data.results.map((result: any, index: number) => {
      return {
        ...documents[result.document_index || index],
        similarity: result.relevance_score || result.score || documents[index].similarity
      };
    });
    
    // 根据新的相似度分数排序
    return rerankResults.sort((a: {similarity: number}, b: {similarity: number}) => b.similarity - a.similarity);
  } catch (error) {
    console.error('重排序失败:', error);
    // 发生错误时返回原始排序
    return documents;
  }
}

/**
 * 为不同AI类型准备消息
 */
async function prepareMessages(text: string, includeLanguage = false): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  geminiText?: string
}> {
  // 获取prompt内容
  let promptContent = await getPromptContent()
  
  if (includeLanguage) {
    const store = await Store.load('store.json')
    const chatLanguage = await store.get<string>('chatLanguage') || 'en'
    promptContent += '\n\n' + `Use **${chatLanguage}** to answer.`
  }
  
  // 定义消息数组
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let geminiText: string | undefined
  
  if (promptContent) {
    messages.push({
      role: 'system',
      content: promptContent
    })
  }
  
  messages.push({
    role: 'user',
    content: text
  })
  
  return { messages, geminiText }
}

/**
 * 创建OpenAI客户端，适用于所有AI类型
 */
export async function createOpenAIClient(AiConfig?: AiConfig) {
  const store = await Store.load('store.json')
  let baseURL
  let apiKey
  if (AiConfig) {
    baseURL = AiConfig.baseURL
    apiKey = AiConfig.apiKey
  } else {
    baseURL = await store.get<string>('baseURL')
    apiKey = await store.get<string>('apiKey')
  }
  const proxyUrl = await store.get<string>('proxy')
  
  // 创建OpenAI客户端
  return new OpenAI({
    apiKey: apiKey || '',
    baseURL: baseURL,
    dangerouslyAllowBrowser: true,
    defaultHeaders:{
      "x-stainless-arch": null,
      "x-stainless-lang": null,
      "x-stainless-os": null,
      "x-stainless-package-version": null,
      "x-stainless-retry-count": null,
      "x-stainless-runtime": null,
      "x-stainless-runtime-version": null,
      "x-stainless-timeout": null,
    },
    ...(proxyUrl ? { httpAgent: proxyUrl } : {})
  })
}

/**
 * 非流式方式获取AI结果
 */
export async function fetchAi(text: string): Promise<string> {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings()
    
    // 验证AI服务
    if (validateAIService(aiConfig?.baseURL) === null) return ''
    
    // 准备消息
    const { messages } = await prepareMessages(text)

    const openai = await createOpenAIClient(aiConfig)
    
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })
    
    return completion.choices[0].message.content || ''
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 流式方式获取AI结果
 * @param text 请求文本
 * @param onUpdate 每次收到流式内容时的回调函数
 * @param abortSignal 用于终止请求的信号
 */
export async function fetchAiStream(text: string, onUpdate: (content: string) => void, abortSignal?: AbortSignal): Promise<string> {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings()
    
    // 验证AI服务
    if (await validateAIService(aiConfig?.baseURL) === null) return ''
    
    // 准备消息
    const { messages } = await prepareMessages(text, true)

    const openai = await createOpenAIClient(aiConfig)
    const stream = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature,
      top_p: aiConfig?.topP,
      stream: true,
    })
    
    let thinking = ''
    let fullContent = ''
    
    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break;
      }
      
      const thinkingContent = (chunk.choices[0]?.delta as any)?.reasoning_content || ''
      const content = chunk.choices[0]?.delta?.content || ''
      if (thinkingContent) {
        thinking += thinkingContent
        fullContent = `<thinking>${thinking}<thinking>`
      }
      if (content) {
        fullContent += content
      }
      onUpdate(fullContent)
    }
    
    return fullContent
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 流式方式获取AI结果，每次返回本次 token
 * @param text 请求文本
 * @param onUpdate 每次收到流式内容时的回调函数
 */
export async function fetchAiStreamToken(text: string, onUpdate: (content: string) => void): Promise<string> {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings()
    
    // 验证AI服务
    if (await validateAIService(aiConfig?.baseURL) === null) return ''
    
    // 准备消息
    const { messages } = await prepareMessages(text, true)
  
    const openai = await createOpenAIClient(aiConfig)
    const stream = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature,
      top_p: aiConfig?.topP,
      stream: true,
    })
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        onUpdate(content)
      }
    }
    
    return ''
  } catch (error) {
    return handleAIError(error) || ''
  }
}

// 生成描述描述
export async function fetchAiDesc(text: string) {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings('markDescPrimaryModel')
    
    const descContent = `根据截图的内容：${text}，返回一条描述，不要超过50字，不要包含特殊字符。`
    
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: [{
        role: 'user' as const,
        content: descContent
      }],
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })
    
    return completion.choices[0].message.content || ''
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}

// placeholder
export async function fetchAiPlaceholder(text: string): Promise<string> {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings('placeholderPrimaryModel')

    // 构建 placeholder 提示词
    const placeholderPrompt = `Generate a placeholder for the following text: ${text}`

    // 准备消息
    const { messages } = await prepareMessages(`${placeholderPrompt}\n\n${text}`, false)
    
    const openai = await createOpenAIClient(aiConfig)
      
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })

    const result = completion.choices[0]?.message?.content || ''
    // 去掉所有换行符和各种特殊符号
    return result.replace(/\n/g, '').replace(/\s/g, '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

// 翻译
export async function fetchAiTranslate(text: string, targetLanguage: string): Promise<string> {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings('translatePrimaryModel')
    
    // 构建翻译提示词
    const translationPrompt = `Translate the following text to ${targetLanguage}. Maintain the original formatting, markdown syntax, and structure:`
    
    // 准备消息
    const { messages } = await prepareMessages(`${translationPrompt}\n\n${text}`, false)
    const openai = await createOpenAIClient(aiConfig)
    
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })
    
    return completion.choices[0]?.message?.content || ''
  } catch (error) {
    return handleAIError(error) || ''
  }
}

export async function checkAiStatus() {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings()
    
    if (!aiConfig?.baseURL || !aiConfig?.model) return false
    
    // 获取模型配置信息
    const store = await Store.load('store.json');
    const aiModelList = await store.get<AiConfig[]>('aiModelList');
    if (!aiModelList) return false;
    
    const modelConfig = aiModelList.find(item => item.key === aiConfig?.model);
    if (!modelConfig) return false;
    // 根据模型类型选择测试方法
    if (modelConfig.modelType === 'rerank') {
      // 重排序模型测试
      const testQuery = '测试查询';
      const testDocuments = [
        '这是一个测试文档', 
        '这是另一个测试文档'
      ];
      
      // 发送重排序测试请求
      const response = await fetch(aiConfig?.baseURL + '/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${modelConfig.apiKey}`
        },
        body: JSON.stringify({
          model: aiConfig?.model,
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
    } else if (modelConfig.modelType === 'embedding') {
      // 嵌入模型测试
      const testText = '测试文本';
      const embedding = await fetchEmbedding(testText);
      if (!embedding) {
        throw new Error('嵌入模型测试失败');
      }
    } else {
      const openai = await createOpenAIClient()
      await openai.chat.completions.create({
        model: aiConfig?.model,
        messages: [{
          role: 'user' as const,
          content: 'Hello'
        }],
      })
    }
    
    return true
  } catch (error) {
    // 捕获错误但不处理
    console.error('AI 状态检查失败:', error);
    return false
  }
}
