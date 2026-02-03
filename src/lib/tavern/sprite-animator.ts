/**
 * 精灵动画引擎
 * 支持角色精灵图动画和表情切换
 */

// ============ 类型定义 ============

/**
 * 精灵图层
 */
export interface SpriteLayer {
  id: string
  name: string
  /** 图片 URL */
  imageUrl: string
  /** Z 层级 */
  zIndex: number
  /** 是否可见 */
  visible: boolean
  /** 透明度 (0-1) */
  opacity: number
  /** 位置偏移 */
  offset: { x: number; y: number }
  /** 缩放 */
  scale: { x: number; y: number }
  /** 旋转角度 (度) */
  rotation: number
  /** 混合模式 */
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay'
}

/**
 * 精灵组 (表情/姿势)
 */
export interface SpriteGroup {
  id: string
  name: string
  /** 触发关键词 */
  triggers: string[]
  /** 包含的图层 */
  layers: SpriteLayer[]
  /** 是否为默认表情 */
  isDefault?: boolean
}

/**
 * 精灵动画配置
 */
export interface SpriteAnimation {
  id: string
  name: string
  /** 关键帧 */
  keyframes: AnimationKeyframe[]
  /** 持续时间 (毫秒) */
  duration: number
  /** 循环次数 (0 = 无限) */
  loops: number
  /** 缓动函数 */
  easing: EasingFunction
  /** 动画结束后的行为 */
  onComplete: 'reset' | 'hold' | 'reverse'
}

/**
 * 动画关键帧
 */
export interface AnimationKeyframe {
  /** 时间点 (0-1, 百分比) */
  time: number
  /** 目标图层 ID (空 = 所有图层) */
  targetLayerId?: string
  /** 属性变化 */
  properties: Partial<{
    opacity: number
    offsetX: number
    offsetY: number
    scaleX: number
    scaleY: number
    rotation: number
  }>
}

/**
 * 缓动函数类型
 */
export type EasingFunction = 
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'bounce'
  | 'elastic'

/**
 * 精灵角色配置
 */
export interface SpriteCharacter {
  id: string
  characterId: number
  /** 基础尺寸 */
  baseSize: { width: number; height: number }
  /** 精灵组 */
  groups: SpriteGroup[]
  /** 动画列表 */
  animations: SpriteAnimation[]
  /** 当前活动组 ID */
  activeGroupId?: string
  /** 过渡时间 (毫秒) */
  transitionDuration: number
}

/**
 * 动画播放状态
 */
export interface AnimationState {
  animationId: string
  startTime: number
  currentLoop: number
  isPlaying: boolean
  isPaused: boolean
  progress: number
}

// ============ 精灵动画器类 ============

export class SpriteAnimator {
  private character: SpriteCharacter
  private animationState: AnimationState | null = null
  private animationFrameId: number | null = null
  private onUpdate: (layers: SpriteLayer[]) => void
  private onAnimationEnd: (animationId: string) => void
  
  constructor(
    character: SpriteCharacter,
    onUpdate: (layers: SpriteLayer[]) => void,
    onAnimationEnd: (animationId: string) => void = () => {}
  ) {
    this.character = character
    this.onUpdate = onUpdate
    this.onAnimationEnd = onAnimationEnd
  }
  
  /**
   * 获取当前活动的精灵组
   */
  getActiveGroup(): SpriteGroup | undefined {
    if (this.character.activeGroupId) {
      return this.character.groups.find(g => g.id === this.character.activeGroupId)
    }
    return this.character.groups.find(g => g.isDefault) || this.character.groups[0]
  }
  
  /**
   * 切换精灵组 (表情)
   */
  setActiveGroup(groupId: string): void {
    const group = this.character.groups.find(g => g.id === groupId)
    if (!group) return
    
    this.character.activeGroupId = groupId
    this.onUpdate(this.getCurrentLayers())
  }
  
