import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, Check, Circle, Clock3, Pencil, Plus, Trash2 } from 'lucide-react'
import TaskDialog from './TaskDialog'
import { ApiError, formatDueDate, formatStudyTime, taskApi, taskPriorityLabel, taskStatusLabel, taskTypeLabel, type StudyTask, type TaskInput, type TaskStatus } from './taskApi'

type Props = { onNavigate: (path: string) => void; initialCreate?: boolean }

function explainError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 && typeof error.detail === 'object' && error.detail !== null && 'conflicts' in error.detail) {
      const conflicts = (error.detail as { conflicts: Array<{ title: string }> }).conflicts.map((item) => `“${item.title}”`).join(', ')
      return `${error.message} Conflicting session${conflicts.includes(',') ? 's' : ''}: ${conflicts}. Change the start time or duration.`
    }
    return error.message
  }
  return 'Something went wrong. Please try again.'
}

export default function PlannerPage({ onNavigate, initialCreate = false }: Props) {
  const [tasks, setTasks] = useState<StudyTask[]>([])
  const [filter, setFilter] = useState<'all' | TaskStatus>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogClosing, setDialogClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const [editingTask, setEditingTask] = useState<StudyTask | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<StudyTask | null>(null)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setTasks(await taskApi.list())
    } catch (error) {
      setLoadError(explainError(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadTasks() }, [loadTasks])
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }, [])
  useEffect(() => {
    if (initialCreate) {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      setDialogClosing(false)
      setEditingTask(undefined)
      setFormError(null)
      setDialogOpen(true)
    }
  }, [initialCreate])

  const visibleTasks = useMemo(() => {
    const filtered = filter === 'all' ? tasks : tasks.filter((task) => task.status === filter)
    return [...filtered].sort((a, b) => priorityScore(b) - priorityScore(a))
  }, [filter, tasks])
  const activeCount = tasks.filter((task) => task.status !== 'completed').length

  function openCreate() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    setDialogClosing(false)
    setEditingTask(undefined)
    setFormError(null)
    setDialogOpen(true)
  }

  function openEdit(task: StudyTask) {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    setDialogClosing(false)
    setEditingTask(task)
    setFormError(null)
    setDialogOpen(true)
  }

  function closeTaskDialog() {
    if (!dialogOpen || dialogClosing) return
    setDialogClosing(true)
    closeTimer.current = window.setTimeout(() => {
      setDialogOpen(false)
      setDialogClosing(false)
      closeTimer.current = null
    }, 160)
  }

  async function saveTask(input: TaskInput) {
    setBusy(true)
    setFormError(null)
    try {
      if (editingTask) {
        await taskApi.update(editingTask.id, input)
        setFeedback('Task updated.')
      } else {
        await taskApi.create(input)
        setFeedback('Task added to your planner.')
      }
      closeTaskDialog()
      await loadTasks()
    } catch (error) {
      setFormError(explainError(error))
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(task: StudyTask) {
    setFeedback(null)
    try {
      const nextStatus: TaskStatus = task.status === 'completed' ? 'todo' : 'completed'
      await taskApi.update(task.id, { status: nextStatus })
      setFeedback(nextStatus === 'completed' ? 'Task marked complete.' : 'Task reopened.')
      if (nextStatus === 'completed') {
        window.dispatchEvent(new CustomEvent('nexus:celebrate', { detail: { taskTitle: task.title } }))
      }
      await loadTasks()
    } catch (error) {
      setFeedback(explainError(error))
    }
  }

  async function deleteTask() {
    if (!pendingDelete) return
    setBusy(true)
    try {
      await taskApi.remove(pendingDelete.id)
      setFeedback('Task deleted.')
      setPendingDelete(null)
      await loadTasks()
    } catch (error) {
      setFeedback(explainError(error))
    } finally {
      setBusy(false)
    }
  }

  const completedCount = tasks.filter((task) => task.status === 'completed').length

  return (
    <div className="page-container planner-page">
      <div className="planner-header">
        <div><div className="eyebrow"><span className="eyebrow-line" /> A PLAN THAT WORKS FOR YOU</div><h1>Study planner</h1><p>Keep assignments, exams, lab work, and the smaller steps in one place.</p></div>
        <button className="primary-button add-task-button" onClick={openCreate}><Plus size={16} /> Add task</button>
      </div>

      <section className="planner-summary" aria-label="Task summary">
        <div><span className="summary-value">{tasks.length}</span><span className="summary-label">Total tasks</span></div>
        <div><span className="summary-value">{activeCount}</span><span className="summary-label">In progress or to do</span></div>
        <div><span className="summary-value">{completedCount}</span><span className="summary-label">Completed</span></div>
        <p>Counts reflect tasks saved to your workspace.</p>
      </section>

      <section className="planner-list-section" aria-labelledby="planner-list-title">
        <div className="planner-list-heading"><div><h2 id="planner-list-title">Your tasks</h2><p>Suggested order weighs due date, priority, status, and estimated study time.</p></div><label className="filter-control">Show<select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter tasks by status"><option value="all">All tasks</option><option value="todo">To do</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label></div>

        {feedback && <p className={`planner-feedback ${feedback.includes('Could not') || feedback.includes('overlaps') || feedback.includes('wrong') ? 'feedback-error' : ''}`} role="status">{feedback}</p>}
        {loading && <div className="planner-loading" role="status" aria-live="polite"><span className="button-spinner" /> Loading your saved tasks…</div>}
        {!loading && loadError && <div className="error-state" role="alert"><AlertTriangle size={19} /><div><strong>Couldn’t load the planner</strong><p>{loadError}</p><button className="secondary-button" onClick={() => void loadTasks()}>Try again</button></div></div>}
        {!loading && !loadError && visibleTasks.length === 0 && (
          <div className="planner-empty"><div className="empty-illustration planner-empty-icon"><CalendarDays size={22} /></div><h3>{tasks.length === 0 ? 'Your planner is ready for its first task' : 'No tasks match this filter'}</h3><p>{tasks.length === 0 ? 'Add an assignment, exam, lab record, or study session. Your tasks are saved to this workspace.' : 'Choose another status or add a new task.'}</p>{tasks.length === 0 ? <button className="primary-button" onClick={openCreate}><Plus size={15} /> Add your first task</button> : <button className="secondary-button" onClick={() => setFilter('all')}>Show all tasks</button>}</div>
        )}
        {!loading && !loadError && visibleTasks.length > 0 && (
          <div className="task-list" aria-live="polite">
            {visibleTasks.map((task) => <TaskCard key={task.id} task={task} onEdit={() => openEdit(task)} onDelete={() => setPendingDelete(task)} onToggleStatus={() => void changeStatus(task)} />)}
          </div>
        )}
      </section>

      <div className="planner-tip"><Clock3 size={16} /><span>Optional session times let the planner detect overlaps. Tasks without a scheduled start time remain deadline-based.</span></div>
      <p className="planner-footnote"><button className="inline-link" onClick={() => onNavigate('/dashboard')}>Return to dashboard</button><span> · </span>Academic templates and subject lists can be customized in a later milestone.</p>

      {dialogOpen && <TaskDialog task={editingTask} busy={busy} error={formError} closing={dialogClosing} onClose={closeTaskDialog} onSave={saveTask} />}
      {pendingDelete && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingDelete(null) }}><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setPendingDelete(null); if (event.key === 'Tab') { const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'); const first = buttons[0]; const last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } } }}><div className="delete-icon"><Trash2 size={18} /></div><h2 id="delete-title">Delete this task?</h2><p id="delete-description"><strong>{pendingDelete.title}</strong> will be permanently removed from your planner.</p><div className="form-actions"><button className="secondary-button" onClick={() => setPendingDelete(null)} disabled={busy} autoFocus>Keep task</button><button className="danger-button" onClick={() => void deleteTask()} disabled={busy}>{busy ? 'Deleting…' : 'Delete task'}</button></div></div></div>}
    </div>
  )
}

function TaskCard({ task, onEdit, onDelete, onToggleStatus }: { task: StudyTask; onEdit: () => void; onDelete: () => void; onToggleStatus: () => void }) {
  const overdue = task.status !== 'completed' && new Date(`${task.due_date}T23:59:59`) < new Date()
  const scheduledTime = task.scheduled_start_at ? new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(task.scheduled_start_at)) : null
  return (
    <article className={`task-card ${task.status === 'completed' ? 'task-completed' : ''}`}>
      <button className="task-check" onClick={onToggleStatus} aria-label={task.status === 'completed' ? `Reopen ${task.title}` : `Mark ${task.title} complete`} title={task.status === 'completed' ? 'Reopen task' : 'Mark complete'}>{task.status === 'completed' ? <Check size={15} /> : <Circle size={18} />}</button>
      <div className="task-main"><div className="task-title-row"><h3>{task.title}</h3><span className={`priority-badge priority-${task.priority}`}>{taskPriorityLabel[task.priority]}</span></div><p className="task-subject">{task.subject} <span>·</span> {taskTypeLabel[task.task_type]}</p><div className="task-meta"><span className={overdue ? 'due-overdue' : ''}><CalendarDays size={13} />{overdue ? 'Overdue · ' : 'Due '}{formatDueDate(task.due_date)}</span><span><Clock3 size={13} />{formatStudyTime(task.estimated_minutes)}</span>{scheduledTime && <span><CalendarDays size={13} />{scheduledTime}</span>}<span className={`status-badge status-${task.status}`}>{taskStatusLabel[task.status]}</span></div></div>
      <div className="task-actions"><button className="icon-button" aria-label={`Edit ${task.title}`} onClick={onEdit}><Pencil size={15} /></button><button className="icon-button delete-action" aria-label={`Delete ${task.title}`} onClick={onDelete}><Trash2 size={15} /></button></div>
    </article>
  )
}

function priorityScore(task: StudyTask): number {
  if (task.status === 'completed') return -1000
  const due = new Date(`${task.due_date}T23:59:59`).getTime()
  const daysRemaining = (due - Date.now()) / 86_400_000
  const urgency = daysRemaining < 0 ? 100 : daysRemaining <= 1 ? 80 : daysRemaining <= 3 ? 60 : daysRemaining <= 7 ? 40 : 20
  const importance = { urgent: 40, high: 30, normal: 20, low: 10 }[task.priority]
  const effort = Math.min(10, Math.ceil(task.estimated_minutes / 60))
  const progress = task.status === 'in_progress' ? 3 : 0
  return urgency + importance + effort + progress
}
