/**
 * AI API 集成示例
 * 
 * 这个文件展示了如何将 ReAct 引擎与实际的 LLM API 集成
 * 需要根据你使用的 AI 服务（OpenAI、Claude、本地模型等）进行调整
 */

import { ReActAgent, ReActConfig } from './react'

/**
 * 调用 LLM API 获取 AI 响应
 * 这是一个示例函数，需要替换为实际的 API 调用
 */
async function callLLM(prompt: string, signal?: AbortSignal): Promise<string> {
  // 示例：使用 OpenAI API
  // 实际使用时，应该调用项目中已有的 AI 接口
  
  // 方案 1: 使用项目现有的 fetchAiStream
  // import { fetchAiStream } from '@/lib/ai'
  // let response = ''
  // await fetchAiStream(prompt, (content) => {
  //   response = content
  // }, signal)
  // return response

  // 方案 2: 直接调用 OpenAI API
  // const response = await fetch('https://api.openai.com/v1/chat/completions', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
  //   },
  //   body: JSON.stringify({
  //     model: 'gpt-4',
  //     messages: [{ role: 'user', content: prompt }],
  //   }),
  //   signal,
  // })
  // const data = await response.json()
  // return data.choices[0].message.content

  // 临时占位符 - 实际使用时需要替换
  console.log('LLM Prompt:', prompt)
  return `Thought: 我需要分析用户的请求
Action: list_tags
Action Input: {}

观察到标签列表后，我会继续下一步操作。`
}

/**
 * 创建一个集成了 AI API 的 ReAct Agent
 */
export function createAIAgent(config: Omit<ReActConfig, 'maxIterations'>): ReActAgent {
  const enhancedConfig: ReActConfig = {
    ...config,
    maxIterations: config.maxIterations || 10,
  }

  // 创建 Agent 实例
  const agent = new ReActAgent(enhancedConfig)

  // 重写 think 方法以集成实际的 LLM API
  const originalRun = agent.run.bind(agent)
  
  agent.run = async function(userInput: string, context?: string): Promise<string> {
    // 这里可以添加预处理逻辑
    console.log('Starting Agent with input:', userInput)
    
    // 调用原始的 run 方法
    // 注意：需要修改 ReActAgent 的 think 方法来实际调用 LLM
    return await originalRun(userInput, context)
  }

  return agent
}

/**
 * 使用示例
 */
export async function exampleUsage() {
  const agent = createAIAgent({
    maxIterations: 10,
    onThought: (thought) => {
      console.log('💭 Thought:', thought)
    },
    onAction: (action, params) => {
      console.log('⚡ Action:', action, params)
    },
    onObservation: (observation) => {
      console.log('👁️ Observation:', observation)
    },
    requestConfirmation: async (toolName, params) => {
      console.log('🔔 Confirmation needed:', toolName, params)
      // 在实际应用中，这里应该显示 UI 对话框
      return true
    },
  })

  try {
    const result = await agent.run('帮我整理所有关于 React 的笔记')
    console.log('✅ Final Result:', result)
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

/**
 * 集成到现有 AI 系统的建议
 * 
 * 1. 修改 src/lib/agent/react.ts 中的 think 方法：
 *    - 将当前的 prompt 构建逻辑保留
 *    - 调用项目中已有的 fetchAiStream 或其他 AI API
 *    - 解析 AI 返回的内容
 * 
 * 2. 示例代码：
 * 
 * private async think(userInput: string, context: string | undefined, systemPrompt: string): Promise<string> {
 *   const historyContext = this.steps.map((step, i) => 
 *     `Iteration ${i + 1}:
 *     Thought: ${step.thought}
 *     Action: ${step.action?.tool}
 *     Action Input: ${JSON.stringify(step.action?.params)}
 *     Observation: ${step.observation}
 *     `
 *   ).join('\n')
 * 
 *   const prompt = `${systemPrompt}
 * 
 *   ${context ? `## 上下文信息\n${context}\n` : ''}
 * 
 *   ## 对话历史
 *   ${historyContext}
 * 
 *   ## 用户请求
 *   ${userInput}
 * 
 *   现在是第 ${this.currentIteration} 次迭代，请给出你的 Thought 和 Action（或 Final Answer）：`
 * 
 *   // 调用 AI API
 *   let response = ''
 *   await fetchAiStream(prompt, (content) => {
 *     response = content
 *   })
 * 
 *   return response
 * }
 * 
 * 3. 确保 AI 模型理解 ReAct 格式：
 *    - 可能需要在 system prompt 中添加更多示例
 *    - 或者使用 few-shot learning
 *    - 或者微调模型以更好地遵循格式
 */