  /**
   * 根据触发词查找并切换表情
   */
  triggerExpression(text: string): boolean {
    const lowerText = text.toLowerCase()
    
    for (const group of this.character.groups) {
      for (const trigger of group.triggers) {
        if (lowerText.includes(trigger.toLowerCase())) {
          this.setActiveGroup(group.id)
          return true
        }
      }
    }
    
    return false
  }
  
  /**
   * 获取当前渲染的图层
   */
  getCurrentLayers(): SpriteLayer[] {
    const group = this.getActiveGroup()
    if (!group) return []
    
    // 如果有动画在播放，应用动画变换
    if (this.animationState?.isPlaying) {
      return this.applyAnimationToLayers(group.layers)
    }
    
    return group.layers.filter(l => l.visible).sort((a, b) => a.zIndex - b.zIndex)
  }
  
  /**
   * 播放动画
   */
  playAnimation(animationId: string): void {
    const animation = this.character.animations.find(a => a.id === animationId)
    if (!animation) return
    
    // 停止当前动画
    this.stopAnimation()
    
    // 初始化动画状态
    this.animationState = {
      animationId,
      startTime: performance.now(),
      currentLoop: 0,
      isPlaying: true,
      isPaused: false,
      progress: 0,
    }
    
    // 开始动画循环
    this.tick()
  }
  
  /**
   * 暂停动画
   */
  pauseAnimation(): void {
    if (this.animationState) {
      this.animationState.isPaused = true
    }
  }
  
  /**
   * 恢复动画
   */
  resumeAnimation(): void {
    if (this.animationState?.isPaused) {
      this.animationState.isPaused = false
      this.animationState.startTime = performance.now() - (this.animationState.progress * this.getActiveAnimation()!.duration)
      this.tick()
    }
  }
  
  /**
   * 停止动画
   */
  stopAnimation(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.animationState = null
    this.onUpdate(this.getCurrentLayers())
  }
  
  /**
   * 获取当前播放的动画
   */
  private getActiveAnimation(): SpriteAnimation | undefined {
    if (!this.animationState) return undefined
    return this.character.animations.find(a => a.id === this.animationState!.animationId)
  }
  
  /**
   * 动画帧更新
   */
  private tick = (): void => {
    if (!this.animationState?.isPlaying || this.animationState.isPaused) return
    
    const animation = this.getActiveAnimation()
    if (!animation) {
      this.stopAnimation()
      return
    }
    
    const now = performance.now()
    const elapsed = now - this.animationState.startTime
    let progress = elapsed / animation.duration
    
    // 处理循环
    if (progress >= 1) {
      this.animationState.currentLoop++
      
      if (animation.loops > 0 && this.animationState.currentLoop >= animation.loops) {
        // 动画结束
        this.handleAnimationEnd(animation)
        return
      }
      
      // 重置循环
      this.animationState.startTime = now
      progress = 0
    }
    
    // 应用缓动
    this.animationState.progress = this.applyEasing(progress, animation.easing)
    
    // 更新图层
    this.onUpdate(this.getCurrentLayers())
    
    // 继续下一帧
    this.animationFrameId = requestAnimationFrame(this.tick)
  }
  
  /**
   * 处理动画结束
   */
  private handleAnimationEnd(animation: SpriteAnimation): void {
    switch (animation.onComplete) {
      case 'reset':
        this.stopAnimation()
        break
      case 'hold':
        this.animationState!.isPlaying = false
        break
      case 'reverse':
        // 反向播放
        this.animationState!.startTime = performance.now()
        // 反转关键帧 (简化实现)
        break
    }
    
    this.onAnimationEnd(animation.id)
  }
  
