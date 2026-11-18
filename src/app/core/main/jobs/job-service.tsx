'use client'

import { useEffect } from 'react'
import { observeJobTasks } from '@/lib/jobs'

export function JobService() {
  useEffect(() => observeJobTasks(), [])
  return null
}
