'use client'

import React, { createContext, useContext, ReactNode } from 'react'
import useSettingStore from '@/stores/setting'

interface TextSizeContextType {
  fileManagerTextSize: string
  recordTextSize: string
  getContextMenuTextSize: (type: 'file' | 'record') => string
  getIconSize: (textSize: string, type: 'file' | 'record') => string
}

const TextSizeContext = createContext<TextSizeContextType | undefined>(undefined)

export function useTextSize() {
  const context = useContext(TextSizeContext)
  if (!context) {
    throw new Error('useTextSize must be used within a TextSizeProvider')
  }
  return context
}

interface TextSizeProviderProps {
  children: ReactNode
}

export function TextSizeProvider({ children }: TextSizeProviderProps) {
  const { fileManagerTextSize, recordTextSize } = useSettingStore()

  const getContextMenuTextSize = (type: 'file' | 'record') => {
    return type === 'file' ? fileManagerTextSize : recordTextSize
  }

  const getIconSize = (textSize: string, type: 'file' | 'record') => {
    if (type === 'file') {
      const sizeMap = {
        'xs': 'size-3',
        'sm': 'size-3.5', 
        'md': 'size-4',
        'lg': 'size-5',
        'xl': 'size-6'
      }
      return sizeMap[textSize as keyof typeof sizeMap] || 'size-4'
    } else {
      const sizeMap = {
        'xs': 'size-2',
        'sm': 'size-2.5', 
        'md': 'size-3',
        'lg': 'size-3.5',
        'xl': 'size-4'
      }
      return sizeMap[textSize as keyof typeof sizeMap] || 'size-3'
    }
  }

  const value = {
    fileManagerTextSize,
    recordTextSize,
    getContextMenuTextSize,
    getIconSize
  }

  return (
    <TextSizeContext.Provider value={value}>
      {children}
    </TextSizeContext.Provider>
  )
}
