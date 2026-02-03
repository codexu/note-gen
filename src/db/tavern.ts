import { getDb } from "./index"

// ============ 类型定义 ============

// 角色卡 (支持 V2/V3 Spec)
export interface TavernCard {
  id: number
  name: string
  description: string           // 角色描述/人设
  personality: string           // 性格概要
  scenario: string              // 场景/情境
  firstMes: string              // 初始消息
  mesExample: string            // 对话示例
  creatorNotes: string          // 作者笔记
  systemPrompt: string          // 系统提示词
  postHistoryInstructions: string // 历史后指令 (jailbreak)
  alternateGreetings: string    // 备选问候语 JSON 数组
  groupOnlyGreetings: string    // 仅群聊问候语 JSON 数组 (V3)
  tags: string                  // 标签 JSON 数组
  creator: string               // 创建者
  characterVersion: string      // 角色版本
  extensions: string            // 扩展数据 JSON
  characterBook: string         // 内嵌世界书 JSON (V2 Spec)
  avatarPath: string            // 头像文件路径
  presetId: number | null       // 绑定的预设 ID
  // V3 扩展字段 (从 extensions 中提取)
  depthPromptText: string       // 深度提示词内容
  depthPromptDepth: number      // 深度提示词插入深度 (默认 4)
  depthPromptRole: string       // 深度提示词角色 (system/user/assistant)
  linkedWorld: string           // 关联的外部世界书名称
  talkativeness: number         // 健谈度 (0-1, 默认 0.5)
  isFavorite: boolean           // 是否收藏
  sourceUrl: string             // 来源链接 (chub/pygmalion 等)
  createdAt: number
  updatedAt: number
}

// 聊天会话
export interface TavernChat {
  id: number
  cardId: number                // 关联的角色卡 ID
  groupId: number | null        // 关联的群组 ID (如果是群聊)
  name: string                  // 会话名称
  metadata: string              // 会话元数据 JSON (scenario覆盖、persona覆盖等)
  integrity: string             // 完整性校验 UUID
  createdAt: number
  updatedAt: number
}

// Swipe 信息 (每个滑动选项的元数据)
export interface TavernSwipeInfo {
  sendDate?: number             // 发送时间
  genStarted?: number           // 生成开始时间
  genFinished?: number          // 生成结束时间
  extra?: TavernMessageExtra    // 扩展数据
}

// 消息扩展数据
export interface TavernMessageExtra {
  api?: string                  // 使用的 API 类型
  model?: string                // 使用的模型名称
  tokenCount?: number           // token 计数
  reasoning?: string            // 推理/思考内容
  reasoningDuration?: number    // 推理耗时 (毫秒)
  genId?: number                // 生成 ID (群聊用)
  type?: string                 // 消息类型 (narrator 等)
  bias?: string                 // 偏置
  isSmallSys?: boolean          // 是否小型系统消息
  [key: string]: unknown        // 其他扩展字段
}

// 聊天消息
export interface TavernMessage {
  id: number
  chatId: number                // 关联的会话 ID
  role: 'user' | 'assistant' | 'system'
  name: string                  // 发言者名称 (用户名 或 角色名)
  content: string               // 消息内容
  isHidden: boolean             // 是否隐藏
  swipeId: number               // 当前滑动选择的索引
  swipes: string                // 所有滑动选项 JSON 数组
  // ST 兼容字段
  sendDate: number              // 发送时间戳
  genStarted: number | null     // 生成开始时间
  genFinished: number | null    // 生成结束时间
  forceAvatar: string           // 强制头像路径 (群聊显示用)
  originalAvatar: string        // 原始头像标识 (群聊角色识别)
  swipeInfo: string             // 滑动信息 JSON 数组 (TavernSwipeInfo[])
  extra: string                 // 扩展数据 JSON (TavernMessageExtra)
  createdAt: number
}

// 世界书/知识库
export interface TavernWorldInfo {
  id: number
  name: string                  // 世界书名称
  description: string           // 描述
  scope: 'global' | 'character' // 作用域: 全局 或 角色绑定
  cardId: number | null         // 绑定的角色卡 ID (scope='character' 时)
  enabled: boolean              // 是否启用
  createdAt: number
  updatedAt: number
}

// 世界书条目
export interface TavernWorldInfoEntry {
  id: number
  worldInfoId: number           // 关联的世界书 ID
  uid: number                   // 条目唯一标识
  keys: string                  // 主关键词 JSON 数组
  secondaryKeys: string         // 次要关键词 JSON 数组
  content: string               // 条目内容
  comment: string               // 备注
  enabled: boolean              // 是否启用
  constant: boolean             // 常驻激活
  selective: boolean            // 选择性激活 (需要同时匹配主次关键词)
  selectiveLogic: number        // 选择性逻辑 (0=AND ALL, 1=NOT ALL, 2=NOT ANY, 3=AND ANY)
  order: number                 // 排序
  position: number              // 注入位置 (0=before char, 1=after char, 等)
  depth: number                 // 扫描深度
  probability: number           // 触发概率 (0-100)
  group: string                 // 分组名称
  groupOverride: boolean        // 覆盖分组
  groupWeight: number           // 分组权重
  scanDepth: number | null      // 自定义扫描深度
  caseSensitive: boolean        // 大小写敏感
  matchWholeWords: boolean      // 全词匹配
  automationId: string          // 自动化 ID
  excludeRecursion: boolean     // 排除递归扫描
  preventRecursion: boolean     // 阻止递归扫描
  vectorized: boolean           // 是否已向量化
  // V3/ST 高级字段
  useRegex: boolean             // 使用正则匹配关键词
  role: number                  // 注入角色 (0=system, 1=user, 2=assistant)
  useProbability: boolean       // 启用概率触发
  displayIndex: number          // 显示顺序
  delayUntilRecursion: boolean  // 递归时才检查
  sticky: number | null         // 粘性触发轮数 (触发后保持激活)
  cooldown: number | null       // 冷却轮数
  delay: number | null          // 延迟激活轮数
  createdAt: number
}

// 预设类型
export type PresetType = 'completion' | 'instruct' | 'context'

// 系统提示词预设 (SysPrompt)
export interface TavernSysPrompt {
  id: number
  name: string                  // 预设名称
  content: string               // 主系统提示词
  postHistory: string           // 历史后提示词 (jailbreak 位置)
  enabled: boolean              // 是否启用
  isDefault: boolean            // 是否默认
  createdAt: number
  updatedAt: number
}

// 预设
export interface TavernPreset {
  id: number
  name: string                  // 预设名称
  presetType: PresetType        // 预设类型
  data: string                  // 预设数据 JSON
  originalData: string | null   // 原始数据 JSON（用于恢复默认）
  isDefault: boolean            // 是否默认预设（不可删除）
  createdAt: number
  updatedAt: number
}

// 正则脚本
export interface TavernRegex {
  id: number
  name: string                  // 正则名称
  scriptName: string            // 脚本名称
  findRegex: string             // 查找正则表达式
  replaceString: string         // 替换字符串
  trimStrings: string           // 裁剪字符串 JSON 数组
  placement: string             // 应用位置 JSON 数组
  disabled: boolean             // 是否禁用
  markdownOnly: boolean         // 仅 markdown
  promptOnly: boolean           // 仅提示词
  runOnEdit: boolean            // 编辑时运行
  substituteRegex: boolean      // 替换正则
  minDepth: number | null       // 最小深度
  maxDepth: number | null       // 最大深度
  cardId: number | null         // 绑定的角色卡 ID (null=全局)
  presetId: number | null       // 绑定的预设 ID
  createdAt: number
}

// 用户设定/Persona
export interface TavernPersona {
  id: number
  name: string                  // 用户名称
  description: string           // 用户描述/设定
  avatarPath: string            // 头像路径
  isDefault: boolean            // 是否默认
  // ST 兼容字段
  position: number              // 注入位置 (0=IN_PROMPT, 2=TOP_AN, 3=BOTTOM_AN, 4=AT_DEPTH, 9=NONE)
  depth: number                 // 深度 (AT_DEPTH 模式用, 默认 2)
  role: number                  // 角色 (0=system, 1=user, 2=assistant)
  lorebook: string              // 关联的世界书名称
  connections: string           // 关联的角色/群组 JSON 数组 (PersonaConnection[])
  createdAt: number
  updatedAt: number
}

// 群组角色信息模式
export enum GroupCharacterMode {
  SINGLE = 0,           // 单一角色: 只包含当前发言者信息
  JOINT = 1,            // 联合模式: 合并所有成员信息
  JOINT_EXCLUDE_MUTED = 2,  // 联合排除静音: 合并非静音成员信息
}

// 群组
export interface TavernGroup {
  id: number
  name: string                  // 群组名称
  description: string           // 群组描述
  avatarPath: string            // 群组头像路径
  activationStrategy: number    // 激活策略 (0=natural, 1=list, 2=pooled)
  generationType: number        // 生成类型 / 自动对话轮数
  allowSelfResponses: boolean   // 允许自我响应
  favChecked: boolean           // 优先喜好角色
  // 新增字段
  characterMode: number         // 角色信息模式 (0=单一, 1=联合, 2=联合排除静音)
  scenarioOverride: string      // 场景覆盖文本 (覆盖所有成员的 scenario)
  createdAt: number
  updatedAt: number
}

// 群组成员
export interface TavernGroupMember {
  id: number
  groupId: number               // 关联的群组 ID
  cardId: number                // 关联的角色卡 ID
  isActive: boolean             // 是否激活
  isMuted: boolean              // 是否静音
  sortOrder: number             // 排序
}

// 宏定义
export interface TavernMacro {
  id: number
  name: string                  // 宏名称 (不含 {{}})
  value: string                 // 宏值
  isSystem: boolean             // 是否系统宏 (不可删除)
  createdAt: number
}

// 聊天书签/检查点
export interface TavernBookmark {
  id: number
  chatId: number                // 关联的聊天会话 ID
  name: string                  // 书签名称
  messageCount: number          // 书签时的消息数量
  lastMessageId: number         // 最后一条消息的 ID
  metadata: string              // 聊天元数据快照 JSON
  preview: string               // 预览文本 (最后几条消息摘要)
  createdAt: number
}

