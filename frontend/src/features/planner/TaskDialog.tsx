import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, taskPriorityLabel, taskStatusLabel, taskTypeLabel, type StudyTask, type TaskInput } from './taskApi'

type Props = {
  task?: StudyTask
  busy: boolean
  error: string | null
  closing?: boolean
  onClose: () => void
  onSave: (task: TaskInput) => Promise<void>
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function TaskDialog({ task, busy, error, closing = false, onClose, onSave }: Props) {
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(task?.title ?? '')
  const [subject, setSubject] = useState(task?.subject ?? '')
  const [taskType, setTaskType] = useState(task?.task_type ?? 'assignment')
  const [dueDate, setDueDate] = useState(task?.due_date ?? dateInputValue(new Date()))
  const [minutes, setMinutes] = useState(task?.estimated_minutes ?? 60)
  const [priority, setPriority] = useState(task?.priority ?? 'normal')
  const [status, setStatus] = useState(task?.status ?? 'todo')
  const [scheduledStart, setScheduledStart] = useState(task?.scheduled_start_at?.slice(0, 16) ?? '')

  useEffect(() => {
    titleRef.current?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !closing) onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [busy, closing, onClose])

  function trapTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || closing) return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href]')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onSave({
      title: title.trim(),
      subject: subject.trim(),
      task_type: taskType,
      due_date: dueDate,
      estimated_minutes: minutes,
      priority,
      status,
      scheduled_start_at: scheduledStart ? `${scheduledStart}:00` : null,
    })
  }

  return (
    <div className={`dialog-backdrop ${closing ? 'dialog-exiting' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !closing) onClose() }}>
      <div className={`task-dialog ${closing ? 'dialog-panel-exiting' : ''}`} role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" ref={dialogRef} onKeyDown={trapTab}>
        <div className="dialog-heading">
          <div><span className="dialog-eyebrow">STUDY PLANNER</span><h2 id="task-dialog-title">{task ? 'Edit task' : 'Add a study task'}</h2><p>Keep the details that help you plan this work.</p></div>
          <button className="icon-button dialog-close" type="button" aria-label="Close task form" onClick={onClose} disabled={busy || closing}><X size={19} /></button>
        </div>
        <form onSubmit={submit} className="task-form">
          <label className="form-field form-field-wide">Task title<input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required placeholder="e.g. Complete Unit 2 assignment" /></label>
          <label className="form-field">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={120} required placeholder="Enter subject name" /></label>
          <label className="form-field">Task type<select value={taskType} onChange={(event) => setTaskType(event.target.value as typeof taskType)}>{TASK_TYPES.map((value) => <option key={value} value={value}>{taskTypeLabel[value]}</option>)}</select></label>
          <label className="form-field">Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label>
          <label className="form-field">Study time (minutes)<input type="number" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} min={1} max={1440} required /><small>Enter 1–1,440 minutes.</small></label>
          <label className="form-field">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>{TASK_PRIORITIES.map((value) => <option key={value} value={value}>{taskPriorityLabel[value]}</option>)}</select></label>
          <label className="form-field">Status<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{TASK_STATUSES.map((value) => <option key={value} value={value}>{taskStatusLabel[value]}</option>)}</select></label>
          <label className="form-field form-field-wide">Schedule a study session <span className="optional-label">Optional</span><input type="datetime-local" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} /><small>Overlap checks use this start time and your estimated study time.</small></label>
          {error && <p className="form-error form-field-wide" role="alert">{error}</p>}
          <div className="form-actions form-field-wide"><button className="secondary-button" type="button" onClick={onClose} disabled={busy || closing}>Cancel</button><button className="primary-button" type="submit" disabled={busy || closing}>{busy ? <><span className="button-spinner" /> Saving…</> : task ? 'Save changes' : 'Create task'}</button></div>
        </form>
      </div>
    </div>
  )
}
