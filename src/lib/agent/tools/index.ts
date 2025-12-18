import { Tool } from '../types'
import { noteTools } from './note-tools'
import { chatTools } from './chat-tools'
import { tagTools } from './tag-tools'
import { markTools } from './mark-tools'
import { folderTools } from './folder-tools'

export const allTools: Tool[] = [
  ...noteTools,
  ...chatTools,
  ...tagTools,
  ...markTools,
  ...folderTools,
]

export function getToolByName(name: string): Tool | undefined {
  return allTools.find(tool => tool.name === name)
}

export function getToolsByCategory(category: Tool['category']): Tool[] {
  return allTools.filter(tool => tool.category === category)
}

export function getToolDescriptions(): string {
  return allTools.map(tool => {
    const params = tool.parameters.map(p => 
      `  - ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`
    ).join('\n')
    
    return `### ${tool.name}
${tool.description}
Category: ${tool.category}
Requires Confirmation: ${tool.requiresConfirmation ? 'Yes' : 'No'}
Parameters:
${params || '  None'}
`
  }).join('\n\n')
}

export * from './note-tools'
export * from './chat-tools'
export * from './tag-tools'
export * from './mark-tools'
export * from './folder-tools'