  /**
   * 应用缓动函数
   */
  private applyEasing(t: number, easing: EasingFunction): number {
    switch (easing) {
      case 'linear':
        return t
      case 'ease-in':
        return t * t
      case 'ease-out':
        return 1 - (1 - t) * (1 - t)
      case 'ease-in-out':
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      case 'bounce':
        if (t < 1 / 2.75) {
          return 7.5625 * t * t
        } else if (t < 2 / 2.75) {
          t -= 1.5 / 2.75
          return 7.5625 * t * t + 0.75
        } else if (t < 2.5 / 2.75) {
          t -= 2.25 / 2.75
          return 7.5625 * t * t + 0.9375
        } else {
          t -= 2.625 / 2.75
          return 7.5625 * t * t + 0.984375
        }
      case 'elastic':
        if (t === 0 || t === 1) return t
        return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1
      default:
        return t
    }
  }
  
  /**
   * 应用动画变换到图层
   */
  private applyAnimationToLayers(layers: SpriteLayer[]): SpriteLayer[] {
    if (!this.animationState) return layers
    
    const animation = this.getActiveAnimation()
    if (!animation) return layers
    
    const progress = this.animationState.progress
    
    return layers.map(layer => {
      const layerCopy = { ...layer }
      
      // 找到影响该图层的关键帧
      const relevantKeyframes = animation.keyframes.filter(
        kf => !kf.targetLayerId || kf.targetLayerId === layer.id
      )
      
      if (relevantKeyframes.length === 0) return layerCopy
      
      // 按时间排序
      relevantKeyframes.sort((a, b) => a.time - b.time)
      
      // 找到当前进度的前后关键帧
      let prevKeyframe = relevantKeyframes[0]
      let nextKeyframe = relevantKeyframes[0]
      
      for (const kf of relevantKeyframes) {
        if (kf.time <= progress) {
          prevKeyframe = kf
        }
        if (kf.time >= progress) {
          nextKeyframe = kf
          break
        }
      }
      
      // 插值计算
      const localProgress = nextKeyframe.time === prevKeyframe.time
        ? 1
        : (progress - prevKeyframe.time) / (nextKeyframe.time - prevKeyframe.time)
      
      // 应用插值属性
      if (prevKeyframe.properties.opacity !== undefined && nextKeyframe.properties.opacity !== undefined) {
        layerCopy.opacity = this.lerp(prevKeyframe.properties.opacity, nextKeyframe.properties.opacity, localProgress)
      }
      
      if (prevKeyframe.properties.offsetX !== undefined && nextKeyframe.properties.offsetX !== undefined) {
        layerCopy.offset.x = this.lerp(prevKeyframe.properties.offsetX, nextKeyframe.properties.offsetX, localProgress)
      }
      
      if (prevKeyframe.properties.offsetY !== undefined && nextKeyframe.properties.offsetY !== undefined) {
        layerCopy.offset.y = this.lerp(prevKeyframe.properties.offsetY, nextKeyframe.properties.offsetY, localProgress)
      }
      
      if (prevKeyframe.properties.scaleX !== undefined && nextKeyframe.properties.scaleX !== undefined) {
        layerCopy.scale.x = this.lerp(prevKeyframe.properties.scaleX, nextKeyframe.properties.scaleX, localProgress)
      }
      
      if (prevKeyframe.properties.scaleY !== undefined && nextKeyframe.properties.scaleY !== undefined) {
        layerCopy.scale.y = this.lerp(prevKeyframe.properties.scaleY, nextKeyframe.properties.scaleY, localProgress)
      }
      
      if (prevKeyframe.properties.rotation !== undefined && nextKeyframe.properties.rotation !== undefined) {
        layerCopy.rotation = this.lerp(prevKeyframe.properties.rotation, nextKeyframe.properties.rotation, localProgress)
      }
      
      return layerCopy
    }).filter(l => l.visible && l.opacity > 0).sort((a, b) => a.zIndex - b.zIndex)
  }
  
  /**
   * 线性插值
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }
  
  /**
   * 销毁动画器
   */
  destroy(): void {
    this.stopAnimation()
  }
}

// ============ 辅助函数 ============

/**
 * 创建默认精灵组
 */
export function createDefaultSpriteGroup(
  id: string,
  name: string,
  imageUrl: string,
  triggers: string[] = []
): SpriteGroup {
  return {
    id,
    name,
    triggers,
    layers: [{
      id: `${id}_main`,
      name: 'Main',
      imageUrl,
      zIndex: 0,
      visible: true,
      opacity: 1,
      offset: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }],
  }
}

