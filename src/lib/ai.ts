import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import OpenAI from 'openai';
import { GoogleGenAI } from "@google/genai";
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
async function getAISettings() {
  const store = await Store.load('store.json')
  const baseURL = await store.get<string>('baseURL')
  const apiKey = await store.get<string>('apiKey')
  const model = await store.get<string>('model') || 'gpt-3.5-turbo'
  const aiType = await store.get<string>('aiType') || 'openai'
  const temperature = await store.get<number>('temperature') || 0.7
  const topP = await store.get<number>('topP') || 1
  const chatLanguage = await store.get<string>('chatLanguage') || 'en'
  const proxyUrl = await store.get<string>('proxy')
  
  return {
    baseURL,
    apiKey,
    model,
    aiType,
    temperature,
    topP,
    chatLanguage,
    proxyUrl
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
async function prepareMessages(text: string, aiType: string, includeLanguage = false): Promise<{
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
  let messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let geminiText: string | undefined
  
  // 根据不同AI类型构建请求
  if (aiType === 'gemini') {
    // 对于Gemini，我们将使用@google/genai库
    const finalText = promptContent ? `${promptContent}\n\n${text}` : text
    messages = [{
      role: 'user', 
      content: finalText
    }]
    geminiText = finalText
  } else {
    // OpenAI/Ollama 请求
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
  }
  
  return { messages, geminiText }
}

/**
 * 创建OpenAI客户端，适用于所有AI类型
 */
async function createOpenAIClient(AiConfig?: AiConfig) {
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

// 创建Google Gemini客户端
async function createGeminiClient(AiConfig?: AiConfig) {
  let apiKey: string | undefined
  const store = await Store.load('store.json')
  if (AiConfig?.apiKey) {
    apiKey = AiConfig.apiKey
  } else {
    apiKey = await store.get<string>('apiKey')
  }
  
  // 创建Gemini客户端
  return new GoogleGenAI({apiKey: apiKey || ''});
}

// 根据名称获取模型信息
async function getModelInfo(name: string) {
  const store = await Store.load('store.json')
  const aiModelList = await store.get<AiConfig[]>('aiModelList')
  if (!aiModelList) return
  const modelConfig = aiModelList.find(item => item.key === name)
  if (!modelConfig) return
  return modelConfig
}

/**
 * 非流式方式获取AI结果
 */
export async function fetchAi(text: string): Promise<string> {
  try {
    // 获取AI设置
    const { baseURL, model, aiType, temperature, topP } = await getAISettings()
    
    // 验证AI服务
    if (validateAIService(baseURL) === null) return ''
    
    // 准备消息
    const { messages, geminiText } = await prepareMessages(text, aiType)
    
    // 根据不同AI类型构建请求
    if (aiType === 'gemini') {
      // 创建Gemini客户端
      const genAI = await createGeminiClient()
      
      const result = await genAI.models.generateContent({
        model: model,
        contents: {
          parts: [{ text: geminiText || text }]
        },
        temperature: temperature,
        topP: topP
      })
      
      return result.text || ''
    } else {
      // OpenAI/Ollama请求
      const openai = await createOpenAIClient()
      
      const completion = await openai.chat.completions.create({
        model: model,
        messages: messages,
        temperature: temperature,
        top_p: topP,
      })
      
      return completion.choices[0].message.content || ''
    }
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
    const { baseURL, model, aiType, temperature, topP } = await getAISettings()
    
    // 验证AI服务
    if (await validateAIService(baseURL) === null) return ''
    
    // 准备消息
    const { messages, geminiText } = await prepareMessages(text, aiType, true)

    // 根据不同AI类型进行流式请求
    if (aiType === 'gemini') {
      // Gemini API流式请求使用@google/genai
      const genAI = await createGeminiClient()
      
      let fullContent = ''
      const response = await genAI.models.generateContentStream({
        model: model,
        contents: {
          parts: [{ text: geminiText || text }]
        },
        temperature: temperature,
        topP: topP
      })
      
      for await (const chunk of response) {
        if (abortSignal?.aborted) {
          break;
        }
        
        if (chunk.text) {
          fullContent += chunk.text
          onUpdate(fullContent)
        }
      }
      
      return fullContent
    } else {
      const openai = await createOpenAIClient()
      const stream = await openai.chat.completions.create({
        model: model,
        messages: messages,
        temperature: temperature,
        top_p: topP,
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
    }
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
    const { baseURL, model, aiType, temperature, topP } = await getAISettings()
    
    // 验证AI服务
    if (await validateAIService(baseURL) === null) return ''
    
    // 准备消息
    const { messages, geminiText } = await prepareMessages(text, aiType, true)
    
    // 根据不同AI类型进行流式请求
    if (aiType === 'gemini') {
      // Gemini API流式请求使用@google/genai
      const genAI = await createGeminiClient()
      
      const streamingResult = await genAI.models.generateContentStream({
        model: model,
        contents: {
          parts: [{ text: geminiText || text }]
        },
        temperature: temperature,
        topP: topP
      })
      
      for await (const chunk of streamingResult) {
        if (chunk.text) {
          onUpdate(chunk.text)
        }
      }
      
      return ''
    } else {
      const openai = await createOpenAIClient()
      const stream = await openai.chat.completions.create({
        model: model,
        messages: messages,
        temperature: temperature,
        top_p: topP,
        stream: true,
      })
      
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        if (content) {
          onUpdate(content)
        }
      }
      
      return ''
    }
  } catch (error) {
    return handleAIError(error) || ''
  }
}

// 生成描述描述
export async function fetchAiDesc(text: string) {
  try {
    // 获取AI设置
    const { model, temperature, topP } = await getAISettings()
    
    const descContent = `
      根据截图的内容：${text}，返回一条描述，不要超过50字，不要包含特殊字符。
    `
    
    const store = await Store.load('store.json');
    const markDescModel = await store.get<string>('markDescModel')

    const modelInfo = await getModelInfo(markDescModel || '')

    // 根据不同AI类型构建请求
    if (modelInfo?.key === 'gemini') {
      // 创建 Gemini 客户端
      const genAI = await createGeminiClient(modelInfo)
      
      // 使用 Gemini API
      const result = await genAI.models.generateContent({
        model: modelInfo?.model || model,
        contents: {
          parts: [{ text: descContent }]
        },
        temperature: temperature,
        topP: modelInfo?.topP || topP
      })
      
      // 获取响应文本
      return result.candidates?.[0]?.content?.parts?.[0]?.text || ''      
    } else {
      const openai = await createOpenAIClient(modelInfo)
      const completion = await openai.chat.completions.create({
        model: modelInfo?.model || model,
        messages: [{
          role: 'user' as const,
          content: descContent
        }],
        temperature: temperature,
        top_p: topP,
      })
      
      return completion.choices[0].message.content || ''
    }
  } catch (error) {
    await handleAIError(error, false)
    return null
  }
}

// placeholder
export async function fetchAiPlaceholder(text: string): Promise<string> {
  try {
    // 获取AI设置
    const { model, temperature, topP } = await getAISettings()
    
    // 构建 placeholder 提示词
    const placeholderPrompt = `Generate a placeholder for the following text: ${text}`
    
    const store = await Store.load('store.json');
    const placeholderModel = await store.get<string>('placeholderModel')

    const modelInfo = await getModelInfo(placeholderModel || '')

    // 准备消息
    const { messages, geminiText } = await prepareMessages(`${placeholderPrompt}\n\n${text}`, modelInfo?.key || 'openai', false)
    
    // 根据不同AI类型构建请求
    if (modelInfo?.key === 'gemini') {
      // 创建Gemini客户端
      const genAI = await createGeminiClient(modelInfo)
      
      const result = await genAI.models.generateContent({
        model: modelInfo?.model || model,
        contents: {
          parts: [{ text: geminiText || `${placeholderPrompt}\n\n${text}` }]
        },
        temperature: temperature,
        topP: modelInfo?.topP || topP
      })
      
      return result.text || ''
    } else {
      const openai = await createOpenAIClient(modelInfo)
      
      const completion = await openai.chat.completions.create({
        model: modelInfo?.model || model,
        messages: messages,
        temperature: temperature,
        top_p: modelInfo?.topP || topP
      })
      
      return completion.choices[0]?.message?.content || ''
    }
  } catch (error) {
    return handleAIError(error) || ''
  }
}

// 翻译
export async function fetchAiTranslate(text: string, targetLanguage: string): Promise<string> {
  try {
    // 获取AI设置
    const { model, temperature, topP } = await getAISettings()
    
    // 构建翻译提示词
    const translationPrompt = `Translate the following text to ${targetLanguage}. Maintain the original formatting, markdown syntax, and structure:`
    
    const store = await Store.load('store.json');
    const translateModel = await store.get<string>('translateModel')

    const modelInfo = await getModelInfo(translateModel || '')

    // 准备消息
    const { messages, geminiText } = await prepareMessages(`${translationPrompt}\n\n${text}`, modelInfo?.key || 'openai', false)
    
    // 根据不同AI类型构建请求
    if (modelInfo?.key === 'gemini') {
      // 创建Gemini客户端
      const genAI = await createGeminiClient(modelInfo)
      
      const result = await genAI.models.generateContent({
        model: modelInfo?.model || model,
        contents: {
          parts: [{ text: geminiText || `${translationPrompt}\n\n${text}` }]
        },
        temperature: temperature,
        topP: modelInfo?.topP || topP
      })
      
      return result.text || ''
    } else {
      const openai = await createOpenAIClient(modelInfo)
      
      const completion = await openai.chat.completions.create({
        model: modelInfo?.model || model,
        messages: messages,
        temperature: temperature,
        top_p: modelInfo?.topP || topP
      })
      
      return completion.choices[0]?.message?.content || ''
    }
  } catch (error) {
    return handleAIError(error) || ''
  }
}

export async function checkAiStatus() {
  try {
    // 获取AI设置
    const { baseURL, model, aiType } = await getAISettings()
    
    if (!baseURL || !aiType) return false
    
    // 获取模型配置信息
    const store = await Store.load('store.json');
    const aiModelList = await store.get<AiConfig[]>('aiModelList');
    if (!aiModelList) return false;
    
    const modelConfig = aiModelList.find(item => item.key === aiType);
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
      const response = await fetch(baseURL + '/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${modelConfig.apiKey}`
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
    } else if (modelConfig.modelType === 'embedding') {
      // 嵌入模型测试
      const testText = '测试文本';
      const embedding = await fetchEmbedding(testText);
      if (!embedding) {
        throw new Error('嵌入模型测试失败');
      }
    } else {
      // 对话模型测试 (!modelConfig.modelType || modelConfig.modelType === 'chat')
      if (aiType === 'gemini') {
        // Gemini - 使用@google/genai
        const genAI = await createGeminiClient()
        
        await genAI.models.generateContent({
          model: model,
          contents: {
            parts: [{ text: 'Hello' }]
          }
        })
      } else {
        // OpenAI/Ollama
        const openai = await createOpenAIClient()
        await openai.chat.completions.create({
          model,
          messages: [{
            role: 'user' as const,
            content: 'Hello'
          }],
        })
      }
    }
    
    return true
  } catch (error) {
    // 捕获错误但不处理
    console.error('AI 状态检查失败:', error);
    return false
  }
}

export async function getModels() {
  try {
    // 获取AI设置
    const { baseURL, aiType } = await getAISettings()
    
    if (!baseURL || !aiType) return []
    
    if (aiType === 'gemini') {
      return []
    } else {
      // OpenAI/Ollama模型列表
      const openai = await createOpenAIClient()
      const models = await openai.models.list()
      const uniqueModels = models.data.filter((model, index) => models.data.findIndex(m => m.id === model.id) === index)
      return uniqueModels
    }
  } catch {
    return []
  }
}