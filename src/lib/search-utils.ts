export interface SearchMatch {
  text: string
  index: number
  length: number
  isExact: boolean
}

export interface SearchableItem {
  id: string
  title: string
  content: string
  metadata?: Record<string, any>
}

export interface SearchResult<T = any> {
  item: T
  matches: SearchMatch[]
  score: number
  highlightText: string
  matchType: 'exact' | 'fuzzy'
}

/**
 * 在文本中查找所有精确匹配项
 */
function findExactMatches(text: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = []
  const searchText = text.toLowerCase()
  const searchQuery = query.toLowerCase().trim()
  
  if (!searchQuery) return matches
  
  let index = 0
  while (index < searchText.length) {
    const foundIndex = searchText.indexOf(searchQuery, index)
    if (foundIndex === -1) break
    
    matches.push({
      text: text.substring(foundIndex, foundIndex + searchQuery.length),
      index: foundIndex,
      length: searchQuery.length,
      isExact: true
    })
    
    index = foundIndex + 1
  }
  
  return matches
}

/**
 * 在文本中查找模糊匹配项（分词匹配）
 */
function findFuzzyMatches(text: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = []
  const searchText = text.toLowerCase()
  const searchQuery = query.toLowerCase().trim()
  
  if (!searchQuery || searchQuery.length < 2) return matches
  
  // 将查询词拆分成单个字符进行模糊匹配
  const queryChars = searchQuery.split('')
  
  // 对于中文和英文都有效的模糊匹配
  // 查找包含查询词中任意字符的词语
  const words = text.split(/[\s\n,.，。、；;！!？?()（）\[\]【】]+/).filter(w => w.length > 0)
  
  for (const word of words) {
    const wordLower = word.toLowerCase()
    
    // 检查是否包含查询词的部分字符
    let matchCount = 0
    for (const char of queryChars) {
      if (wordLower.includes(char)) {
        matchCount++
      }
    }
    
    // 如果匹配了查询词的大部分字符，认为是模糊匹配
    const matchRatio = matchCount / queryChars.length
    if (matchRatio >= 0.5 && word.length >= 2) {
      const wordIndex = searchText.indexOf(wordLower)
      if (wordIndex !== -1) {
        matches.push({
          text: text.substring(wordIndex, wordIndex + word.length),
          index: wordIndex,
          length: word.length,
          isExact: false
        })
      }
    }
  }
  
  return matches
}

/**
 * 计算搜索结果的评分
 */
function calculateScore(
  contentMatches: SearchMatch[],
  titleMatches: SearchMatch[],
  matchType: 'exact' | 'fuzzy'
): number {
  let score = 0
  
  // 精确匹配基础分更高
  const baseScore = matchType === 'exact' ? 100 : 50
  
  // 标题匹配权重 3x
  score += titleMatches.length * baseScore * 3
  
  // 内容匹配权重 1x
  score += contentMatches.length * baseScore
  
  // 匹配数量加成
  score += (contentMatches.length + titleMatches.length) * 5
  
  return score
}

/**
 * 生成高亮文本片段
 */
function generateHighlight(text: string, matches: SearchMatch[], maxLength: number = 200): string {
  if (matches.length === 0) {
    return text.substring(0, maxLength)
  }
  
  // 使用第一个匹配位置作为中心
  const firstMatch = matches[0]
  const start = Math.max(0, firstMatch.index - 50)
  const end = Math.min(text.length, firstMatch.index + maxLength)
  
  let snippet = text.substring(start, end)
  
  if (start > 0) snippet = '...' + snippet
  if (end < text.length) snippet = snippet + '...'
  
  return snippet
}

/**
 * 执行搜索（自动合并精确和模糊搜索结果）
 */
export function search<T extends SearchableItem>(
  items: T[],
  query: string,
  options: { maxResults?: number } = {}
): SearchResult<T>[] {
  if (!query.trim()) return []
  
  const { maxResults = 100 } = options
  const exactResults: SearchResult<T>[] = []
  const fuzzyResults: SearchResult<T>[] = []
  
  for (const item of items) {
    // 精确搜索
    const exactTitleMatches = findExactMatches(item.title, query)
    const exactContentMatches = findExactMatches(item.content, query)
    
    if (exactTitleMatches.length > 0 || exactContentMatches.length > 0) {
      const score = calculateScore(exactContentMatches, exactTitleMatches, 'exact')
      const highlightText = generateHighlight(item.content, exactContentMatches)
      
      exactResults.push({
        item,
        matches: [...exactTitleMatches, ...exactContentMatches],
        score,
        highlightText,
        matchType: 'exact'
      })
    } else {
      // 只有在没有精确匹配时才进行模糊搜索
      const fuzzyTitleMatches = findFuzzyMatches(item.title, query)
      const fuzzyContentMatches = findFuzzyMatches(item.content, query)
      
      if (fuzzyTitleMatches.length > 0 || fuzzyContentMatches.length > 0) {
        const score = calculateScore(fuzzyContentMatches, fuzzyTitleMatches, 'fuzzy')
        const highlightText = generateHighlight(item.content, fuzzyContentMatches)
        
        fuzzyResults.push({
          item,
          matches: [...fuzzyTitleMatches, ...fuzzyContentMatches],
          score,
          highlightText,
          matchType: 'fuzzy'
        })
      }
    }
  }
  
  // 精确匹配按评分排序
  exactResults.sort((a, b) => b.score - a.score)
  
  // 模糊匹配按评分排序
  fuzzyResults.sort((a, b) => b.score - a.score)
  
  // 合并结果：精确匹配在前，模糊匹配在后
  const allResults = [...exactResults, ...fuzzyResults]
  
  // 限制结果数量
  return allResults.slice(0, maxResults)
}
