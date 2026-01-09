/**
 * Agent 使用示例和测试场景
 * 
 * 这个文件包含了各种 Agent 使用场景的示例，可以用于测试和演示
 */

import { AgentHandler } from './agent-handler'

/**
 * 示例 1: 整理笔记
 * 场景：用户想要整理所有关于某个主题的笔记
 */
export async function exampleOrganizeNotes() {
  console.log('=== 示例 1: 整理笔记 ===\n')
  
  const agent = new AgentHandler({
    onThought: (thought) => {
      console.log('💭 Thought:', thought)
    },
    onAction: (action, params) => {
      console.log('⚡ Action:', action, JSON.stringify(params))
    },
    onObservation: (observation) => {
      console.log('👁️  Observation:', observation)
    },
    onComplete: (result) => {
      console.log('✅ Complete:', result)
    },
    onError: (error) => {
      console.error('❌ Error:', error)
    },
    requestConfirmation: async (toolName, params) => {
      console.log(`🔔 需要确认: ${toolName}`, params)
      return true // 自动确认（测试用）
    },
  })

  try {
    const result = await agent.execute('帮我整理所有关于 React 的笔记')
    console.log('\n最终结果:', result)
  } catch (error) {
    console.error('执行失败:', error)
  }
}

/**
 * 示例 2: 批量移动记录
 * 场景：用户想要将某些记录移动到指定标签
 */
export async function exampleMoveMarks() {
  console.log('=== 示例 2: 批量移动记录 ===\n')
  
  const agent = new AgentHandler({
    onThought: (thought) => console.log('💭', thought),
    onAction: (action, params) => console.log('⚡', action, params),
    onObservation: (obs) => console.log('👁️ ', obs),
    requestConfirmation: async () => true,
  })

  await agent.execute('把所有类型为 text 的记录移动到"学习"标签下')
}

/**
 * 示例 3: 搜索和总结
 * 场景：用户想要搜索某个主题并创建总结
 */
export async function exampleSearchAndSummarize() {
  console.log('=== 示例 3: 搜索和总结 ===\n')
  
  const agent = new AgentHandler({
    onThought: (thought) => console.log('💭', thought),
    onAction: (action, params) => console.log('⚡', action, params),
    onObservation: (obs) => console.log('👁️ ', obs),
    requestConfirmation: async () => true,
  })

  await agent.execute('搜索所有关于 TypeScript 的笔记和对话，并创建一个总结')
}

/**
 * 示例 4: 清理和整理
 * 场景：用户想要清理旧的对话记录
 */
export async function exampleCleanup() {
  console.log('=== 示例 4: 清理和整理 ===\n')
  
  const agent = new AgentHandler({
    onThought: (thought) => console.log('💭', thought),
    onAction: (action, params) => console.log('⚡', action, params),
    onObservation: (obs) => console.log('👁️ ', obs),
    requestConfirmation: async (toolName, params) => {
      console.log(`⚠️  危险操作需要确认: ${toolName}`, params)
      // 在实际应用中，这里应该显示 UI 对话框
      return true
    },
  })

  await agent.execute('清空当前标签下的所有对话记录')
}

/**
 * 示例 5: 创建和组织
 * 场景：用户想要创建新标签并移动内容
 */
export async function exampleCreateAndOrganize() {
  console.log('=== 示例 5: 创建和组织 ===\n')
  
  const agent = new AgentHandler({
    onThought: (thought) => console.log('💭', thought),
    onAction: (action, params) => console.log('⚡', action, params),
    onObservation: (obs) => console.log('👁️ ', obs),
    requestConfirmation: async () => true,
  })

  await agent.execute('创建一个名为"前端开发"的新标签，并把所有关于 React 和 Vue 的笔记移动到这个标签下')
}

/**
 * 测试场景：错误处理
 * 测试 Agent 如何处理错误情况
 */
export async function testErrorHandling() {
  console.log('=== 测试: 错误处理 ===\n')
  
  const agent = new AgentHandler({
    onThought: (thought) => console.log('💭', thought),
    onAction: (action, params) => console.log('⚡', action, params),
    onObservation: (obs) => console.log('👁️ ', obs),
    onError: (error) => console.error('❌ 捕获到错误:', error),
    requestConfirmation: async () => true,
  })

  // 测试不存在的笔记
  await agent.execute('读取 ID 为 99999 的笔记')
}

/**
 * 测试场景：复杂多步骤任务
 * 测试 Agent 处理需要多个步骤的复杂任务
 */
export async function testComplexTask() {
  console.log('=== 测试: 复杂多步骤任务 ===\n')
  
  const agent = new AgentHandler({
    onThought: (thought) => console.log('💭', thought),
    onAction: (action, params) => console.log('⚡', action, params),
    onObservation: (obs) => console.log('👁️ ', obs),
    requestConfirmation: async () => true,
  })

  await agent.execute(`
    请帮我完成以下任务：
    1. 搜索所有关于 JavaScript 的笔记
    2. 如果找到超过 5 条，创建一个总结笔记
    3. 将总结笔记添加到"编程"标签下
    4. 告诉我完成了哪些操作
  `)
}

/**
 * 运行所有示例
 */
export async function runAllExamples() {
  console.log('🚀 开始运行所有 Agent 示例...\n')
  
  const examples = [
    { name: '整理笔记', fn: exampleOrganizeNotes },
    { name: '批量移动记录', fn: exampleMoveMarks },
    { name: '搜索和总结', fn: exampleSearchAndSummarize },
    { name: '清理和整理', fn: exampleCleanup },
    { name: '创建和组织', fn: exampleCreateAndOrganize },
    { name: '错误处理', fn: testErrorHandling },
    { name: '复杂任务', fn: testComplexTask },
  ]

  for (const example of examples) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`运行示例: ${example.name}`)
    console.log('='.repeat(60))
    
    try {
      await example.fn()
      console.log(`✅ ${example.name} 完成\n`)
    } catch (error) {
      console.error(`❌ ${example.name} 失败:`, error, '\n')
    }
    
    // 等待一下，避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  console.log('\n🎉 所有示例运行完成！')
}

/**
 * 快速测试 - 用于开发时快速验证
 */
export async function quickTest() {
  console.log('=== 快速测试 ===\n')
  
  const agent = new AgentHandler({
    onThought: (thought) => console.log('💭', thought),
    onAction: (action, params) => console.log('⚡', action, params),
    onObservation: (obs) => console.log('👁️ ', obs),
    requestConfirmation: async () => true,
  })

  // 简单的测试任务
  await agent.execute('列出所有标签')
}

// 导出便于在控制台中测试
if (typeof window !== 'undefined') {
  (window as any).agentExamples = {
    quickTest,
    exampleOrganizeNotes,
    exampleMoveMarks,
    exampleSearchAndSummarize,
    exampleCleanup,
    exampleCreateAndOrganize,
    testErrorHandling,
    testComplexTask,
    runAllExamples,
  }
  console.log('💡 Agent 示例已加载到 window.agentExamples')
  console.log('   使用 window.agentExamples.quickTest() 快速测试')
  console.log('   使用 window.agentExamples.runAllExamples() 运行所有示例')
}