// 快捷回复集合
export interface TavernQuickReplySet {
  id: number
  name: string                  // 集合名称
  scope: 'global' | 'character' // 作用域: 全局 或 角色绑定
  cardId: number | null         // 绑定的角色卡 ID (scope='character' 时)
  color: string                 // 按钮颜色
  isEnabled: boolean            // 是否启用
  sortOrder: number             // 排序
  createdAt: number
  updatedAt: number
}

// 快捷回复项
export interface TavernQuickReply {
  id: number
  setId: number                 // 关联的集合 ID
  label: string                 // 按钮标签
  icon: string                  // 图标 (FontAwesome class)
  title: string                 // 悬停提示
  message: string               // 回复内容 (支持宏)
  isHidden: boolean             // 是否隐藏
  // 自动执行触发器
  executeOnStartup: boolean     // 启动时执行
  executeOnUser: boolean        // 用户消息后执行
  executeOnAi: boolean          // AI 消息后执行
  executeOnChatChange: boolean  // 切换聊天时执行
  preventAutoExecute: boolean   // 阻止自动执行
  sortOrder: number             // 排序
  createdAt: number
  updatedAt: number
}

// ============ 数据库初始化 ============

// 数据库版本，用于迁移
// v1: 初始版本
// v2: 添加 V3 角色卡字段和世界书高级字段
const TAVERN_DB_VERSION = 2

export async function initTavernDb() {
  const db = await getDb()

  // 检查并处理数据库迁移
  try {
    // 尝试检查表结构是否正确
    await db.select<{name: string}[]>("SELECT name FROM tavern_cards LIMIT 1")
    await db.select<{isDefault: number}[]>("SELECT isDefault FROM tavern_personas LIMIT 1")
  } catch {
    // 如果表结构不正确，删除所有 tavern 表重新创建
    console.log('Tavern database schema mismatch, recreating tables...')
    const tables = [
      'tavern_group_members',
      'tavern_groups', 
      'tavern_personas',
      'tavern_regex',
      'tavern_presets',
      'tavern_world_info_entries',
      'tavern_world_infos',
      'tavern_messages',
      'tavern_chats',
      'tavern_cards',
      'tavern_macros'
    ]
    for (const table of tables) {
      try {
        await db.execute(`DROP TABLE IF EXISTS ${table}`)
      } catch (e) {
        console.log(`Failed to drop table ${table}:`, e)
      }
    }
  }

  // 迁移: 为 tavern_presets 添加 isDefault 列
  try {
    await db.select<{isDefault: number}[]>("SELECT isDefault FROM tavern_presets LIMIT 1")
  } catch {
    console.log('Adding isDefault column to tavern_presets...')
    try {
      await db.execute("ALTER TABLE tavern_presets ADD COLUMN isDefault INTEGER DEFAULT 0")
    } catch (e) {
      console.log('Failed to add isDefault column:', e)
    }
  }

  // 迁移: 为 tavern_presets 添加 presetType 列
  try {
    await db.select<{presetType: string}[]>("SELECT presetType FROM tavern_presets LIMIT 1")
  } catch {
    console.log('Adding presetType column to tavern_presets...')
    try {
      await db.execute("ALTER TABLE tavern_presets ADD COLUMN presetType TEXT DEFAULT 'completion'")
    } catch (e) {
      console.log('Failed to add presetType column:', e)
    }
  }

  // 迁移: 为 tavern_presets 添加 originalData 列
  try {
    await db.select<{originalData: string}[]>("SELECT originalData FROM tavern_presets LIMIT 1")
  } catch {
    console.log('Adding originalData column to tavern_presets...')
    try {
      await db.execute("ALTER TABLE tavern_presets ADD COLUMN originalData TEXT DEFAULT NULL")
    } catch (e) {
      console.log('Failed to add originalData column:', e)
    }
  }

  // ============ V3 字段迁移 ============
  // 迁移: 为 tavern_cards 添加 V3 字段
  const cardV3Fields = [
    { name: 'groupOnlyGreetings', type: "TEXT DEFAULT '[]'" },
    { name: 'depthPromptText', type: "TEXT DEFAULT ''" },
    { name: 'depthPromptDepth', type: 'INTEGER DEFAULT 4' },
    { name: 'depthPromptRole', type: "TEXT DEFAULT 'system'" },
    { name: 'linkedWorld', type: "TEXT DEFAULT ''" },
    { name: 'talkativeness', type: 'REAL DEFAULT 0.5' },
    { name: 'isFavorite', type: 'INTEGER DEFAULT 0' },
    { name: 'sourceUrl', type: "TEXT DEFAULT ''" },
    { name: 'presetId', type: 'INTEGER DEFAULT NULL' },
  ]
  for (const field of cardV3Fields) {
    try {
      await db.select(`SELECT ${field.name} FROM tavern_cards LIMIT 1`)
    } catch {
      console.log(`Adding ${field.name} column to tavern_cards...`)
      try {
        await db.execute(`ALTER TABLE tavern_cards ADD COLUMN ${field.name} ${field.type}`)
      } catch (e) {
        console.log(`Failed to add ${field.name} column:`, e)
      }
    }
  }

  // 迁移: 为 tavern_world_info_entries 添加高级字段
  const worldInfoV3Fields = [
    { name: 'useRegex', type: 'INTEGER DEFAULT 1' },
    { name: 'role', type: 'INTEGER DEFAULT 0' },
    { name: 'useProbability', type: 'INTEGER DEFAULT 1' },
    { name: 'displayIndex', type: 'INTEGER DEFAULT 0' },
    { name: 'delayUntilRecursion', type: 'INTEGER DEFAULT 0' },
    { name: 'sticky', type: 'INTEGER DEFAULT NULL' },
    { name: 'cooldown', type: 'INTEGER DEFAULT NULL' },
    { name: 'delay', type: 'INTEGER DEFAULT NULL' },
  ]
  for (const field of worldInfoV3Fields) {
    try {
      await db.select(`SELECT ${field.name} FROM tavern_world_info_entries LIMIT 1`)
    } catch {
      console.log(`Adding ${field.name} column to tavern_world_info_entries...`)
      try {
        await db.execute(`ALTER TABLE tavern_world_info_entries ADD COLUMN ${field.name} ${field.type}`)
      } catch (e) {
        console.log(`Failed to add ${field.name} column:`, e)
      }
    }
  }

  // ============ ST 聊天系统字段迁移 ============
  // 迁移: 为 tavern_chats 添加 metadata 和 integrity 字段
  const chatFields = [
    { name: 'metadata', type: "TEXT DEFAULT '{}'" },
    { name: 'integrity', type: "TEXT DEFAULT ''" },
  ]
  for (const field of chatFields) {
    try {
      await db.select(`SELECT ${field.name} FROM tavern_chats LIMIT 1`)
    } catch {
      console.log(`Adding ${field.name} column to tavern_chats...`)
      try {
        await db.execute(`ALTER TABLE tavern_chats ADD COLUMN ${field.name} ${field.type}`)
      } catch (e) {
        console.log(`Failed to add ${field.name} column:`, e)
      }
    }
  }

  // 迁移: 为 tavern_messages 添加 ST 兼容字段
  const messageFields = [
    { name: 'sendDate', type: 'INTEGER DEFAULT 0' },
    { name: 'genStarted', type: 'INTEGER DEFAULT NULL' },
    { name: 'genFinished', type: 'INTEGER DEFAULT NULL' },
    { name: 'forceAvatar', type: "TEXT DEFAULT ''" },
    { name: 'originalAvatar', type: "TEXT DEFAULT ''" },
    { name: 'swipeInfo', type: "TEXT DEFAULT '[]'" },
    { name: 'extra', type: "TEXT DEFAULT '{}'" },
  ]
  for (const field of messageFields) {
    try {
      await db.select(`SELECT ${field.name} FROM tavern_messages LIMIT 1`)
    } catch {
      console.log(`Adding ${field.name} column to tavern_messages...`)
      try {
        await db.execute(`ALTER TABLE tavern_messages ADD COLUMN ${field.name} ${field.type}`)
      } catch (e) {
        console.log(`Failed to add ${field.name} column:`, e)
      }
    }
  }

  // ============ 群组增强字段迁移 ============
  // 迁移: 为 tavern_groups 添加 ST 兼容字段 (characterMode, scenarioOverride)
  const groupFields = [
    { name: 'characterMode', type: 'INTEGER DEFAULT 0' },        // 角色信息模式
    { name: 'scenarioOverride', type: "TEXT DEFAULT ''" },       // 场景覆盖
  ]
  for (const field of groupFields) {
    try {
      await db.select(`SELECT ${field.name} FROM tavern_groups LIMIT 1`)
    } catch {
      console.log(`Adding ${field.name} column to tavern_groups...`)
      try {
        await db.execute(`ALTER TABLE tavern_groups ADD COLUMN ${field.name} ${field.type}`)
      } catch (e) {
        console.log(`Failed to add ${field.name} column:`, e)
      }
    }
  }

  // ============ Persona 增强字段迁移 ============
  // 迁移: 为 tavern_personas 添加 ST 兼容字段 (position, depth, role, lorebook, connections)
  const personaFields = [
    { name: 'position', type: 'INTEGER DEFAULT 0' },      // 注入位置
    { name: 'depth', type: 'INTEGER DEFAULT 2' },         // 深度
    { name: 'role', type: 'INTEGER DEFAULT 0' },          // 角色
    { name: 'lorebook', type: "TEXT DEFAULT ''" },        // 关联世界书
    { name: 'connections', type: "TEXT DEFAULT '[]'" },   // 关联角色/群组
  ]
  for (const field of personaFields) {
    try {
      await db.select(`SELECT ${field.name} FROM tavern_personas LIMIT 1`)
    } catch {
      console.log(`Adding ${field.name} column to tavern_personas...`)
      try {
        await db.execute(`ALTER TABLE tavern_personas ADD COLUMN ${field.name} ${field.type}`)
      } catch (e) {
        console.log(`Failed to add ${field.name} column:`, e)
      }
    }
  }

  // 角色卡表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      personality TEXT DEFAULT '',
      scenario TEXT DEFAULT '',
      firstMes TEXT DEFAULT '',
      mesExample TEXT DEFAULT '',
      creatorNotes TEXT DEFAULT '',
      systemPrompt TEXT DEFAULT '',
      postHistoryInstructions TEXT DEFAULT '',
      alternateGreetings TEXT DEFAULT '[]',
      groupOnlyGreetings TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      creator TEXT DEFAULT '',
      characterVersion TEXT DEFAULT '',
      extensions TEXT DEFAULT '{}',
      characterBook TEXT DEFAULT NULL,
      avatarPath TEXT DEFAULT '',
      presetId INTEGER DEFAULT NULL,
      depthPromptText TEXT DEFAULT '',
      depthPromptDepth INTEGER DEFAULT 4,
      depthPromptRole TEXT DEFAULT 'system',
      linkedWorld TEXT DEFAULT '',
      talkativeness REAL DEFAULT 0.5,
      isFavorite INTEGER DEFAULT 0,
      sourceUrl TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 聊天会话表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cardId INTEGER NOT NULL,
      groupId INTEGER DEFAULT NULL,
      name TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}',
      integrity TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (cardId) REFERENCES tavern_cards(id) ON DELETE CASCADE
    )
  `)

  // 聊天消息表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER NOT NULL,
      role TEXT NOT NULL,
      name TEXT DEFAULT '',
      content TEXT DEFAULT '',
      isHidden INTEGER DEFAULT 0,
      swipeId INTEGER DEFAULT 0,
      swipes TEXT DEFAULT '[]',
      sendDate INTEGER DEFAULT 0,
      genStarted INTEGER DEFAULT NULL,
      genFinished INTEGER DEFAULT NULL,
      forceAvatar TEXT DEFAULT '',
      originalAvatar TEXT DEFAULT '',
      swipeInfo TEXT DEFAULT '[]',
      extra TEXT DEFAULT '{}',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (chatId) REFERENCES tavern_chats(id) ON DELETE CASCADE
    )
  `)

  // 世界书表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_world_infos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      scope TEXT DEFAULT 'global',
      cardId INTEGER DEFAULT NULL,
      enabled INTEGER DEFAULT 1,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 世界书条目表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_world_info_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worldInfoId INTEGER NOT NULL,
      uid INTEGER NOT NULL,
      keys TEXT DEFAULT '[]',
      secondaryKeys TEXT DEFAULT '[]',
      content TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      constant INTEGER DEFAULT 0,
      selective INTEGER DEFAULT 0,
      selectiveLogic INTEGER DEFAULT 0,
      "order" INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      depth INTEGER DEFAULT 4,
      probability INTEGER DEFAULT 100,
      "group" TEXT DEFAULT '',
      groupOverride INTEGER DEFAULT 0,
      groupWeight INTEGER DEFAULT 100,
      scanDepth INTEGER DEFAULT NULL,
      caseSensitive INTEGER DEFAULT 0,
      matchWholeWords INTEGER DEFAULT 0,
      automationId TEXT DEFAULT '',
      excludeRecursion INTEGER DEFAULT 0,
      preventRecursion INTEGER DEFAULT 0,
      vectorized INTEGER DEFAULT 0,
      useRegex INTEGER DEFAULT 1,
      role INTEGER DEFAULT 0,
      useProbability INTEGER DEFAULT 1,
      displayIndex INTEGER DEFAULT 0,
      delayUntilRecursion INTEGER DEFAULT 0,
      sticky INTEGER DEFAULT NULL,
      cooldown INTEGER DEFAULT NULL,
      delay INTEGER DEFAULT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (worldInfoId) REFERENCES tavern_world_infos(id) ON DELETE CASCADE
    )
  `)

  // 预设表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      presetType TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      originalData TEXT DEFAULT NULL,
      isDefault INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 正则脚本表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_regex (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scriptName TEXT DEFAULT '',
      findRegex TEXT NOT NULL,
      replaceString TEXT DEFAULT '',
      trimStrings TEXT DEFAULT '[]',
      placement TEXT DEFAULT '[]',
      disabled INTEGER DEFAULT 0,
      markdownOnly INTEGER DEFAULT 0,
      promptOnly INTEGER DEFAULT 0,
      runOnEdit INTEGER DEFAULT 0,
      substituteRegex INTEGER DEFAULT 0,
      minDepth INTEGER DEFAULT NULL,
      maxDepth INTEGER DEFAULT NULL,
      cardId INTEGER DEFAULT NULL,
      presetId INTEGER DEFAULT NULL,
      createdAt INTEGER NOT NULL
    )
  `)

  // 用户设定表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_personas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      avatarPath TEXT DEFAULT '',
      isDefault INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      depth INTEGER DEFAULT 2,
      role INTEGER DEFAULT 0,
      lorebook TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 群组表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      avatarPath TEXT DEFAULT '',
      activationStrategy INTEGER DEFAULT 0,
      generationType INTEGER DEFAULT 0,
      allowSelfResponses INTEGER DEFAULT 0,
      favChecked INTEGER DEFAULT 0,
      characterMode INTEGER DEFAULT 0,
      scenarioOverride TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 群组成员表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      groupId INTEGER NOT NULL,
      cardId INTEGER NOT NULL,
      isActive INTEGER DEFAULT 1,
      isMuted INTEGER DEFAULT 0,
      sortOrder INTEGER DEFAULT 0,
      FOREIGN KEY (groupId) REFERENCES tavern_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (cardId) REFERENCES tavern_cards(id) ON DELETE CASCADE
    )
  `)

  // 宏定义表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_macros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      value TEXT DEFAULT '',
      isSystem INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL
    )
  `)

  // 聊天书签表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER NOT NULL,
      name TEXT NOT NULL,
      messageCount INTEGER NOT NULL,
      lastMessageId INTEGER NOT NULL,
      metadata TEXT DEFAULT '',
      preview TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (chatId) REFERENCES tavern_chats(id) ON DELETE CASCADE
    )
  `)

  // 快捷回复集合表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_quick_reply_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scope TEXT DEFAULT 'global',
      cardId INTEGER DEFAULT NULL,
      color TEXT DEFAULT '',
      isEnabled INTEGER DEFAULT 1,
      sortOrder INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 快捷回复项表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_quick_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setId INTEGER NOT NULL,
      label TEXT NOT NULL,
      icon TEXT DEFAULT '',
      title TEXT DEFAULT '',
      message TEXT DEFAULT '',
      isHidden INTEGER DEFAULT 0,
      executeOnStartup INTEGER DEFAULT 0,
      executeOnUser INTEGER DEFAULT 0,
      executeOnAi INTEGER DEFAULT 0,
      executeOnChatChange INTEGER DEFAULT 0,
      preventAutoExecute INTEGER DEFAULT 1,
      sortOrder INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (setId) REFERENCES tavern_quick_reply_sets(id) ON DELETE CASCADE
    )
  `)

  // SysPrompt 系统提示词预设表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tavern_sysprompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT DEFAULT '',
      postHistory TEXT DEFAULT '',
      enabled INTEGER DEFAULT 0,
      isDefault INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 初始化系统宏
  await initSystemMacros()
  
  // 初始化默认用户设定
  await initDefaultPersona()
  
  // 初始化默认预设
  await initDefaultPreset()
  
  // 初始化默认快捷回复集合
  await initDefaultQuickReplySet()
  
  // 初始化默认 SysPrompt
  await initDefaultSysPrompt()
}