/**
 * 创建淡入动画
 */
export function createFadeInAnimation(duration: number = 300): SpriteAnimation {
  return {
    id: 'fade-in',
    name: '淡入',
    duration,
    loops: 1,
    easing: 'ease-out',
    onComplete: 'hold',
    keyframes: [
      { time: 0, properties: { opacity: 0 } },
      { time: 1, properties: { opacity: 1 } },
    ],
  }
}

/**
 * 创建淡出动画
 */
export function createFadeOutAnimation(duration: number = 300): SpriteAnimation {
  return {
    id: 'fade-out',
    name: '淡出',
    duration,
    loops: 1,
    easing: 'ease-in',
    onComplete: 'hold',
    keyframes: [
      { time: 0, properties: { opacity: 1 } },
      { time: 1, properties: { opacity: 0 } },
    ],
  }
}

/**
 * 创建弹跳动画
 */
export function createBounceAnimation(duration: number = 500): SpriteAnimation {
  return {
    id: 'bounce',
    name: '弹跳',
    duration,
    loops: 1,
    easing: 'bounce',
    onComplete: 'reset',
    keyframes: [
      { time: 0, properties: { offsetY: 0 } },
      { time: 0.5, properties: { offsetY: -20 } },
      { time: 1, properties: { offsetY: 0 } },
    ],
  }
}

/**
 * 创建摇晃动画
 */
export function createShakeAnimation(duration: number = 300): SpriteAnimation {
  return {
    id: 'shake',
    name: '摇晃',
    duration,
    loops: 1,
    easing: 'linear',
    onComplete: 'reset',
    keyframes: [
      { time: 0, properties: { offsetX: 0 } },
      { time: 0.2, properties: { offsetX: -5 } },
      { time: 0.4, properties: { offsetX: 5 } },
      { time: 0.6, properties: { offsetX: -5 } },
      { time: 0.8, properties: { offsetX: 5 } },
      { time: 1, properties: { offsetX: 0 } },
    ],
  }
}

/**
 * 创建呼吸动画 (循环)
 */
export function createBreathingAnimation(duration: number = 3000): SpriteAnimation {
  return {
    id: 'breathing',
    name: '呼吸',
    duration,
    loops: 0, // 无限循环
    easing: 'ease-in-out',
    onComplete: 'reset',
    keyframes: [
      { time: 0, properties: { scaleX: 1, scaleY: 1 } },
      { time: 0.5, properties: { scaleX: 1.02, scaleY: 1.02 } },
      { time: 1, properties: { scaleX: 1, scaleY: 1 } },
    ],
  }
}

/**
 * 创建表情映射 (从文本中的表情标签)
 */
export function parseExpressionTags(text: string): string[] {
  const matches = text.match(/\*\*?([^*]+)\*\*?/g)
  if (!matches) return []
  
  return matches.map(m => m.replace(/\*/g, '').toLowerCase().trim())
}

/**
 * 内置表情触发词映射
 */
export const EXPRESSION_TRIGGERS: Record<string, string[]> = {
  happy: ['happy', 'smile', 'laugh', 'joy', '开心', '高兴', '笑', '微笑'],
  sad: ['sad', 'cry', 'tear', 'sorrow', '伤心', '难过', '哭', '悲伤'],
  angry: ['angry', 'mad', 'rage', 'furious', '生气', '愤怒', '恼火'],
  surprised: ['surprise', 'shock', 'amazed', '惊讶', '震惊', '吃惊'],
  shy: ['shy', 'blush', 'embarrass', '害羞', '脸红', '羞涩'],
  neutral: ['neutral', 'calm', 'normal', '平静', '正常', '中性'],
  thinking: ['think', 'ponder', 'consider', '思考', '沉思', '考虑'],
  love: ['love', 'heart', 'adore', '爱', '喜欢', '❤'],
}
