export const TASK_TYPES = [
  'assignment',
  'internal_exam',
  'lab_record',
  'coding_practice',
  'project',
  'revision',
  'presentation',
  'practical_exam',
  'other',
] as const

export const TASK_STATUSES = ['todo', 'in_progress', 'completed'] as const
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export type TaskType = (typeof TASK_TYPES)[number]
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export type StudyTask = {
  id: number
  title: string
  subject: string
  task_type: TaskType
  due_date: string
  estimated_minutes: number
  priority: TaskPriority
  status: TaskStatus
  scheduled_start_at: string | null
  created_at: string
  updated_at: string
}

export type TaskInput = Omit<StudyTask, 'id' | 'created_at' | 'updated_at'>
export type TaskPatch = Partial<TaskInput>

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    const message = typeof detail === 'string'
      ? detail
      : typeof detail === 'object' && detail !== null && 'message' in detail
        ? String(detail.message)
        : 'The request could not be completed.'
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError(0, 'Could not reach the API. Check that the FastAPI server is running on port 8000.')
  }

  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = Array.isArray(body?.detail)
      ? body.detail.map((issue: { loc?: unknown[]; msg?: string }) => `${issue.loc?.slice(1).join('.') || 'Field'}: ${issue.msg ?? 'Invalid value.'}`).join(' ')
      : body?.detail ?? body?.message ?? response.statusText
    throw new ApiError(response.status, detail)
  }
  return body as T
}

export const taskApi = {
  list: () => request<StudyTask[]>('/api/tasks'),
  create: (task: TaskInput) => request<StudyTask>('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),
  update: (id: number, patch: TaskPatch) => request<StudyTask>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: number) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
}

export const taskTypeLabel: Record<TaskType, string> = {
  assignment: 'Assignment',
  internal_exam: 'Internal exam',
  lab_record: 'Lab record',
  coding_practice: 'Coding practice',
  project: 'Project',
  revision: 'Revision',
  presentation: 'Presentation',
  practical_exam: 'Practical exam',
  other: 'Other',
}

export const taskStatusLabel: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  completed: 'Completed',
}

export const taskPriorityLabel: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

export function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
}

export function formatStudyTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (!hours) return `${remainder} min`
  if (!remainder) return `${hours} hr`
  return `${hours} hr ${remainder} min`
}