// 初始化系统宏
async function initSystemMacros() {
  const db = await getDb()
  const systemMacros = [
    { name: 'char', value: '', isSystem: true },
    { name: 'user', value: '', isSystem: true },
    { name: 'time', value: '', isSystem: true },
    { name: 'date', value: '', isSystem: true },
    { name: 'idle_duration', value: '', isSystem: true },
    { name: 'random', value: '', isSystem: true },
    { name: 'roll', value: '', isSystem: true },
  ]

  for (const macro of systemMacros) {
    const existing = await db.select<TavernMacro[]>(
      "SELECT * FROM tavern_macros WHERE name = $1", [macro.name]
    )
    if (existing.length === 0) {
      await db.execute(
        "INSERT INTO tavern_macros (name, value, isSystem, createdAt) VALUES ($1, $2, $3, $4)",
        [macro.name, macro.value, macro.isSystem ? 1 : 0, Date.now()]
      )
    }
  }
}

// 初始化默认用户设定
async function initDefaultPersona() {
  const db = await getDb()
  const existing = await db.select<TavernPersona[]>(
    "SELECT * FROM tavern_personas WHERE isDefault = 1"
  )
  if (existing.length === 0) {
    await db.execute(
      "INSERT INTO tavern_personas (name, description, avatarPath, isDefault, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6)",
      ['User', '', '', 1, Date.now(), Date.now()]
    )
  }
}

