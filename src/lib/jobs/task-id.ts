// The task center uses this namespace to keep job-managed retries and history linked to the scheduler.
export const JOB_TASK_PREFIX = 'job-step-'

export function isJobTaskId(id: string): boolean {
  return id.startsWith(JOB_TASK_PREFIX)
}
