import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import type { MCPServerConfig, MCPServerState } from '@/lib/mcp/types'

interface MCPState {
  // 全局配置
  enabled: boolean
  
  // 服务器配置列表
  servers: MCPServerConfig[]
  
  // 服务器运行时状态
  serverStates: Map<string, MCPServerState>
  
  // 当前选中的服务器（用于对话）
  selectedServerIds: string[]
  
  // 是否已初始化
  initialized: boolean
  
  // 方法
  setEnabled: (enabled: boolean) => void
  
  // 服务器管理
  addServer: (server: MCPServerConfig) => void
  updateServer: (id: string, updates: Partial<MCPServerConfig>) => void
  deleteServer: (id: string) => void
  toggleServerEnabled: (id: string) => void
  
  // 服务器状态管理
  setServerState: (id: string, state: MCPServerState) => void
  getServerState: (id: string) => MCPServerState | undefined
  
  // 选中服务器管理
  setSelectedServers: (ids: string[]) => void
  toggleServerSelection: (id: string) => void
  clearSelectedServers: () => void
  
  // 初始化
  initMcpData: () => Promise<void>
  loadMcpConfig: () => Promise<void>
}

export const useMcpStore = create<MCPState>((set, get) => ({
  enabled: false,
  servers: [],
  serverStates: new Map(),
  selectedServerIds: [],
  initialized: false,
  
  setEnabled: async (enabled: boolean) => {
    const store = await Store.load('store.json')
    await store.set('mcp.enabled', enabled)
    await store.save()
    set({ enabled })
  },
  
  addServer: async (server: MCPServerConfig) => {
    const store = await Store.load('store.json')
    const servers = [...get().servers, server]
    await store.set('mcp.servers', servers)
    await store.save()
    set({ servers })
  },
  
  updateServer: async (id: string, updates: Partial<MCPServerConfig>) => {
    const store = await Store.load('store.json')
    const servers = get().servers.map(s =>
      s.id === id ? { ...s, ...updates } : s
    )
    await store.set('mcp.servers', servers)
    await store.save()
    set({ servers })
  },
  
  deleteServer: async (id: string) => {
    const store = await Store.load('store.json')
    const servers = get().servers.filter(s => s.id !== id)
    await store.set('mcp.servers', servers)
    await store.save()
    
    // 同时清理状态和选中
    const serverStates = new Map(get().serverStates)
    serverStates.delete(id)
    const selectedServerIds = get().selectedServerIds.filter(sid => sid !== id)
    
    set({ servers, serverStates, selectedServerIds })
  },
  
  toggleServerEnabled: async (id: string) => {
    const store = await Store.load('store.json')
    const servers = get().servers.map(s =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    )
    await store.set('mcp.servers', servers)
    await store.save()
    set({ servers })
  },
  
  setServerState: (id: string, state: MCPServerState) => {
    const serverStates = new Map(get().serverStates)
    serverStates.set(id, state)
    set({ serverStates })
  },
  
  getServerState: (id: string) => {
    return get().serverStates.get(id)
  },
  
  setSelectedServers: async (ids: string[]) => {
    const store = await Store.load('store.json')
    await store.set('mcp.selectedServerIds', ids)
    await store.save()
    set({ selectedServerIds: ids })
  },
  
  toggleServerSelection: async (id: string) => {
    const selectedServerIds = get().selectedServerIds
    const newSelected = selectedServerIds.includes(id)
      ? selectedServerIds.filter(sid => sid !== id)
      : [...selectedServerIds, id]
    
    const store = await Store.load('store.json')
    await store.set('mcp.selectedServerIds', newSelected)
    await store.save()
    set({ selectedServerIds: newSelected })
  },
  
  clearSelectedServers: async () => {
    const store = await Store.load('store.json')
    await store.set('mcp.selectedServerIds', [])
    await store.save()
    set({ selectedServerIds: [] })
  },
  
  loadMcpConfig: async () => {
    try {
      const store = await Store.load('store.json')
      const enabled = await store.get<boolean>('mcp.enabled')
      const servers = await store.get<MCPServerConfig[]>('mcp.servers')
      const selectedServerIds = await store.get<string[]>('mcp.selectedServerIds')
      
      set({
        enabled: enabled ?? false,
        servers: servers ?? [],
        selectedServerIds: selectedServerIds ?? [],
      })
    } catch (error) {
      console.error('Failed to load MCP config:', error)
    }
  },
  
  initMcpData: async () => {
    // 如果已经初始化过，只加载配置不重新连接
    if (get().initialized) {
      await get().loadMcpConfig()
      return
    }
    
    try {
      const store = await Store.load('store.json')
      const enabled = await store.get<boolean>('mcp.enabled')
      const servers = await store.get<MCPServerConfig[]>('mcp.servers')
      const selectedServerIds = await store.get<string[]>('mcp.selectedServerIds')
      
      set({
        enabled: enabled ?? false,
        servers: servers ?? [],
        selectedServerIds: selectedServerIds ?? [],
        initialized: true,
      })
      
      // 如果 MCP 功能已启用，自动连接已启用的服务器
      if (enabled && servers && servers.length > 0) {
        const { mcpServerManager } = await import('@/lib/mcp/server-manager')
        
        // 延迟一点时间，确保页面完全加载
        setTimeout(async () => {
          for (const server of servers) {
            if (server.enabled) {
              try {
                await mcpServerManager.connectServer(server)
              } catch (error) {
                console.error(`Failed to auto-connect server ${server.name}:`, error)
              }
            }
          }
        }, 500)
      }
    } catch (error) {
      console.error('Failed to initialize MCP data:', error)
    }
  },
}))