// 初始化默认预设 (ST 官方默认值)
async function initDefaultPreset() {
  const db = await getDb()
  const existing = await db.select<TavernPreset[]>(
    "SELECT * FROM tavern_presets WHERE isDefault = 1"
  )
  if (existing.length === 0) {
    const now = Date.now()
    // ST 官方默认预设数据
    const defaultPresetData = {
      version: 1,
      basic: {
        maxContext: 16384,
        maxResponse: 1024,
        unlockContext: false,
        candidateCount: 1,
        streaming: true,
        seed: -1,
        useSysPrompt: true,
        showThoughts: true,
        enableWebSearch: false,
        requestImages: false,
        requestImageAspectRatio: '',
        requestImageResolution: '',
      },
      sampling: {
        temperature: 1.0,
        topP: 1.0,
        topK: 0,
        minP: 0,
        topA: 0,
        frequencyPenalty: 0,
        presencePenalty: 0,
        repetitionPenalty: 1.0,
      },
      behavior: {
        characterNameBehavior: 'default',
        continuePostfix: 'space',
        continuePrefill: false,
        squashSystemMessages: false,
        enableFunctionCalling: false,
        sendInlineMedia: true,
        imageQuality: 'auto',
        reasoningEffort: 'auto',
        verbosity: 'auto',
      },
      prefill: {
        assistantPrefill: '',
        assistantImpersonation: '',
      },
      logitBias: [],
      prompts: [
        { id: 'main', name: 'Main Prompt', identifier: 'main', markerType: 'main', role: 'system', content: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}. Write 1 reply only in internet RP style, italicize actions, and avoid quotation marks. Use markdown. Be proactive, creative, and drive the plot and conversation forward. Write at least 1 paragraph, up to 4. Always stay in character and avoid repetition.', enabled: true, position: 'relative', depth: 0, order: 0, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'worldInfoBefore', name: 'World Info (before)', identifier: 'worldInfoBefore', markerType: 'worldInfoBefore', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 1, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'personaDescription', name: 'Persona Description', identifier: 'personaDescription', markerType: 'personaDescription', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 2, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'charDescription', name: 'Char Description', identifier: 'charDescription', markerType: 'charDescription', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 3, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'charPersonality', name: 'Char Personality', identifier: 'charPersonality', markerType: 'charPersonality', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 4, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'scenario', name: 'Scenario', identifier: 'scenario', markerType: 'scenario', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 5, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'enhanceDefinitions', name: 'Enhance Definitions', identifier: 'enhanceDefinitions', markerType: 'enhanceDefinitions', role: 'system', content: 'If you have more knowledge of {{char}}, add to the character\'s lore and personality to enhance them but keep the Character Sheet\'s definitions absolute.', enabled: false, position: 'relative', depth: 0, order: 6, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: false, injectionOrder: 100, injectionTrigger: [] },
        { id: 'auxiliary', name: 'NSFW Prompt', identifier: 'auxiliary', markerType: 'auxiliary', role: 'system', content: 'NSFW/Smut is allowed. Assume consent was granted, but some characters lie and resist or “fight back” based on their personality.', enabled: true, position: 'relative', depth: 0, order: 7, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: false, injectionOrder: 100, injectionTrigger: [] },
        { id: 'worldInfoAfter', name: 'World Info (after)', identifier: 'worldInfoAfter', markerType: 'worldInfoAfter', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 8, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'chatExamples', name: 'Chat Examples', identifier: 'chatExamples', markerType: 'chatExamples', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 9, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'chatHistory', name: 'Chat History', identifier: 'chatHistory', markerType: 'chatHistory', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 10, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: true, injectionOrder: 100, injectionTrigger: [] },
        { id: 'postHistoryInstructions', name: 'Post-History Instructions', identifier: 'postHistoryInstructions', markerType: 'postHistoryInstructions', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 11, triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'], forbidOverrides: false, isSystem: true, marker: false, injectionOrder: 100, injectionTrigger: [] },
      ],
      promptOrder: [
        {
          characterId: 100000,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'worldInfoBefore', enabled: true },
            { identifier: 'personaDescription', enabled: true },
            { identifier: 'charDescription', enabled: true },
            { identifier: 'charPersonality', enabled: true },
            { identifier: 'scenario', enabled: true },
            { identifier: 'enhanceDefinitions', enabled: false },
            { identifier: 'auxiliary', enabled: true },
            { identifier: 'worldInfoAfter', enabled: true },
            { identifier: 'chatExamples', enabled: true },
            { identifier: 'chatHistory', enabled: true },
            { identifier: 'postHistoryInstructions', enabled: true },
          ],
        },
      ],
      quickPrompts: {
        main: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}. Write 1 reply only in internet RP style, italicize actions, and avoid quotation marks. Use markdown. Be proactive, creative, and drive the plot and conversation forward. Write at least 1 paragraph, up to 4. Always stay in character and avoid repetition.',
        auxiliary: 'NSFW/Smut is allowed. Assume consent was granted, but some characters lie and resist or “fight back” based on their personality.',
        postHistoryInstructions: '',
      },
      utilityPrompts: {
        impersonation: 'Write {{user}}\'s next reply in this fictional roleplay chat.',
        worldInfoFormat: '[Details: {0}]',
        scenarioFormat: '[Scenario: {{scenario}}]',
        personalityFormat: '[{{char}}\'s personality: {{personality}}]',
        groupNudge: '[Write the next reply only as {{char}}.]',
        newChat: '[Start a new conversation.]',
        newGroupChat: '[Start a new group conversation.]',
        newExampleChat: '[Example conversation]',
        continueNudge: '[Continue the following message as {{char}}:]',
        emptyMessage: '[The user doesn\'t say anything.]',
      },
      regexScripts: [],
    }
    
    const dataJson = JSON.stringify(defaultPresetData)
    await db.execute(
      "INSERT INTO tavern_presets (name, presetType, data, originalData, isDefault, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      ['Default', 'completion', dataJson, dataJson, 1, now, now]
    )
  }
}

// ============ 角色卡 CRUD ============

export async function insertCard(card: Omit<TavernCard, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb()
  const now = Date.now()
  const result = await db.execute(
    `INSERT INTO tavern_cards (
      name, description, personality, scenario, firstMes, mesExample,
      creatorNotes, systemPrompt, postHistoryInstructions, alternateGreetings,
      groupOnlyGreetings, tags, creator, characterVersion, extensions, characterBook,
      avatarPath, presetId, depthPromptText, depthPromptDepth, depthPromptRole,
      linkedWorld, talkativeness, isFavorite, createdAt, updatedAt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
    [
      card.name, card.description, card.personality, card.scenario,
      card.firstMes, card.mesExample, card.creatorNotes, card.systemPrompt,
      card.postHistoryInstructions, card.alternateGreetings, card.groupOnlyGreetings || '[]',
      card.tags, card.creator, card.characterVersion, card.extensions, card.characterBook,
      card.avatarPath, card.presetId ?? null, card.depthPromptText || '',
      card.depthPromptDepth ?? 4, card.depthPromptRole || 'system',
      card.linkedWorld || '', card.talkativeness ?? 0.5, card.isFavorite ? 1 : 0,
      now, now
    ]
  )
  return result.lastInsertId
}

export async function getCards() {
  const db = await getDb()
  return await db.select<TavernCard[]>("SELECT * FROM tavern_cards ORDER BY updatedAt DESC")
}

export async function getCardById(id: number) {
  const db = await getDb()
  const results = await db.select<TavernCard[]>("SELECT * FROM tavern_cards WHERE id = $1", [id])
  return results[0] || null
}

export async function updateCard(id: number, card: Partial<TavernCard>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const stringFields = [
    'name', 'description', 'personality', 'scenario', 'firstMes', 'mesExample',
    'creatorNotes', 'systemPrompt', 'postHistoryInstructions', 'alternateGreetings',
    'groupOnlyGreetings', 'tags', 'creator', 'characterVersion', 'extensions',
    'characterBook', 'avatarPath', 'depthPromptText', 'depthPromptRole', 'linkedWorld',
    'sourceUrl'
  ]
  const numberFields = ['presetId', 'depthPromptDepth', 'talkativeness']
  const boolFields = ['isFavorite']

  for (const field of stringFields) {
    if (field in card) {
      fields.push(`${field} = $${paramIndex}`)
      values.push(card[field as keyof TavernCard])
      paramIndex++
    }
  }

  for (const field of numberFields) {
    if (field in card) {
      fields.push(`${field} = $${paramIndex}`)
      values.push(card[field as keyof TavernCard])
      paramIndex++
    }
  }

  for (const field of boolFields) {
    if (field in card) {
      fields.push(`${field} = $${paramIndex}`)
      values.push(card[field as keyof TavernCard] ? 1 : 0)
      paramIndex++
    }
  }

  fields.push(`updatedAt = $${paramIndex}`)
  values.push(Date.now())
  paramIndex++

  values.push(id)

  return await db.execute(
    `UPDATE tavern_cards SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

export async function deleteCard(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_cards WHERE id = $1", [id])
}

// ============ 聊天会话 CRUD ============

export async function insertChat(chat: Omit<TavernChat, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb()
  const now = Date.now()
  // 生成唯一的 integrity UUID
  const integrity = chat.integrity || crypto.randomUUID()
  const result = await db.execute(
    "INSERT INTO tavern_chats (cardId, groupId, name, metadata, integrity, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [chat.cardId, chat.groupId, chat.name, chat.metadata || '{}', integrity, now, now]
  )
  return result.lastInsertId
}

export async function getChatsByCardId(cardId: number) {
  const db = await getDb()
  return await db.select<TavernChat[]>(
    "SELECT * FROM tavern_chats WHERE cardId = $1 ORDER BY updatedAt DESC", [cardId]
  )
}

export async function getChatById(id: number) {
  const db = await getDb()
  const results = await db.select<TavernChat[]>("SELECT * FROM tavern_chats WHERE id = $1", [id])
  return results[0] || null
}

export async function updateChatTimestamp(id: number) {
  const db = await getDb()
  return await db.execute("UPDATE tavern_chats SET updatedAt = $1 WHERE id = $2", [Date.now(), id])
}

export async function updateChat(id: number, updates: Partial<TavernChat>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const allowedFields = ['name', 'metadata', 'integrity', 'groupId']
  for (const field of allowedFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernChat])
    }
  }

  fields.push(`updatedAt = $${paramIndex++}`)
  values.push(Date.now())
  values.push(id)

  if (fields.length > 1) {
    return await db.execute(
      `UPDATE tavern_chats SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    )
  }
}

export async function deleteChat(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_chats WHERE id = $1", [id])
}

// ============ 消息 CRUD ============

// 消息插入参数类型 (可选字段用于简化调用)
export interface InsertMessageParams {
  chatId: number
  role: 'user' | 'assistant' | 'system'
  name: string
  content: string
  isHidden?: boolean
  swipeId?: number
  swipes?: string
  // ST 兼容字段
  sendDate?: number
  genStarted?: number | null
  genFinished?: number | null
  forceAvatar?: string
  originalAvatar?: string
  swipeInfo?: string
  extra?: string
}

export async function insertMessage(message: InsertMessageParams) {
  const db = await getDb()
  const now = Date.now()
  const sendDate = message.sendDate || now
  
  // 构建 swipeInfo: 如果没有提供，创建默认的第一个 swipe 信息
  let swipeInfo = message.swipeInfo || '[]'
  if (swipeInfo === '[]' && message.content) {
    const defaultSwipeInfo: TavernSwipeInfo[] = [{
      sendDate: sendDate,
      genStarted: message.genStarted ?? undefined,
      genFinished: message.genFinished ?? undefined,
      extra: message.extra ? JSON.parse(message.extra) : undefined,
    }]
    swipeInfo = JSON.stringify(defaultSwipeInfo)
  }
  
  const result = await db.execute(
    `INSERT INTO tavern_messages (
      chatId, role, name, content, isHidden, swipeId, swipes,
      sendDate, genStarted, genFinished, forceAvatar, originalAvatar, swipeInfo, extra,
      createdAt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      message.chatId,
      message.role,
      message.name,
      message.content,
      message.isHidden ? 1 : 0,
      message.swipeId ?? 0,
      message.swipes || JSON.stringify([message.content]),
      sendDate,
      message.genStarted ?? null,
      message.genFinished ?? null,
      message.forceAvatar || '',
      message.originalAvatar || '',
      swipeInfo,
      message.extra || '{}',
      now
    ]
  )
  return result.lastInsertId
}

