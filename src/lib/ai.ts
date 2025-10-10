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
  const modelId = await store.get(modelType || 'primaryModel')
  
  if (!modelId || !aiConfigs) {
    return undefined
  }

  // 在新的数据结构中，需要找到包含指定模型ID的配置
  for (const config of aiConfigs) {
    // 检查新的 models 数组结构
    if (config.models && config.models.length > 0) {
      // 首先尝试直接匹配模型ID
      let targetModel = config.models.find(model => model.id === modelId)
      
      // 如果没找到，尝试匹配组合键格式 ${config.key}-${model.id}
      if (!targetModel && typeof modelId === 'string' && modelId.includes('-')) {
        const expectedPrefix = `${config.key}-`
        if (modelId.startsWith(expectedPrefix)) {
          const originalModelId = modelId.substring(expectedPrefix.length)
          targetModel = config.models.find(model => model.id === originalModelId)
        }
      }
      
      if (targetModel) {
        // 返回合并了模型配置的 AiConfig
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        }
      }
    } else {
      // 向后兼容：处理旧的单模型结构
      if (config.key === modelId) {
        return config
      }
    }
  }
  
  return undefined
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
  const errorMessage = error instanceof Error ? error.message : '未知错误'
  // 检查是否是取消请求的错误，如果是则静默处理
  if (error.message === 'Request was aborted.') {
    // 静默处理取消请求，不显示任何消息
    return null
  }
  
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
  
  // 在新的数据结构中，需要找到包含指定模型ID的配置
  for (const config of aiModelList) {
    // 检查新的 models 数组结构
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(model => 
        model.id === embeddingModel && model.modelType === 'embedding'
      );
      if (targetModel) {
        // 返回合并了模型配置的 AiConfig
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        };
      }
    } else {
      // 向后兼容：处理旧的单模型结构
      if (config.key === embeddingModel && config.modelType === 'embedding') {
        return config;
      }
    }
  }
  
  return null;
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
  
  // 在新的数据结构中，需要找到包含指定模型ID的配置
  for (const config of aiModelList) {
    // 检查新的 models 数组结构
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(model => 
        model.id === rerankModel && model.modelType === 'rerank'
      );
      if (targetModel) {
        // 返回合并了模型配置的 AiConfig
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        };
      }
    } else {
      // 向后兼容：处理旧的单模型结构
      if (config.key === rerankModel && config.modelType === 'rerank') {
        return config;
      }
    }
  }
  
  return null;
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
    if (!baseURL || !model) return false;
    
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

      if (!baseURL || !model) {
        throw new Error('嵌入模型配置不完整');
      }
      
      // 发送嵌入请求
      const response = await fetch(baseURL + '/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Origin': ""
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
    
    if (!baseURL || !model) {
      return documents; // 配置不完整，返回原始排序
    }
    
    // 构建重排序请求数据
    // 注意：这里使用了OpenAI的格式，但可能需要根据实际使用的模型调整
    const passages = documents.map(doc => doc.content);
    
    const response = await fetch(baseURL + '/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Origin': ""
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
        ...documents[result.document_index || result.index || index],
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
      ...(AiConfig?.customHeaders || {})
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
 * @param mcpTools MCP 工具列表（可选）
 * @param t 翻译函数（可选）
 * @param chatId 当前chat ID，用于关联MCP工具调用记录（可选）
 */
export async function fetchAiStream(
  text: string, 
  onUpdate: (content: string) => void, 
  abortSignal?: AbortSignal,
  mcpTools?: any[],
  t?: (key: string, params?: Record<string, any>) => string,
  chatId?: number
): Promise<string> {
  try {

    
    // 获取AI设置
    const aiConfig = await getAISettings()
    
    // 验证AI服务
    if (await validateAIService(aiConfig?.baseURL) === null) return ''
    
    // 准备消息
    const { messages } = await prepareMessages(text, true)

    const openai = await createOpenAIClient(aiConfig)
    
    // 构建请求参数
    const requestParams: any = {
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature,
      top_p: aiConfig?.topP,
      stream: true,
    }
    
    // 如果有 MCP 工具，添加到请求中
    if (mcpTools && mcpTools.length > 0) {
      requestParams.tools = mcpTools
      requestParams.tool_choice = 'auto'
    }
    
    const stream = await openai.chat.completions.create(requestParams, {
      signal: abortSignal
    }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    
    
    let thinking = ''
    let fullContent = ''
    const toolCalls: any[] = []
    let hasToolCalls = false
    
    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break;
      }
      
      const delta = chunk.choices[0]?.delta
      const thinkingContent = (delta as any)?.reasoning_content || ''
      const content = delta?.content || ''
      
      // 处理工具调用
      if (delta?.tool_calls) {
        hasToolCalls = true
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index || 0
          
          // 初始化工具调用对象
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCall.id || '',
              type: 'function',
              function: {
                name: toolCall.function?.name || '',
                arguments: ''
              }
            }
          }
          
          // 累积工具调用参数
          if (toolCall.function?.arguments) {
            toolCalls[index].function.arguments += toolCall.function.arguments
          }
          
          // 更新其他字段
          if (toolCall.id) {
            toolCalls[index].id = toolCall.id
          }
          if (toolCall.function?.name) {
            toolCalls[index].function.name = toolCall.function.name
          }
        }
      }
      
      // 如果有工具调用，不显示中间内容，直接跳过
      if (hasToolCalls) {
        continue
      }
      
      // 处理思考内容
      if (thinkingContent) {
        thinking += thinkingContent
        fullContent = `<thinking>${thinking}<thinking>`
      }
      
      // 处理普通内容
      if (content) {
        fullContent += content
      }
      
      onUpdate(fullContent)
    }
    
    // 如果有工具调用，执行工具并继续对话（支持多轮工具调用）
    if (toolCalls.length > 0) {
      // 动态导入 callTool 函数（避免循环依赖）
      const { callTool } = await import('./mcp/tools')
      
      // 初始化消息历史
      let conversationMessages = [...messages]
      let currentToolCalls = toolCalls
      const maxIterations = 10 // 防止无限循环
      let iteration = 0
      
      // 循环处理工具调用，直到 AI 不再调用工具
      while (currentToolCalls.length > 0 && iteration < maxIterations) {
        iteration++

        onUpdate('')
        
        // 执行所有工具调用
        const toolResults = []
        for (const toolCall of currentToolCalls) {
          let mcpToolCallId: string | undefined
          try {
            // 解析工具名称（格式：serverId__toolName）
            const fullName = toolCall.function.name
            const [serverId, ...toolNameParts] = fullName.split('__')
            const toolName = toolNameParts.join('__')
            
            // 解析参数
            const args = JSON.parse(toolCall.function.arguments)
            
            // 记录 MCP 工具调用（如果提供了 chatId）
            if (chatId) {
              const { useMcpStore } = await import('@/stores/mcp')
              const { default: useChatStore } = await import('@/stores/chat')
              const mcpStore = useMcpStore.getState()
              const chatStore = useChatStore.getState()
              const server = mcpStore.servers.find(s => s.id === serverId)
              
              mcpToolCallId = `${toolCall.id}-${Date.now()}`
              chatStore.addMcpToolCall({
                id: mcpToolCallId,
                chatId,
                toolName,
                serverId,
                serverName: server?.name || serverId,
                params: args,
                result: '',
                status: 'calling',
                timestamp: Date.now()
              })
            }
            
            // 调用 MCP 工具
            const result = await callTool(serverId, toolName, args)
            
            // 格式化结果
            const resultText = result.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('\n')
            
            // 更新 MCP 工具调用状态为成功
            if (chatId && mcpToolCallId) {
              const { default: useChatStore } = await import('@/stores/chat')
              const chatStore = useChatStore.getState()
              chatStore.updateMcpToolCall(mcpToolCallId, {
                result: resultText || 'Tool executed successfully',
                status: 'success'
              })
            }
            
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: resultText || 'Tool executed successfully'
            })
            
          } catch (error) {
            console.error('工具调用失败:', error)
            
            // 更新 MCP 工具调用状态为错误
            if (chatId && mcpToolCallId) {
              const { default: useChatStore } = await import('@/stores/chat')
              const chatStore = useChatStore.getState()
              const errorMsg = error instanceof Error ? error.message : 'Unknown error'
              chatStore.updateMcpToolCall(mcpToolCallId, {
                result: `Error: ${errorMsg}`,
                status: 'error'
              })
            }
            
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            })
          }
        }
        
        // 将工具调用和结果添加到消息历史
        conversationMessages = [
          ...conversationMessages,
          {
            role: 'assistant' as const,
            content: null,
            tool_calls: currentToolCalls
          },
          ...toolResults
        ]
        
        const nextStream = await openai.chat.completions.create({
          model: aiConfig?.model || '',
          messages: conversationMessages,
          temperature: aiConfig?.temperature,
          top_p: aiConfig?.topP,
          stream: true,
          tools: mcpTools,
          tool_choice: 'auto'
        }, {
          signal: abortSignal
        }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
        
        // 重置工具调用数组
        currentToolCalls = []
        thinking = ''
        fullContent = ''
        
        // 处理响应
        for await (const chunk of nextStream) {
          if (abortSignal?.aborted) {
            break;
          }
          
          const delta = chunk.choices[0]?.delta
          const thinkingContent = (delta as any)?.reasoning_content || ''
          const content = delta?.content || ''
          
          // 检查是否又有新的工具调用
          if (delta?.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index || 0
              
              if (!currentToolCalls[index]) {
                currentToolCalls[index] = {
                  id: toolCall.id || '',
                  type: 'function',
                  function: {
                    name: toolCall.function?.name || '',
                    arguments: ''
                  }
                }
              }
              
              if (toolCall.function?.arguments) {
                currentToolCalls[index].function.arguments += toolCall.function.arguments
              }
              
              if (toolCall.id) {
                currentToolCalls[index].id = toolCall.id
              }
              if (toolCall.function?.name) {
                currentToolCalls[index].function.name = toolCall.function.name
              }
            }
          }
          
          // 如果有新的工具调用，不显示内容
          if (currentToolCalls.length > 0) {
            continue
          }
          
          // 显示普通内容
          if (thinkingContent) {
            thinking += thinkingContent
            fullContent = `<thinking>${thinking}<thinking>`
          }
          if (content) {
            fullContent += content
          }
          onUpdate(fullContent)
        }
        
        // 如果没有新的工具调用，退出循环
        if (currentToolCalls.length === 0) {
          break
        }
      }
      
      if (iteration >= maxIterations) {
        console.warn('达到最大工具调用次数限制')
        const maxIterationsText = t ? t('record.mark.mark.chat.mcp.maxIterationsReached') : '⚠️ 达到最大工具调用次数限制'
        onUpdate(fullContent + '\n\n' + maxIterationsText)
      }
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
 * @param abortSignal 用于终止请求的信号
 */
