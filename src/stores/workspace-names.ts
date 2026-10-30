import { create } from 'zustand'

export const normalizeWorkspaceNamePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

interface WorkspaceNamesState {
  names: Record<string, string>
  setNames: (names: Record<string, string>) => void
}

export const useWorkspaceNamesStore = create<WorkspaceNamesState>((set) => ({
  names: {},
  setNames: (names) => set(state => (
    Object.keys(names).length === Object.keys(state.names).length
      && Object.entries(names).every(([path, name]) => state.names[path] === name)
      ? state : { names }
  )),
}))