export async function getMessagesByChatId(chatId: number) {
  const db = await getDb()
  return await db.select<TavernMessage[]>(
    "SELECT * FROM tavern_messages WHERE chatId = $1 ORDER BY createdAt ASC", [chatId]
  )
}

export async function getMessageById(id: number) {
  const db = await getDb()
  const results = await db.select<TavernMessage[]>("SELECT * FROM tavern_messages WHERE id = $1", [id])
  return results[0] || null
}

export async function updateMessage(id: number, updates: Partial<TavernMessage>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  // 字符串字段
  const stringFields = ['name', 'content', 'swipes', 'forceAvatar', 'originalAvatar', 'swipeInfo', 'extra']
  for (const field of stringFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernMessage])
    }
  }

  // 数字字段
  const numberFields = ['swipeId', 'sendDate', 'genStarted', 'genFinished']
  for (const field of numberFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernMessage])
    }
  }

  // 布尔字段
  if ('isHidden' in updates) {
    fields.push(`isHidden = $${paramIndex++}`)
    values.push(updates.isHidden ? 1 : 0)
  }

  values.push(id)

  if (fields.length > 0) {
    return await db.execute(
      `UPDATE tavern_messages SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    )
  }
}

export async function deleteMessage(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_messages WHERE id = $1", [id])
}

// 删除指定消息之后的所有消息
export async function deleteMessagesAfter(chatId: number, messageId: number) {
  const db = await getDb()
  const message = await getMessageById(messageId)
  if (!message) return
  return await db.execute(
    "DELETE FROM tavern_messages WHERE chatId = $1 AND createdAt > $2",
    [chatId, message.createdAt]
  )
}

// 获取最后一条消息
export async function getLastMessage(chatId: number) {
  const db = await getDb()
  const results = await db.select<TavernMessage[]>(
    "SELECT * FROM tavern_messages WHERE chatId = $1 ORDER BY createdAt DESC LIMIT 1",
    [chatId]
  )
  return results[0] || null
}

// ============ 世界书 CRUD ============

export async function insertWorldInfo(worldInfo: Omit<TavernWorldInfo, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb()
  const now = Date.now()
  const result = await db.execute(
    "INSERT INTO tavern_world_infos (name, description, scope, cardId, enabled, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [worldInfo.name, worldInfo.description, worldInfo.scope, worldInfo.cardId, worldInfo.enabled ? 1 : 0, now, now]
  )
  return result.lastInsertId
}

export async function getWorldInfos(scope?: 'global' | 'character', cardId?: number) {
  const db = await getDb()
  if (scope === 'character' && cardId) {
    return await db.select<TavernWorldInfo[]>(
      "SELECT * FROM tavern_world_infos WHERE scope = 'character' AND cardId = $1 ORDER BY name", [cardId]
    )
  } else if (scope === 'global') {
    return await db.select<TavernWorldInfo[]>(
      "SELECT * FROM tavern_world_infos WHERE scope = 'global' ORDER BY name"
    )
  }
  return await db.select<TavernWorldInfo[]>("SELECT * FROM tavern_world_infos ORDER BY name")
}

export async function getWorldInfoById(id: number) {
  const db = await getDb()
  const results = await db.select<TavernWorldInfo[]>("SELECT * FROM tavern_world_infos WHERE id = $1", [id])
  return results[0] || null
}

/**
 * 根据名称获取世界书
 * 用于 Persona 关联世界书加载
 */
export async function getWorldInfoByName(name: string) {
  const db = await getDb()
  const results = await db.select<TavernWorldInfo[]>(
    "SELECT * FROM tavern_world_infos WHERE name = $1",
    [name]
  )
  return results[0] || null
}

export async function updateWorldInfo(id: number, updates: Partial<TavernWorldInfo>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const allowedFields = ['name', 'description', 'scope', 'cardId', 'enabled']
  for (const field of allowedFields) {
    if (field in updates) {
      if (field === 'enabled') {
        fields.push(`${field} = $${paramIndex++}`)
        values.push(updates[field] ? 1 : 0)
      } else {
        fields.push(`${field} = $${paramIndex++}`)
        values.push(updates[field as keyof TavernWorldInfo])
      }
    }
  }

  fields.push(`updatedAt = $${paramIndex++}`)
  values.push(Date.now())
  values.push(id)

  return await db.execute(
    `UPDATE tavern_world_infos SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

export async function deleteWorldInfo(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_world_infos WHERE id = $1", [id])
}

// ============ 世界书条目 CRUD ============

export async function insertWorldInfoEntry(entry: Omit<TavernWorldInfoEntry, 'id' | 'createdAt'>) {
  const db = await getDb()
  const result = await db.execute(
    `INSERT INTO tavern_world_info_entries (
      worldInfoId, uid, keys, secondaryKeys, content, comment, enabled, constant,
      selective, selectiveLogic, "order", position, depth, probability, "group",
      groupOverride, groupWeight, scanDepth, caseSensitive, matchWholeWords,
      automationId, excludeRecursion, preventRecursion, vectorized,
      useRegex, role, useProbability, displayIndex, delayUntilRecursion,
      sticky, cooldown, delay, createdAt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)`,
    [
      entry.worldInfoId, entry.uid, entry.keys, entry.secondaryKeys, entry.content,
      entry.comment, entry.enabled ? 1 : 0, entry.constant ? 1 : 0, entry.selective ? 1 : 0,
      entry.selectiveLogic, entry.order, entry.position, entry.depth, entry.probability,
      entry.group, entry.groupOverride ? 1 : 0, entry.groupWeight, entry.scanDepth,
      entry.caseSensitive ? 1 : 0, entry.matchWholeWords ? 1 : 0, entry.automationId,
      entry.excludeRecursion ? 1 : 0, entry.preventRecursion ? 1 : 0, entry.vectorized ? 1 : 0,
      entry.useRegex ? 1 : 0, entry.role ?? 0, entry.useProbability ? 1 : 0,
      entry.displayIndex ?? 0, entry.delayUntilRecursion ? 1 : 0,
      entry.sticky ?? null, entry.cooldown ?? null, entry.delay ?? null,
      Date.now()
    ]
  )
  return result.lastInsertId
}

export async function getWorldInfoEntries(worldInfoId: number) {
  const db = await getDb()
  return await db.select<TavernWorldInfoEntry[]>(
    'SELECT * FROM tavern_world_info_entries WHERE worldInfoId = $1 ORDER BY "order" ASC', [worldInfoId]
  )
}

export async function updateWorldInfoEntry(id: number, updates: Partial<TavernWorldInfoEntry>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const boolFields = ['enabled', 'constant', 'selective', 'groupOverride', 'caseSensitive', 'matchWholeWords', 'excludeRecursion', 'preventRecursion', 'vectorized', 'useRegex', 'useProbability', 'delayUntilRecursion']
  const stringFields = ['keys', 'secondaryKeys', 'content', 'comment', 'group', 'automationId']
  const numberFields = ['uid', 'selectiveLogic', 'order', 'position', 'depth', 'probability', 'groupWeight', 'scanDepth', 'role', 'displayIndex', 'sticky', 'cooldown', 'delay']

  for (const field of boolFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernWorldInfoEntry] ? 1 : 0)
    }
  }

  for (const field of stringFields) {
    if (field in updates) {
      const dbField = field === 'group' ? '"group"' : field
      fields.push(`${dbField} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernWorldInfoEntry])
    }
  }

  for (const field of numberFields) {
    if (field in updates) {
      const dbField = field === 'order' ? '"order"' : field
      fields.push(`${dbField} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernWorldInfoEntry])
    }
  }

  values.push(id)

  if (fields.length > 0) {
    return await db.execute(
      `UPDATE tavern_world_info_entries SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    )
  }
}

export async function deleteWorldInfoEntry(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_world_info_entries WHERE id = $1", [id])
}

// ============ 预设 CRUD ============

export async function insertPreset(preset: Omit<TavernPreset, 'id' | 'createdAt' | 'updatedAt' | 'originalData'> & { originalData?: string | null }) {
  const db = await getDb()
  const now = Date.now()
  // 如果是默认预设，originalData 应该与 data 相同；否则可以为 null
  const originalData = preset.originalData ?? (preset.isDefault ? preset.data : null)
  const result = await db.execute(
    "INSERT INTO tavern_presets (name, presetType, data, originalData, isDefault, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [preset.name, preset.presetType, preset.data, originalData, preset.isDefault ? 1 : 0, now, now]
  )
  return result.lastInsertId
}

export async function getPresets() {
  const db = await getDb()
  return await db.select<TavernPreset[]>("SELECT * FROM tavern_presets ORDER BY name")
}

export async function getPresetById(id: number) {
  const db = await getDb()
  const results = await db.select<TavernPreset[]>("SELECT * FROM tavern_presets WHERE id = $1", [id])
  return results[0] || null
}

/**
 * 根据预设名称查找预设
 * 用于角色名匹配预设名的自动切换功能
 */
export async function getPresetByName(name: string) {
  const db = await getDb()
  const results = await db.select<TavernPreset[]>(
    "SELECT * FROM tavern_presets WHERE name = $1",
    [name]
  )
  return results[0] || null
}

/**
 * 获取角色绑定的预设
 * 优先级：1. 角色卡显式绑定的 presetId  2. 预设名与角色名匹配
 */
export async function getCardBoundPreset(card: TavernCard): Promise<TavernPreset | null> {
  // 1. 如果角色卡有显式绑定的预设
  if (card.presetId) {
    const preset = await getPresetById(card.presetId)
    if (preset) return preset
  }
  
  // 2. 尝试按角色名匹配预设名
  const matchedPreset = await getPresetByName(card.name)
  return matchedPreset
}

/**
 * 绑定预设到角色卡
 */
export async function bindPresetToCard(cardId: number, presetId: number | null): Promise<boolean> {
  const db = await getDb()
  await db.execute(
    "UPDATE tavern_cards SET presetId = $1, updatedAt = $2 WHERE id = $3",
    [presetId, Date.now(), cardId]
  )
  return true
}

export async function updatePreset(id: number, updates: Partial<TavernPreset>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if ('name' in updates) {
    fields.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if ('data' in updates) {
    fields.push(`data = $${paramIndex++}`)
    values.push(updates.data)
  }
  if ('originalData' in updates) {
    fields.push(`originalData = $${paramIndex++}`)
    values.push(updates.originalData)
  }

  fields.push(`updatedAt = $${paramIndex++}`)
  values.push(Date.now())
  values.push(id)

  return await db.execute(
    `UPDATE tavern_presets SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

export async function deletePreset(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_presets WHERE id = $1", [id])
}

/**
 * 恢复预设到默认值
 * - 对于 isDefault=true 的预设：从 originalData 恢复
 * - 对于普通预设：如果有 originalData 则恢复，否则返回 false
 */
export async function restorePresetToDefault(id: number): Promise<boolean> {
  const db = await getDb()
  const preset = await getPresetById(id)
  
  if (!preset) {
    return false
  }
  
  // 如果没有 originalData，无法恢复
  if (!preset.originalData) {
    return false
  }
  
  // 恢复 data 为 originalData
  await db.execute(
    "UPDATE tavern_presets SET data = $1, updatedAt = $2 WHERE id = $3",
    [preset.originalData, Date.now(), id]
  )
  
  return true
}

/**
 * 保存当前预设状态为恢复点
 * 用于普通预设保存“最后保存状态”
 */
export async function savePresetRestorePoint(id: number): Promise<boolean> {
  const db = await getDb()
  const preset = await getPresetById(id)
  
  if (!preset) {
    return false
  }
  
  await db.execute(
    "UPDATE tavern_presets SET originalData = $1 WHERE id = $2",
    [preset.data, id]
  )
  
  return true
}

// ============ 正则脚本 CRUD ============

export async function insertRegex(regex: Omit<TavernRegex, 'id' | 'createdAt'>) {
  const db = await getDb()
  const result = await db.execute(
    `INSERT INTO tavern_regex (
      name, scriptName, findRegex, replaceString, trimStrings, placement,
      disabled, markdownOnly, promptOnly, runOnEdit, substituteRegex,
      minDepth, maxDepth, cardId, presetId, createdAt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      regex.name, regex.scriptName, regex.findRegex, regex.replaceString,
      regex.trimStrings, regex.placement, regex.disabled ? 1 : 0,
      regex.markdownOnly ? 1 : 0, regex.promptOnly ? 1 : 0, regex.runOnEdit ? 1 : 0,
      regex.substituteRegex ? 1 : 0, regex.minDepth, regex.maxDepth,
      regex.cardId, regex.presetId, Date.now()
    ]
  )
  return result.lastInsertId
}

export async function getRegexScripts(cardId?: number, presetId?: number) {
  const db = await getDb()
  if (cardId !== undefined) {
    return await db.select<TavernRegex[]>(
      "SELECT * FROM tavern_regex WHERE cardId = $1 OR cardId IS NULL ORDER BY name", [cardId]
    )
  }
  if (presetId !== undefined) {
    return await db.select<TavernRegex[]>(
      "SELECT * FROM tavern_regex WHERE presetId = $1 OR presetId IS NULL ORDER BY name", [presetId]
    )
  }
  return await db.select<TavernRegex[]>("SELECT * FROM tavern_regex ORDER BY name")
}

export async function updateRegex(id: number, updates: Partial<TavernRegex>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if ('name' in updates) {
    fields.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if ('scriptName' in updates) {
    fields.push(`scriptName = $${paramIndex++}`)
    values.push(updates.scriptName)
  }
  if ('findRegex' in updates) {
    fields.push(`findRegex = $${paramIndex++}`)
    values.push(updates.findRegex)
  }
  if ('replaceString' in updates) {
    fields.push(`replaceString = $${paramIndex++}`)
    values.push(updates.replaceString)
  }
  if ('trimStrings' in updates) {
    fields.push(`trimStrings = $${paramIndex++}`)
    values.push(updates.trimStrings)
  }
  if ('placement' in updates) {
    fields.push(`placement = $${paramIndex++}`)
    values.push(updates.placement)
  }
  if ('disabled' in updates) {
    fields.push(`disabled = $${paramIndex++}`)
    values.push(updates.disabled ? 1 : 0)
  }
  if ('markdownOnly' in updates) {
    fields.push(`markdownOnly = $${paramIndex++}`)
    values.push(updates.markdownOnly ? 1 : 0)
  }
  if ('promptOnly' in updates) {
    fields.push(`promptOnly = $${paramIndex++}`)
    values.push(updates.promptOnly ? 1 : 0)
  }
  if ('runOnEdit' in updates) {
    fields.push(`runOnEdit = $${paramIndex++}`)
    values.push(updates.runOnEdit ? 1 : 0)
  }
  if ('substituteRegex' in updates) {
    fields.push(`substituteRegex = $${paramIndex++}`)
    values.push(updates.substituteRegex ? 1 : 0)
  }
  if ('minDepth' in updates) {
    fields.push(`minDepth = $${paramIndex++}`)
    values.push(updates.minDepth)
  }
  if ('maxDepth' in updates) {
    fields.push(`maxDepth = $${paramIndex++}`)
    values.push(updates.maxDepth)
  }
  if ('cardId' in updates) {
    fields.push(`cardId = $${paramIndex++}`)
    values.push(updates.cardId)
  }
  if ('presetId' in updates) {
    fields.push(`presetId = $${paramIndex++}`)
    values.push(updates.presetId)
  }

  if (fields.length === 0) return

  values.push(id)

  return await db.execute(
    `UPDATE tavern_regex SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

export async function deleteRegex(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_regex WHERE id = $1", [id])
}

// ============ 用户设定 CRUD ============

export async function insertPersona(persona: Omit<TavernPersona, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb()
  const now = Date.now()
  const result = await db.execute(
    `INSERT INTO tavern_personas (
      name, description, avatarPath, isDefault,
      position, depth, role, lorebook, connections,
      createdAt, updatedAt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      persona.name,
      persona.description,
      persona.avatarPath,
      persona.isDefault ? 1 : 0,
      persona.position ?? 0,
      persona.depth ?? 2,
      persona.role ?? 0,
      persona.lorebook ?? '',
      persona.connections ?? '[]',
      now,
      now
    ]
  )
  return result.lastInsertId
}

export async function getPersonas() {
  const db = await getDb()
  return await db.select<TavernPersona[]>("SELECT * FROM tavern_personas ORDER BY name")
}

export async function getDefaultPersona() {
  const db = await getDb()
  const results = await db.select<TavernPersona[]>("SELECT * FROM tavern_personas WHERE isDefault = 1")
  return results[0] || null
}

export async function setDefaultPersona(id: number) {
  const db = await getDb()
  await db.execute("UPDATE tavern_personas SET isDefault = 0")
  return await db.execute("UPDATE tavern_personas SET isDefault = 1 WHERE id = $1", [id])
}

export async function updatePersona(id: number, updates: Partial<TavernPersona>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const stringFields = ['name', 'description', 'avatarPath', 'lorebook', 'connections']
  const numberFields = ['position', 'depth', 'role']

  for (const field of stringFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernPersona])
    }
  }

  for (const field of numberFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernPersona])
    }
  }

  if (fields.length === 0) return

  fields.push(`updatedAt = $${paramIndex++}`)
  values.push(Date.now())
  values.push(id)

  return await db.execute(
    `UPDATE tavern_personas SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

/**
 * 根据 ID 获取 Persona
 */
export async function getPersonaById(id: number) {
  const db = await getDb()
  const results = await db.select<TavernPersona[]>("SELECT * FROM tavern_personas WHERE id = $1", [id])
  return results[0] || null
}

export async function deletePersona(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_personas WHERE id = $1 AND isDefault = 0", [id])
}

// ============ 群组 CRUD ============

export async function insertGroup(group: Omit<TavernGroup, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb()
  const now = Date.now()
  const result = await db.execute(
    `INSERT INTO tavern_groups (
      name, description, avatarPath, activationStrategy, generationType,
      allowSelfResponses, favChecked, createdAt, updatedAt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      group.name, group.description, group.avatarPath, group.activationStrategy,
      group.generationType, group.allowSelfResponses ? 1 : 0, group.favChecked ? 1 : 0,
      now, now
    ]
  )
  return result.lastInsertId
}

export async function getGroups() {
  const db = await getDb()
  return await db.select<TavernGroup[]>("SELECT * FROM tavern_groups ORDER BY updatedAt DESC")
}

export async function getGroupById(id: number) {
  const db = await getDb()
  const results = await db.select<TavernGroup[]>("SELECT * FROM tavern_groups WHERE id = $1", [id])
  return results[0] || null
}

export async function updateGroup(id: number, updates: Partial<TavernGroup>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const stringFields = ['name', 'description', 'avatarPath']
  const numberFields = ['activationStrategy', 'generationType']
  const boolFields = ['allowSelfResponses', 'favChecked']

  for (const field of stringFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernGroup])
    }
  }

  for (const field of numberFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernGroup])
    }
  }

  for (const field of boolFields) {
    if (field in updates) {
      fields.push(`${field} = $${paramIndex++}`)
      values.push(updates[field as keyof TavernGroup] ? 1 : 0)
    }
  }

  fields.push(`updatedAt = $${paramIndex++}`)
  values.push(Date.now())
  values.push(id)

  return await db.execute(
    `UPDATE tavern_groups SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

export async function deleteGroup(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_groups WHERE id = $1", [id])
}

// ============ 群组成员 CRUD ============

export async function addGroupMember(member: Omit<TavernGroupMember, 'id'>) {
  const db = await getDb()
  const result = await db.execute(
    "INSERT INTO tavern_group_members (groupId, cardId, isActive, isMuted, sortOrder) VALUES ($1, $2, $3, $4, $5)",
    [member.groupId, member.cardId, member.isActive ? 1 : 0, member.isMuted ? 1 : 0, member.sortOrder]
  )
  return result.lastInsertId
}

export async function getGroupMembers(groupId: number) {
  const db = await getDb()
  return await db.select<(TavernGroupMember & TavernCard)[]>(
    `SELECT gm.*, c.* FROM tavern_group_members gm 
     JOIN tavern_cards c ON gm.cardId = c.id 
     WHERE gm.groupId = $1 ORDER BY gm.sortOrder ASC`,
    [groupId]
  )
}

export async function updateGroupMember(id: number, updates: Partial<TavernGroupMember>) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if ('isActive' in updates) {
    fields.push(`isActive = $${paramIndex++}`)
    values.push(updates.isActive ? 1 : 0)
  }
  if ('isMuted' in updates) {
    fields.push(`isMuted = $${paramIndex++}`)
    values.push(updates.isMuted ? 1 : 0)
  }
  if ('sortOrder' in updates) {
    fields.push(`sortOrder = $${paramIndex++}`)
    values.push(updates.sortOrder)
  }

  values.push(id)

  if (fields.length > 0) {
    return await db.execute(
      `UPDATE tavern_group_members SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    )
  }
}

export async function removeGroupMember(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_group_members WHERE id = $1", [id])
}

// ============ 宏 CRUD ============

export async function getMacros() {
  const db = await getDb()
  return await db.select<TavernMacro[]>("SELECT * FROM tavern_macros ORDER BY name")
}

export async function insertMacro(macro: Omit<TavernMacro, 'id' | 'createdAt'>) {
  const db = await getDb()
  const result = await db.execute(
    "INSERT INTO tavern_macros (name, value, isSystem, createdAt) VALUES ($1, $2, $3, $4)",
    [macro.name, macro.value, macro.isSystem ? 1 : 0, Date.now()]
  )
  return result.lastInsertId
}

export async function updateMacro(id: number, value: string) {
  const db = await getDb()
  return await db.execute("UPDATE tavern_macros SET value = $1 WHERE id = $2", [value, id])
}

export async function deleteMacro(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_macros WHERE id = $1 AND isSystem = 0", [id])
}

// ============ 聊天书签 CRUD ============

/**
 * 创建聊天书签
 */
export async function insertBookmark(bookmark: Omit<TavernBookmark, 'id' | 'createdAt'>) {
  const db = await getDb()
  const result = await db.execute(
    `INSERT INTO tavern_bookmarks (chatId, name, messageCount, lastMessageId, metadata, preview, createdAt) 
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      bookmark.chatId,
      bookmark.name,
      bookmark.messageCount,
      bookmark.lastMessageId,
      bookmark.metadata || '',
      bookmark.preview || '',
      Date.now(),
    ]
  )
  return result.lastInsertId
}

/**
 * 获取聊天会话的所有书签
 */
export async function getBookmarksByChatId(chatId: number) {
  const db = await getDb()
  return await db.select<TavernBookmark[]>(
    "SELECT * FROM tavern_bookmarks WHERE chatId = $1 ORDER BY createdAt DESC",
    [chatId]
  )
}

/**
 * 获取书签详情
 */
export async function getBookmarkById(id: number) {
  const db = await getDb()
  const results = await db.select<TavernBookmark[]>(
    "SELECT * FROM tavern_bookmarks WHERE id = $1",
    [id]
  )
  return results[0] || null
}

/**
 * 更新书签名称
 */
export async function updateBookmarkName(id: number, name: string) {
  const db = await getDb()
  return await db.execute(
    "UPDATE tavern_bookmarks SET name = $1 WHERE id = $2",
    [name, id]
  )
}

/**
 * 删除书签
 */
export async function deleteBookmark(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_bookmarks WHERE id = $1", [id])
}

/**
 * 删除聊天会话的所有书签
 */
export async function deleteBookmarksByChatId(chatId: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_bookmarks WHERE chatId = $1", [chatId])
}

/**
 * 恢复到书签点
 * 删除书签点之后的所有消息
 */
export async function restoreToBookmark(bookmarkId: number): Promise<boolean> {
  const db = await getDb()
  
  const bookmark = await getBookmarkById(bookmarkId)
  if (!bookmark) return false
  
  // 删除书签点之后的所有消息
  await db.execute(
    "DELETE FROM tavern_messages WHERE chatId = $1 AND id > $2",
    [bookmark.chatId, bookmark.lastMessageId]
  )
  
  // 更新聊天时间戳
  await updateChatTimestamp(bookmark.chatId)
  
  return true
}

/**
 * 创建书签的便捷方法
 * 自动获取当前消息数量和生成预览
 */
export async function createBookmarkFromChat(
  chatId: number,
  name: string
): Promise<number | undefined> {
  const messages = await getMessagesByChatId(chatId)
  if (messages.length === 0) return undefined
  
  const lastMessage = messages[messages.length - 1]
  
  // 生成预览 (最后 2 条消息的摘要)
  const previewMessages = messages.slice(-2)
  const preview = previewMessages
    .map(m => `${m.name}: ${m.content.slice(0, 50)}${m.content.length > 50 ? '...' : ''}`)
    .join('\n')
  
  // 获取聊天元数据
  const chat = await getChatById(chatId)
  const metadata = chat?.metadata || ''
  
  return await insertBookmark({
    chatId,
    name,
    messageCount: messages.length,
    lastMessageId: lastMessage.id,
    metadata,
    preview,
  })
}


// ============ 快捷回复 CRUD ============

/**
 * 初始化默认快捷回复集合
 */
async function initDefaultQuickReplySet() {
  const db = await getDb()
  
  // 检查是否已有集合
  const existing = await db.select<TavernQuickReplySet[]>(
    "SELECT * FROM tavern_quick_reply_sets LIMIT 1"
  )
  
  if (existing.length > 0) {
    return // 已初始化
  }
  
  const now = Date.now()
  
  // 创建默认全局集合
  const result = await db.execute(
    `INSERT INTO tavern_quick_reply_sets (name, scope, cardId, color, isEnabled, sortOrder, createdAt, updatedAt) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    ['默认', 'global', null, '', 1, 0, now, now]
  )
  
  const setId = result.lastInsertId
  if (!setId) return
  
  // 添加一些默认快捷回复
  const defaultReplies = [
    { label: '继续', message: '继续', icon: 'fa-forward' },
    { label: '详细描述', message: '请更详细地描述一下', icon: 'fa-expand' },
    { label: '换个方式', message: '请换一种方式表达', icon: 'fa-refresh' },
  ]
  
  for (let i = 0; i < defaultReplies.length; i++) {
    const reply = defaultReplies[i]
    await db.execute(
      `INSERT INTO tavern_quick_replies (setId, label, icon, title, message, isHidden, executeOnStartup, executeOnUser, executeOnAi, executeOnChatChange, preventAutoExecute, sortOrder, createdAt, updatedAt) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [setId, reply.label, reply.icon, reply.label, reply.message, 0, 0, 0, 0, 0, 1, i, now, now]
    )
  }
}

/**
 * 获取所有快捷回复集合
 */
export async function getQuickReplySets(): Promise<TavernQuickReplySet[]> {
  const db = await getDb()
  return await db.select<TavernQuickReplySet[]>(
    "SELECT * FROM tavern_quick_reply_sets ORDER BY sortOrder ASC, createdAt ASC"
  )
}

/**
 * 获取启用的快捷回复集合 (全局 + 角色绑定)
 */
export async function getEnabledQuickReplySets(cardId?: number): Promise<TavernQuickReplySet[]> {
  const db = await getDb()
  
  if (cardId) {
    return await db.select<TavernQuickReplySet[]>(
      `SELECT * FROM tavern_quick_reply_sets 
       WHERE isEnabled = 1 AND (scope = 'global' OR (scope = 'character' AND cardId = $1))
       ORDER BY sortOrder ASC, createdAt ASC`,
      [cardId]
    )
  }
  
  return await db.select<TavernQuickReplySet[]>(
    "SELECT * FROM tavern_quick_reply_sets WHERE isEnabled = 1 AND scope = 'global' ORDER BY sortOrder ASC, createdAt ASC"
  )
}

/**
 * 获取快捷回复集合详情
 */
export async function getQuickReplySetById(id: number): Promise<TavernQuickReplySet | null> {
  const db = await getDb()
  const results = await db.select<TavernQuickReplySet[]>(
    "SELECT * FROM tavern_quick_reply_sets WHERE id = $1",
    [id]
  )
  return results[0] || null
}

/**
 * 创建快捷回复集合
 */
export async function insertQuickReplySet(
  set: Omit<TavernQuickReplySet, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number | undefined> {
  const db = await getDb()
  const now = Date.now()
  const result = await db.execute(
    `INSERT INTO tavern_quick_reply_sets (name, scope, cardId, color, isEnabled, sortOrder, createdAt, updatedAt) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [set.name, set.scope, set.cardId, set.color || '', set.isEnabled ? 1 : 0, set.sortOrder || 0, now, now]
  )
  return result.lastInsertId
}

/**
 * 更新快捷回复集合
 */
export async function updateQuickReplySet(
  id: number,
  updates: Partial<Omit<TavernQuickReplySet, 'id' | 'createdAt' | 'updatedAt'>>
) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1
  
  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if (updates.scope !== undefined) {
    fields.push(`scope = $${paramIndex++}`)
    values.push(updates.scope)
  }
  if (updates.cardId !== undefined) {
    fields.push(`cardId = $${paramIndex++}`)
    values.push(updates.cardId)
  }
  if (updates.color !== undefined) {
    fields.push(`color = $${paramIndex++}`)
    values.push(updates.color)
  }
  if (updates.isEnabled !== undefined) {
    fields.push(`isEnabled = $${paramIndex++}`)
    values.push(updates.isEnabled ? 1 : 0)
  }
  if (updates.sortOrder !== undefined) {
    fields.push(`sortOrder = $${paramIndex++}`)
    values.push(updates.sortOrder)
  }
  
  if (fields.length === 0) return
  
  fields.push(`updatedAt = $${paramIndex++}`)
  values.push(Date.now())
  values.push(id)
  
  await db.execute(
    `UPDATE tavern_quick_reply_sets SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

/**
 * 删除快捷回复集合
 */
export async function deleteQuickReplySet(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_quick_reply_sets WHERE id = $1", [id])
}

/**
 * 获取集合中的所有快捷回复
 */
export async function getQuickRepliesBySetId(setId: number): Promise<TavernQuickReply[]> {
  const db = await getDb()
  return await db.select<TavernQuickReply[]>(
    "SELECT * FROM tavern_quick_replies WHERE setId = $1 ORDER BY sortOrder ASC, createdAt ASC",
    [setId]
  )
}

/**
 * 获取可见的快捷回复
 */
export async function getVisibleQuickRepliesBySetId(setId: number): Promise<TavernQuickReply[]> {
  const db = await getDb()
  return await db.select<TavernQuickReply[]>(
    "SELECT * FROM tavern_quick_replies WHERE setId = $1 AND isHidden = 0 ORDER BY sortOrder ASC, createdAt ASC",
    [setId]
  )
}

/**
 * 获取快捷回复详情
 */
export async function getQuickReplyById(id: number): Promise<TavernQuickReply | null> {
  const db = await getDb()
  const results = await db.select<TavernQuickReply[]>(
    "SELECT * FROM tavern_quick_replies WHERE id = $1",
    [id]
  )
  return results[0] || null
}

/**
 * 创建快捷回复
 */
export async function insertQuickReply(
  reply: Omit<TavernQuickReply, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number | undefined> {
  const db = await getDb()
  const now = Date.now()
  const result = await db.execute(
    `INSERT INTO tavern_quick_replies (setId, label, icon, title, message, isHidden, executeOnStartup, executeOnUser, executeOnAi, executeOnChatChange, preventAutoExecute, sortOrder, createdAt, updatedAt) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      reply.setId,
      reply.label,
      reply.icon || '',
      reply.title || '',
      reply.message || '',
      reply.isHidden ? 1 : 0,
      reply.executeOnStartup ? 1 : 0,
      reply.executeOnUser ? 1 : 0,
      reply.executeOnAi ? 1 : 0,
      reply.executeOnChatChange ? 1 : 0,
      reply.preventAutoExecute ? 1 : 0,
      reply.sortOrder || 0,
      now,
      now,
    ]
  )
  return result.lastInsertId
}

/**
 * 更新快捷回复
 */
export async function updateQuickReply(
  id: number,
  updates: Partial<Omit<TavernQuickReply, 'id' | 'setId' | 'createdAt' | 'updatedAt'>>
) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1
  
  if (updates.label !== undefined) {
    fields.push(`label = $${paramIndex++}`)
    values.push(updates.label)
  }
  if (updates.icon !== undefined) {
    fields.push(`icon = $${paramIndex++}`)
    values.push(updates.icon)
  }
  if (updates.title !== undefined) {
    fields.push(`title = $${paramIndex++}`)
    values.push(updates.title)
  }
  if (updates.message !== undefined) {
    fields.push(`message = $${paramIndex++}`)
    values.push(updates.message)
  }
  if (updates.isHidden !== undefined) {
    fields.push(`isHidden = $${paramIndex++}`)
    values.push(updates.isHidden ? 1 : 0)
  }
  if (updates.executeOnStartup !== undefined) {
    fields.push(`executeOnStartup = $${paramIndex++}`)
    values.push(updates.executeOnStartup ? 1 : 0)
  }
  if (updates.executeOnUser !== undefined) {
    fields.push(`executeOnUser = $${paramIndex++}`)
    values.push(updates.executeOnUser ? 1 : 0)
  }
  if (updates.executeOnAi !== undefined) {
    fields.push(`executeOnAi = $${paramIndex++}`)
    values.push(updates.executeOnAi ? 1 : 0)
  }
  if (updates.executeOnChatChange !== undefined) {
    fields.push(`executeOnChatChange = $${paramIndex++}`)
    values.push(updates.executeOnChatChange ? 1 : 0)
  }
  if (updates.preventAutoExecute !== undefined) {
    fields.push(`preventAutoExecute = $${paramIndex++}`)
    values.push(updates.preventAutoExecute ? 1 : 0)
  }
  if (updates.sortOrder !== undefined) {
    fields.push(`sortOrder = $${paramIndex++}`)
    values.push(updates.sortOrder)
  }
  
  if (fields.length === 0) return
  
  fields.push(`updatedAt = $${paramIndex++}`)
  values.push(Date.now())
  values.push(id)
  
  await db.execute(
    `UPDATE tavern_quick_replies SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

/**
 * 删除快捷回复
 */
export async function deleteQuickReply(id: number) {
  const db = await getDb()
  return await db.execute("DELETE FROM tavern_quick_replies WHERE id = $1", [id])
}

/**
 * 获取需要自动执行的快捷回复
 */
export async function getAutoExecuteQuickReplies(
  trigger: 'startup' | 'user' | 'ai' | 'chatChange',
  cardId?: number
): Promise<TavernQuickReply[]> {
  const db = await getDb()
  
  const triggerColumn = {
    startup: 'executeOnStartup',
    user: 'executeOnUser',
    ai: 'executeOnAi',
    chatChange: 'executeOnChatChange',
  }[trigger]
  
  // 获取启用的集合
  const sets = await getEnabledQuickReplySets(cardId)
  if (sets.length === 0) return []
  
  const setIds = sets.map(s => s.id)
  const placeholders = setIds.map((_, i) => `$${i + 1}`).join(', ')
  
  return await db.select<TavernQuickReply[]>(
    `SELECT * FROM tavern_quick_replies 
     WHERE setId IN (${placeholders}) 
     AND ${triggerColumn} = 1 
     AND preventAutoExecute = 0
     ORDER BY sortOrder ASC`,
    setIds
  )
}

// ============ SysPrompt (系统提示词预设) CRUD ============

/**
 * 初始化默认 SysPrompt
 */
async function initDefaultSysPrompt() {
  const db = await getDb()
  const existing = await db.select<TavernSysPrompt[]>(
    "SELECT * FROM tavern_sysprompts WHERE isDefault = 1"
  )
  
  if (existing.length > 0) return
  
  const now = Date.now()
  
  // 创建默认 SysPrompt
  await db.execute(
    `INSERT INTO tavern_sysprompts (name, content, postHistory, enabled, isDefault, createdAt, updatedAt)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'Default',
      'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}. Write 1 reply only in internet RP style, italicize actions, and avoid quotation marks. Use markdown. Be proactive, creative, and drive the plot and conversation forward. Write at least 1 paragraph, up to 4. Always stay in character and avoid repetition.',
      '', // postHistory 留空，让角色卡的 jailbreak 生效
      0,  // 默认不启用，让角色卡的 systemPrompt 生效
      1,  // isDefault
      now,
      now,
    ]
  )
}

/**
 * 获取所有 SysPrompt 预设
 */
export async function getSysPrompts(): Promise<TavernSysPrompt[]> {
  const db = await getDb()
  return await db.select<TavernSysPrompt[]>(
    "SELECT * FROM tavern_sysprompts ORDER BY isDefault DESC, createdAt ASC"
  )
}

/**
 * 获取已启用的 SysPrompt
 */
export async function getEnabledSysPrompt(): Promise<TavernSysPrompt | null> {
  const db = await getDb()
  const results = await db.select<TavernSysPrompt[]>(
    "SELECT * FROM tavern_sysprompts WHERE enabled = 1 LIMIT 1"
  )
  return results[0] || null
}

/**
 * 获取 SysPrompt 详情
 */
export async function getSysPromptById(id: number): Promise<TavernSysPrompt | null> {
  const db = await getDb()
  const results = await db.select<TavernSysPrompt[]>(
    "SELECT * FROM tavern_sysprompts WHERE id = $1",
    [id]
  )
  return results[0] || null
}

/**
 * 创建 SysPrompt 预设
 */
export async function insertSysPrompt(
  prompt: Omit<TavernSysPrompt, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number | undefined> {
  const db = await getDb()
  const now = Date.now()
  const result = await db.execute(
    `INSERT INTO tavern_sysprompts (name, content, postHistory, enabled, isDefault, createdAt, updatedAt)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      prompt.name,
      prompt.content || '',
      prompt.postHistory || '',
      prompt.enabled ? 1 : 0,
      prompt.isDefault ? 1 : 0,
      now,
      now,
    ]
  )
  return result.lastInsertId
}

/**
 * 更新 SysPrompt 预设
 */
export async function updateSysPrompt(
  id: number,
  updates: Partial<Omit<TavernSysPrompt, 'id' | 'createdAt' | 'updatedAt'>>
) {
  const db = await getDb()
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1
  
  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if (updates.content !== undefined) {
    fields.push(`content = $${paramIndex++}`)
    values.push(updates.content)
  }
  if (updates.postHistory !== undefined) {
    fields.push(`postHistory = $${paramIndex++}`)
    values.push(updates.postHistory)
  }
  if (updates.enabled !== undefined) {
    fields.push(`enabled = $${paramIndex++}`)
    values.push(updates.enabled ? 1 : 0)
  }
  
  if (fields.length === 0) return
  
  fields.push(`updatedAt = $${paramIndex++}`)
  values.push(Date.now())
  values.push(id)
  
  await db.execute(
    `UPDATE tavern_sysprompts SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

/**
 * 启用指定 SysPrompt (同时禁用其他)
 */
export async function enableSysPrompt(id: number) {
  const db = await getDb()
  // 禁用所有
  await db.execute("UPDATE tavern_sysprompts SET enabled = 0")
  // 启用指定的
  await db.execute(
    "UPDATE tavern_sysprompts SET enabled = 1, updatedAt = $1 WHERE id = $2",
    [Date.now(), id]
  )
}

/**
 * 禁用所有 SysPrompt
 */
export async function disableAllSysPrompts() {
  const db = await getDb()
  await db.execute("UPDATE tavern_sysprompts SET enabled = 0")
}

/**
 * 删除 SysPrompt 预设
 */
export async function deleteSysPrompt(id: number) {
  const db = await getDb()
  // 不能删除默认的
  return await db.execute(
    "DELETE FROM tavern_sysprompts WHERE id = $1 AND isDefault = 0",
    [id]
  )
}