export async function fetchAiStreamToken(text: string, onUpdate: (content: string) => void, abortSignal?: AbortSignal): Promise<string> {
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
    }, {
      signal: abortSignal
    })
    
    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break;
      }
      
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
    const aiConfig = await getAISettings('markDescModel')
    
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

export async function fetchAiDescByImage(base64: string) {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings('imageMethodModel')

    const descContent = `根据截图的内容，返回一条描述。`
    
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: [{
        role: 'user' as const,
        content: [
          {
            type: 'image_url',
            image_url: {
              url: base64
            }
          },
          {
            type: 'text',
            text: descContent
          }
        ]
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
export async function fetchAiPlaceholder(text: string): Promise<string | false> {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings('placeholderModel')
    
    // 检查配置是否存在
    if (!aiConfig) {
      console.error('Placeholder model not configured')
      return false
    }

    // 构建 placeholder 提示词
    const placeholderPrompt = `
      You are a note-taking software with an intelligent assistant. You can refer to the recorded content to take notes.
      Do not exceed 20 characters.
      There is only one line left. Line breaks are prohibited.
      Do not generate any special characters.
      Leave it as plain text and no format is required.
      Generate a question based on the following content:
      ${text}`

    // 准备消息
    const { messages } = await prepareMessages(placeholderPrompt, false)
    
    const openai = await createOpenAIClient(aiConfig)
      
    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages: messages,
      temperature: aiConfig.temperature || 1,
      top_p: aiConfig.topP || 1,
    })

    const result = completion.choices[0]?.message?.content || ''

    // 去掉所有换行符和各种特殊符号，不包括空格
    return result.trim()
  } catch (error) {
    console.error('Error in fetchAiPlaceholder:', error)
    return false
  }
}

// 翻译
export async function fetchAiTranslate(text: string, targetLanguage: string): Promise<string> {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings('translateModel')
    
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
