import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Check, Plus, Sparkles, Target, Upload, MessageSquareText, Flame, CornerDownLeft, BookOpen, BrainCircuit, FileText } from 'lucide-react'
import { ApiError, formatDueDate, formatStudyTime, taskApi, taskPriorityLabel, type StudyTask } from '../planner/taskApi'
import IntelligenceCore from './IntelligenceCore'

type Props = { onNavigate: (path: string) => void }
type DashboardNote = { id: number; title: string; subject: string; status: string; created_at: string }
type DashboardConversation = { id: number; title: string; updated_at: string }

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Could not load your workspace data.'
}

export default function DashboardPage({ onNavigate }: Props) {
  const commandInputRef = useRef<HTMLInputElement>(null)
  const [tasks, setTasks] = useState<StudyTask[]>([])
  const [studentName, setStudentName] = useState('')
  const [university, setUniversity] = useState('')
  const [studyHours, setStudyHours] = useState(0)
  const [examDates, setExamDates] = useState<Array<{ subject: string; date: string }>>([])
  const [recommendations, setRecommendations] = useState<Array<{action:string;subject:string;reason:string;priority:string}>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [command, setCommand] = useState('')
  const [recentNotes, setRecentNotes] = useState<DashboardNote[]>([])
  const [recentConversations, setRecentConversations] = useState<DashboardConversation[]>([])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const focusCommand = (event: KeyboardEvent) => {
      const target = event.target
      const editing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (event.key === '/' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        commandInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusCommand)
    return () => window.removeEventListener('keydown', focusCommand)
  }, [])

  function submitCommand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = command.trim()
    if (!prompt) return
    onNavigate(`/assistant?prompt=${encodeURIComponent(prompt)}`)
  }

  useEffect(() => {
    let active = true
    taskApi.list().then((data) => {
      if (active) setTasks(data)
    }).catch((reason: unknown) => {
      if (active) setError(messageFor(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/profile', { signal: controller.signal }).then((response) => response.ok ? response.json() : null).then((profile) => {
      if (profile) { setStudentName(profile.name || ''); setUniversity(profile.university || ''); setStudyHours(Number(profile.weekly_study_hours) || 0); setExamDates(Array.isArray(profile.exam_dates) ? profile.exam_dates : []) }
    }).catch(() => undefined)
    fetch('/api/recommendations', { signal: controller.signal }).then((response) => response.ok ? response.json() : null).then((data) => {
      if (Array.isArray(data?.items)) setRecommendations(data.items.slice(0, 3))
    }).catch(() => undefined)
    fetch('/api/notes', { signal: controller.signal }).then((response) => response.ok ? response.json() : []).then((notes) => {
      if (Array.isArray(notes)) setRecentNotes(notes.slice(0, 3))
    }).catch(() => undefined)
    fetch('/api/conversations', { signal: controller.signal }).then((response) => response.ok ? response.json() : []).then((conversations) => {
      if (Array.isArray(conversations)) setRecentConversations(conversations.slice(0, 3))
    }).catch(() => undefined)
    return () => controller.abort()
  }, [])

  const openTasks = useMemo(() => tasks.filter((task) => task.status !== 'completed'), [tasks])
  const completedCount = tasks.length - openTasks.length
  const completionRatio = tasks.length ? Math.round(completedCount / tasks.length * 100) : 0
  const today = now
  const localDate = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  const weekSessions = openTasks.filter((task) => {
    if (!task.scheduled_start_at) return false
    const scheduled = new Date(task.scheduled_start_at)
    return scheduled >= weekStart && scheduled < weekEnd
  }).sort((a, b) => (a.scheduled_start_at ?? '').localeCompare(b.scheduled_start_at ?? ''))
  const overdueTasks = openTasks.filter((task) => task.due_date < localDate).sort((a,b) => a.due_date.localeCompare(b.due_date))
  const upcomingTasks = [...openTasks].filter((task) => task.due_date >= localDate).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 4)
  const upcomingExams = examDates.filter((exam) => exam.date >= localDate).sort((a, b) => a.date.localeCompare(b.date))
  const dailyMinutes = Array.from({length:7}, (_,index) => {
    const day = new Date(weekStart); day.setDate(day.getDate()+index)
    return weekSessions.filter((task) => new Date(task.scheduled_start_at as string).getDay() === day.getDay()).reduce((sum, task) => sum + task.estimated_minutes, 0)
  })
  const weekScheduledMinutes = dailyMinutes.reduce((sum, value) => sum + value, 0)
  const contextSummary = loading ? 'Loading your saved study plan.' : error ? 'Your saved academic details are temporarily unavailable.' : openTasks.length
    ? `${openTasks.length} active ${openTasks.length === 1 ? 'task' : 'tasks'}${overdueTasks.length ? ` · ${overdueTasks.length} overdue` : ''}${upcomingTasks[0] ? ` · next due ${formatDueDate(upcomingTasks[0].due_date)}` : ''}`
    : 'A clear slate. Add a task or exam date when you are ready.'
  const timeline = [
    ...upcomingTasks.map((task) => ({ key: `task-${task.id}`, date: task.due_date, title: task.title, detail: `${task.subject} · ${taskPriorityLabel[task.priority]} priority`, kind: 'Task', href: '#/planner', priority: task.priority })),
    ...upcomingExams.map((exam) => ({ key: `exam-${exam.subject}-${exam.date}`, date: exam.date, title: `${exam.subject} exam`, detail: 'Configured exam date', kind: 'Exam', href: '#/settings', priority: 'high' })),
    ...weekSessions.filter((task) => new Date(task.scheduled_start_at as string) >= now).map((task) => ({ key: `session-${task.id}`, date: task.scheduled_start_at as string, title: task.title, detail: `${task.subject} · ${formatStudyTime(task.estimated_minutes)}`, kind: 'Study session', href: '#/planner', priority: task.priority })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6)

  return (
    <div className="page-container dashboard-page">
      <section className="welcome-row editorial-hero" aria-labelledby="welcome-heading">
        <div className="hero-copy"><div className="brand-wordmark"><span className="brand-seal">C</span> CAMPUSLY <span className="hero-edition">YOUR STUDY COMPANION</span></div><p className="hero-greeting">Good to see you{studentName ? `, ${studentName.split(' ')[0]}` : ''} <span>— {new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(now)}</span></p><h1 id="welcome-heading">Make room for<br/><em>better learning.</em></h1><p className="welcome-copy">A calmer way to move through your semester.<br/><span>{contextSummary}</span></p>
          <form className="command-surface" onSubmit={submitCommand}><Sparkles size={18}/><input ref={commandInputRef} aria-label="Ask Campusly" aria-describedby="campusly-command-shortcut" value={command} onChange={(event)=>setCommand(event.target.value)} placeholder="Ask Campusly to plan, explain, or find…"/><button className="command-submit" type="submit" disabled={!command.trim()} aria-label="Send to study assistant"><CornerDownLeft size={17}/></button><small id="campusly-command-shortcut"><kbd>/</kbd> <span>FOCUS</span></small></form>
          <div className="command-prompts"><button type="button" onClick={()=>setCommand('Plan my study week')}><CalendarDays size={13}/> Plan my week</button><button type="button" onClick={()=>setCommand('Explain a difficult concept step by step')}><BrainCircuit size={13}/> Explain a concept</button><button type="button" onClick={()=>setCommand('Find this in my notes')}><BookOpen size={13}/> Search my notes</button></div>
          <div className="dashboard-quick-actions"><button className="primary-button" onClick={() => onNavigate('/assistant')}><MessageSquareText size={15}/> Start with AI</button><button className="secondary-button" onClick={() => onNavigate('/planner?create=1')}><Plus size={15}/> New task</button><button className="secondary-button" onClick={() => onNavigate('/sources')}><Upload size={15}/> Study sources</button></div>
          <button className="hero-scroll-cue" type="button" onClick={() => { const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; document.getElementById('semester-landscape')?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }) }}>Explore your study space <span><ArrowRight size={14}/></span></button></div>
        <div className="dashboard-orb" aria-hidden="true"><IntelligenceCore state="idle" /></div>
      </section>

      {error && <div className="dashboard-api-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => window.location.reload()}>Reload dashboard</button></div>}
      <section className="feature-story" aria-labelledby="feature-story-title">
        <div className="feature-story-heading"><div><span className="section-index">A CONNECTED STUDY SPACE</span><h2 id="feature-story-title">Everything you need to find your rhythm.</h2><p>Your saved work, course material, and study context come together here.</p></div><span className="feature-story-index">01 <i/> 05</span></div>
        <div className="feature-story-grid">
          <a className="feature-story-card feature-story-ai" href="#/assistant"><span className="feature-story-icon"><BrainCircuit size={18}/></span><span className="feature-story-kicker">AI ASSISTANT</span><h3>{recentConversations[0]?.title ?? 'Think through your next question.'}</h3><span className="feature-story-detail">Ask Campusly a question and continue saved conversations.</span><span className="feature-story-foot"><span>{recentConversations.length ? `${recentConversations.length} recent conversation${recentConversations.length === 1 ? '' : 's'}` : 'Ready when you are'}</span><ArrowRight size={15}/></span><i className="story-orbit story-orbit-one"/><i className="story-orbit story-orbit-two"/></a>
          <a className="feature-story-card feature-story-planner" href="#/planner"><span className="feature-story-icon"><CalendarDays size={18}/></span><span className="feature-story-kicker">SMART STUDY PLANNER</span><h3>{loading ? 'Finding your focus.' : `${openTasks.length} ${openTasks.length === 1 ? 'task' : 'tasks'} in motion.`}</h3><span className="feature-story-detail">Your deadlines and scheduled study sessions, in one clear view.</span><span className="story-progress-track"><i style={{ width: `${loading ? 0 : completionRatio}%` }}/></span><span className="feature-story-foot"><span>{tasks.length ? `${completionRatio}% complete` : 'Build your first study plan'}</span><ArrowRight size={15}/></span></a>
          <a className="feature-story-card feature-story-notes" href="#/sources"><span className="feature-story-icon"><BookOpen size={18}/></span><span className="feature-story-kicker">NOTES FINDER</span><h3>{recentNotes[0]?.title ?? 'Your course material, close at hand.'}</h3><span className="feature-story-detail">Search and work from the PDFs, DOCX files, and notes you upload.</span><span className="feature-story-foot"><span>{recentNotes.length ? `${recentNotes.length} recent source${recentNotes.length === 1 ? '' : 's'} · ${recentNotes[0].status.replace('_', ' ')}` : 'Add a study source'}</span><ArrowRight size={15}/></span></a>
          <a className="feature-story-card feature-story-recommendations" href="#/recommendations"><span className="feature-story-icon"><Sparkles size={18}/></span><span className="feature-story-kicker">RECOMMENDATIONS</span><h3>{recommendations[0]?.action ?? 'A next step that fits your semester.'}</h3><span className="feature-story-detail">Suggestions are grounded in the tasks and exam dates you have saved.</span><span className="feature-story-foot"><span>{recommendations[0]?.subject ?? 'Based on your workspace'}</span><ArrowRight size={15}/></span></a>
          <a className="feature-story-card feature-story-profile" href="#/profile"><span className="feature-story-icon"><Target size={18}/></span><span className="feature-story-kicker">STUDENT PROFILE</span><h3>{studentName || 'Your study profile'}</h3><span className="feature-story-detail">{studyHours ? `${studyHours} study hours per week` : 'Set your weekly study availability'}{examDates.length ? ` · ${examDates.length} saved exam date${examDates.length === 1 ? '' : 's'}` : ' · Add exam dates in academic settings'}</span><span className="feature-story-foot"><span>{university || 'Profile details and academic progress'}</span><ArrowRight size={15}/></span></a>
        </div>
      </section>

      <div className="editorial-section-heading" id="semester-landscape"><div><span className="section-index">01 / THE SEMESTER</span><h2>Your academic landscape</h2><p>Built from the work, sessions, and dates you’ve saved.</p></div><a className="section-link" href="#/planner">Open planner <ArrowRight size={14}/></a></div>

      <section className="intelligence-overview" aria-label="Intelligence overview" aria-busy={loading}>
        <article className="overview-active"><span className="metric-kicker"><Target size={14}/> ACTIVE WORKLOAD</span><strong>{loading ? '—' : error ? '—' : openTasks.length.toString().padStart(2,'0')}</strong><p>tasks in motion</p><span className="metric-footnote">{openTasks.filter((task)=>task.status==='in_progress').length} currently in progress</span></article>
        <article className="overview-completion"><span className="metric-kicker"><Check size={14}/> MOMENTUM</span><div className="completion-dial" style={{'--completion': `${loading || error ? 0 : completionRatio}%`} as React.CSSProperties}><strong>{loading || error || !tasks.length ? '—' : `${completionRatio}%`}</strong></div><p>{tasks.length ? `${completedCount} of ${tasks.length} tasks completed` : 'Completion appears as you add tasks'}</p></article>
        <article className="overview-deadline"><span className="metric-kicker"><CalendarDays size={14}/> NEXT DEADLINE</span>{loading || error ? <strong className="deadline-empty">—</strong> : (() => { const task = upcomingTasks[0]; const exam = upcomingExams[0]; const showExam = exam && (!task || exam.date <= task.due_date); return showExam ? <><strong>{formatDueDate(exam.date)}</strong><p>{exam.subject} · exam</p><span className="priority-badge priority-high">Examination</span></> : task ? <><strong>{formatDueDate(task.due_date)}</strong><p>{task.title}</p><span className={`priority-badge priority-${task.priority}`}>{taskPriorityLabel[task.priority]}</span></> : <><strong className="deadline-empty">Clear horizon</strong><p>No upcoming deadlines saved.</p></> })()}</article>
      </section>

      {overdueTasks.length > 0 && <section className="overdue-strip"><div><Flame size={16}/><strong>{overdueTasks.length} overdue {overdueTasks.length === 1 ? 'task' : 'tasks'}</strong><span>Bring these back into focus.</span></div><a className="section-link" href="#/planner">Review <ArrowRight size={14}/></a></section>}

      <section className="timeline-section" aria-labelledby="timeline-title">
        <div className="editorial-section-heading"><div><span className="section-index">02 / WHAT’S AHEAD</span><h2 id="timeline-title">Study timeline</h2><p>Upcoming work from your planner and configured exam dates.</p></div><a className="section-link" href="#/planner">View calendar <ArrowRight size={14}/></a></div>
        {loading ? <LoadingState label="Loading your timeline…" /> : error ? null : timeline.length ? <ol className="study-timeline">{timeline.map((item) => <li className={`timeline-item timeline-${item.kind.toLowerCase().replace(' ','-')}`} key={item.key}><span className={`timeline-marker priority-${item.priority}`}/><time dateTime={item.date}>{new Date(item.date).toLocaleDateString(undefined,{month:'short',day:'numeric'})}{item.kind === 'Study session' && <small>{new Date(item.date).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</small>}</time><div><span className="timeline-kind">{item.kind}</span><a href={item.href}><strong>{item.title}</strong><small>{item.detail}</small></a></div><ArrowRight className="timeline-arrow" size={15}/></li>)}</ol> : <EmptyTaskState onNavigate={onNavigate} />}
      </section>

      <div className="editorial-section-heading"><div><span className="section-index">03 / A STEADY RHYTHM</span><h2>Make your week yours</h2><p>Only scheduled sessions appear in this view.</p></div></div>
      <section className="dashboard-insights-grid">
        <article className="week-card progress-card"><div className="bottom-card-heading"><div><span className="next-label">WEEKLY STUDY PLAN</span><h2>Your scheduled study time</h2><p>Built from the sessions you added to your planner.</p></div><span className="milestone-label">{formatStudyTime(weekScheduledMinutes)} PLANNED</span></div>
          <div className="weekly-chart" aria-label={`Scheduled study time this week: ${formatStudyTime(weekScheduledMinutes)}`}>{dailyMinutes.map((minutes,index)=>{const date=new Date(weekStart);date.setDate(date.getDate()+index);const daySessions=weekSessions.filter((task)=>new Date(task.scheduled_start_at as string).getDay()===date.getDay());const dayName=new Intl.DateTimeFormat(undefined,{weekday:'long'}).format(date);const height=minutes?Math.max(10,Math.min(100,minutes/Math.max(30,studyHours*60/7||60)*100)):4;return <div className="weekly-day" key={index} tabIndex={0} role="group" aria-label={`${dayName}: ${formatStudyTime(minutes)} scheduled across ${daySessions.length} session${daySessions.length===1?'':'s'}`} title={daySessions.length ? `${dayName}: ${daySessions.map((task)=>task.title).join(', ')} · ${formatStudyTime(minutes)}` : `${dayName}: no scheduled sessions`}><div className="weekly-bar-track"><span className={minutes?'weekly-bar-filled':'weekly-bar-empty'} style={{height:`${height}%`}}/></div><span>{new Intl.DateTimeFormat(undefined,{weekday:'short'}).format(date)}</span>{minutes>0&&<small>{formatStudyTime(minutes)}</small>}</div>})}</div>
          <p className="chart-caption">{weekScheduledMinutes === 0 ? 'No study sessions scheduled for this week yet. ' : ''}{studyHours ? `${studyHours} study hours/week set in your profile` : 'Set your weekly availability in Academic settings to personalize this view.'}</p>
        </article>
        <article className="next-card next-move"><div className="next-top"><div className="next-icon"><Sparkles size={17} /></div><div><span className="next-label">YOUR NEXT MOVE</span><h2>What should I focus on next?</h2></div></div>
          {recommendations.length ? <><p className="next-move-action">{recommendations[0].action}</p><p className="next-move-reason">{recommendations[0].subject} · {recommendations[0].reason}</p><a className="primary-button" href="#/recommendations">See why this matters <ArrowRight size={14}/></a></> : upcomingTasks[0] ? <><p className="next-move-action">Continue with {upcomingTasks[0].title}</p><p className="next-move-reason">It is your closest saved deadline, due {formatDueDate(upcomingTasks[0].due_date)}.</p><a className="primary-button" href="#/planner">Open this task <ArrowRight size={14}/></a></> : <><p className="next-move-action">Set your first study priority.</p><p className="next-move-reason">Add a task or exam date and Campusly can use it to suggest a grounded next step.</p><a className="primary-button" href="#/planner">Open study planner <ArrowRight size={14}/></a></>}
        </article>
      </section>
      <section className="recent-notes" aria-labelledby="recent-notes-title"><div className="editorial-section-heading"><div><span className="section-index">04 / YOUR LIBRARY</span><h2 id="recent-notes-title">Recently added study sources</h2><p>Your uploaded course material, ready when you need it.</p></div><a className="section-link" href="#/sources">Explore sources <ArrowRight size={14}/></a></div>{recentNotes.length ? <div className="recent-note-list">{recentNotes.map((note) => <a href="#/sources" className="recent-note" key={note.id}><FileText size={18}/><span><strong>{note.title}</strong><small>{note.subject} · {note.status.replace('_',' ')}</small></span><time>{new Date(note.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time><ArrowRight size={15}/></a>)}</div> : <div className="notes-empty-inline"><p>Uploaded PDFs, DOCX files, and text notes appear here after you add them.</p><a className="secondary-button" href="#/sources"><Upload size={14}/> Explore sources</a></div>}</section>
      <section className="recent-conversations" aria-labelledby="recent-conversations-title"><div className="editorial-section-heading"><div><span className="section-index">05 / YOUR AI ASSISTANT</span><h2 id="recent-conversations-title">Recent conversations</h2><p>Continue a saved study conversation with its message history.</p></div><a className="section-link" href="#/assistant">Open assistant <ArrowRight size={14}/></a></div>{recentConversations.length ? <div className="recent-note-list">{recentConversations.map((conversation) => <a href={`#/assistant?conversation=${conversation.id}`} className="recent-note" key={conversation.id}><MessageSquareText size={18}/><span><strong>{conversation.title}</strong><small>Saved conversation · continue where you left off</small></span><time>{new Date(conversation.updated_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time><ArrowRight size={15}/></a>)}</div> : <div className="notes-empty-inline"><p>Your saved conversations will appear here after your first AI chat.</p><a className="secondary-button" href="#/assistant"><MessageSquareText size={14}/> Start a conversation</a></div>}</section>
      <footer className="page-footer"><span>Made for your next chapter <span className="footer-heart">✳</span></span><span>Academic templates are customizable · Sample curricula are not official university data</span></footer>
    </div>
  )
}

function EmptyTaskState({ onNavigate }: Props) {
  return <div className="dashboard-empty"><div className="empty-illustration focus-illustration"><Plus size={22} /></div><h3>Your semester starts with one task</h3><p>Add an assignment, exam, lab record, or study session. The dashboard will use only the details you save.</p><button className="primary-button" onClick={() => onNavigate('/planner')}><Plus size={15} /> Create your first task</button></div>
}

function LoadingState({ label }: { label: string }) {
  return <div className="dashboard-loading" role="status"><span className="button-spinner" />{label}</div>
}
