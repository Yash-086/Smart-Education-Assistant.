import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowUpRight, BookOpen, CalendarDays, Check, ChevronDown, CircleHelp, Focus, MessageCircle, RotateCcw, Send, Sparkles, X } from 'lucide-react'

type NexusState = 'idle' | 'greeting' | 'thinking' | 'listening' | 'responding' | 'encouraging' | 'focus' | 'happy' | 'celebrating' | 'resting' | 'error'
type Citation = { document_id: number; document_name: string; page_number: number | null; excerpt?: string }
type NexusMessage = { id: number; role: 'user' | 'assistant'; content: string; citations?: Citation[]; web_citations?: { title: string; url: string }[] }
type Task = { id: number; title: string; subject: string; status: string; due_date: string; scheduled_start_at?: string | null }
type Note = { id: number; title: string; subject: string; status: string }
type Recommendation = { action: string; subject: string; reason: string; priority: string }
type Snapshot = { tasks: Task[]; notes: Note[]; recommendations: Recommendation[]; name: string; configured: boolean }

const companionStorageKey = 'nexus-conversation-id'

function savedConversationId(): number | null {
  try {
    const value = Number(window.localStorage.getItem(companionStorageKey))
    return Number.isInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  } catch {
    throw new Error('Could not reach the study workspace. Check that the FastAPI server is running, then try again.')
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : `The request failed (${response.status}).`
    throw new Error(detail)
  }
  return body as T
}

function readLocalName(): string {
  try {
    return window.localStorage.getItem('campusly-profile-name')?.trim() || 'your study space'
  } catch {
    return 'your study space'
  }
}

function robotMessage(state: NexusState, name: string) {
  switch (state) {
    case 'greeting': return `Hi ${name}. Ready when you are.`
    case 'thinking': return 'Let me think that through…'
    case 'listening': return 'I’m listening.'
    case 'responding': return 'Here’s what I found.'
    case 'encouraging': return 'One step at a time. We can make this manageable.'
    case 'focus': return 'Focus mode is on. Let’s keep it simple.'
    case 'happy': return 'Glad we made progress together.'
    case 'celebrating': return 'That task is complete. Nice work.'
    case 'resting': return 'I’ll be right here when you need me.'
    case 'error': return 'I hit a snag. Your message is still here to retry.'
    default: return 'Ask about your plan, notes, or what to study next.'
  }
}

function RobotFace({ state, small = false }: { state: NexusState; small?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <span className={`nexus-robot ${small ? 'nexus-robot-small' : ''} state-${state}`} aria-hidden="true">
      <span className="nexus-robot-aura" />
      <span className="nexus-orbit nexus-orbit-one" />
      <span className="nexus-orbit nexus-orbit-two" />
      <svg className="nexus-robot-shell" viewBox="0 0 112 112" fill="none">
        <defs>
          <linearGradient id={`nexus-shell-${id}`} x1="22" y1="18" x2="93" y2="101" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset=".48" stopColor="#dce4f2"/><stop offset="1" stopColor="#8999b3"/></linearGradient>
          <linearGradient id={`nexus-face-${id}`} x1="31" y1="34" x2="83" y2="78" gradientUnits="userSpaceOnUse"><stop stopColor="#15233d"/><stop offset="1" stopColor="#0c1226"/></linearGradient>
          <linearGradient id={`nexus-eye-${id}`} x1="38" y1="49" x2="76" y2="67" gradientUnits="userSpaceOnUse"><stop stopColor="#77f6ff"/><stop offset="1" stopColor="#b08aff"/></linearGradient>
          <filter id={`nexus-glow-${id}`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <path d="M55.8 11c4.6 0 8.3 3.7 8.3 8.3v5.2h-5v-5.2a3.3 3.3 0 0 0-6.6 0v5.2h-5v-5.2c0-4.6 3.7-8.3 8.3-8.3Z" fill={`url(#nexus-shell-${id})`}/>
        <circle cx="55.8" cy="13" r="3.1" fill="#a68bff" filter={`url(#nexus-glow-${id})`}/>
        <path d="M23 47c0-15.5 12.6-28 28-28h9.6c15.5 0 28 12.5 28 28v29c0 12.7-10.3 23-23 23H46c-12.7 0-23-10.3-23-23V47Z" fill={`url(#nexus-shell-${id})`} stroke="#fff" strokeOpacity=".72" strokeWidth="1.5"/>
        <path d="M28.6 48.3c0-12.3 10-22.3 22.3-22.3h9.8C73 26 83 36 83 48.3v24.4c0 10-8.1 18.1-18.1 18.1H46.7c-10 0-18.1-8.1-18.1-18.1V48.3Z" fill={`url(#nexus-face-${id})`} stroke="#bfeaff" strokeOpacity=".7"/>
        <path className="nexus-eyes" d="M40 56.5c0-3.1 2.5-5.7 5.7-5.7s5.7 2.6 5.7 5.7v1.7c0 3.1-2.6 5.7-5.7 5.7S40 61.3 40 58.2v-1.7Zm20.2 0c0-3.1 2.6-5.7 5.7-5.7s5.7 2.6 5.7 5.7v1.7c0 3.1-2.6 5.7-5.7 5.7s-5.7-2.6-5.7-5.7v-1.7Z" fill={`url(#nexus-eye-${id})`} filter={`url(#nexus-glow-${id})`}/>
        <path className="nexus-smile" d="M49 74c3.8 3.5 9.6 3.5 13.4 0" stroke="#8aeefa" strokeWidth="2.6" strokeLinecap="round"/>
        <path d="M17 54h6v13h-6a6.5 6.5 0 0 1-6.5-6.5A6.5 6.5 0 0 1 17 54Zm72 0h6a6.5 6.5 0 0 1 6.5 6.5A6.5 6.5 0 0 1 95 67h-6V54Z" fill={`url(#nexus-shell-${id})`}/>
        <path d="M43 97v4m25-4v4" stroke="#99efff" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <span className="nexus-state-spark" />
    </span>
  )
}

export default function NexusCompanion({ studentName }: { studentName: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [state, setState] = useState<NexusState>('greeting')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const [conversationId, setConversationId] = useState<number | null>(savedConversationId)
  const [messages, setMessages] = useState<NexusMessage[]>([])
  const [loadedConversation, setLoadedConversation] = useState<number | null>(null)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot>({ tasks: [], notes: [], recommendations: [], name: studentName || readLocalName(), configured: false })
  const [contextReady, setContextReady] = useState(false)
  const [contextError, setContextError] = useState('')
  const messageListRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const transitionTimer = useRef<number | null>(null)
  const hasGreeted = useRef(false)
  const launcherRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setState((current) => current === 'greeting' ? 'idle' : current), 2400)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!isOpen || contextReady) return
    let live = true
    Promise.allSettled([
      request<Task[]>('/api/tasks'),
      request<Note[]>('/api/notes'),
      request<{ items: Recommendation[] }>('/api/recommendations'),
      request<{ name?: string }>('/api/profile'),
      request<{ configured: boolean }>('/api/assistant/status'),
    ]).then((results) => {
      if (!live) return
      const [tasks, notes, recommendations, profile, assistant] = results
      setSnapshot({
        tasks: tasks.status === 'fulfilled' ? tasks.value : [],
        notes: notes.status === 'fulfilled' ? notes.value : [],
        recommendations: recommendations.status === 'fulfilled' ? recommendations.value.items : [],
        name: profile.status === 'fulfilled' && profile.value.name?.trim() ? profile.value.name.trim() : (studentName || readLocalName()),
        configured: assistant.status === 'fulfilled' ? assistant.value.configured : false,
      })
      const failed = results.filter((result) => result.status === 'rejected')
      if (failed.length === results.length) setContextError('Workspace data is unavailable right now.')
      else if (assistant.status === 'rejected') setContextError('Assistant status could not be checked. You can still try a message.')
      setContextReady(true)
    })
    return () => { live = false }
  }, [isOpen, contextReady, studentName])

  useEffect(() => {
    if (!isOpen || !conversationId || loadedConversation === conversationId) {
      if (isOpen && !conversationId) setConversationLoading(false)
      return
    }
    let live = true
    setConversationLoading(true)
    request<{ messages: NexusMessage[] }>(`/api/conversations/${conversationId}`)
      .then((result) => {
        if (live) {
          setMessages(result.messages)
          setLoadedConversation(conversationId)
        }
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : 'This conversation could not be restored.')
      })
      .finally(() => { if (live) setConversationLoading(false) })
    return () => { live = false }
  }, [isOpen, conversationId, loadedConversation])

  useEffect(() => {
    const element = messageListRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, busy, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        setState('resting')
        launcherRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  useEffect(() => {
    const launcher = launcherRef.current
    const finePointer = typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!launcher || !finePointer || reducedMotion) return
    let frame = 0
    let x = 0
    let y = 0
    const applyLook = () => {
      frame = 0
      const rect = launcher.getBoundingClientRect()
      const lookX = ((x - rect.left) / rect.width - .5) * 2.4
      const lookY = ((y - rect.top) / rect.height - .5) * 2.4
      launcher.style.setProperty('--nexus-look-x', `${lookX.toFixed(2)}px`)
      launcher.style.setProperty('--nexus-look-y', `${lookY.toFixed(2)}px`)
    }
    const onPointerMove = (event: PointerEvent) => {
      x = event.clientX
      y = event.clientY
      if (!frame) frame = window.requestAnimationFrame(applyLook)
    }
    const resetLook = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      launcher.style.removeProperty('--nexus-look-x')
      launcher.style.removeProperty('--nexus-look-y')
    }
    launcher.addEventListener('pointermove', onPointerMove, { passive: true })
    launcher.addEventListener('pointerleave', resetLook)
    return () => {
      launcher.removeEventListener('pointermove', onPointerMove)
      launcher.removeEventListener('pointerleave', resetLook)
      resetLook()
    }
  }, [isOpen])

  useEffect(() => {
    const celebrate = (event: Event) => {
      const taskTitle = (event as CustomEvent<{ taskTitle?: string }>).detail?.taskTitle
      setState('celebrating')
      setIsOpen(true)
      setError('')
      setContextReady(false)
      if (taskTitle) setAnnouncement(`Completed: ${taskTitle}`)
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current)
      transitionTimer.current = window.setTimeout(() => setState((current) => current === 'celebrating' ? (focusMode ? 'focus' : 'happy') : current), 2700)
    }
    window.addEventListener('nexus:celebrate', celebrate)
    return () => window.removeEventListener('nexus:celebrate', celebrate)
  }, [focusMode])

  useEffect(() => () => { if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current) }, [])

  function setTimedState(next: NexusState, duration = 2100, fallback: NexusState = 'idle') {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current)
    setState(next)
    transitionTimer.current = window.setTimeout(() => setState((current) => current === next ? fallback : current), duration)
  }

  function openPanel() {
    if (isOpen) {
      setIsOpen(false)
      setState('resting')
      return
    }
    setIsOpen(true)
    setError('')
    if (!hasGreeted.current) {
      setTimedState('greeting', 2600)
      hasGreeted.current = true
    } else setState(focusMode ? 'focus' : 'idle')
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const question = input.trim()
    if (!question || busy || conversationLoading) return
    setBusy(true)
    setError('')
    setAnnouncement('')
    setState('thinking')
    const userMessageId = Date.now()
    setMessages((current) => [...current, { id: userMessageId, role: 'user', content: question }])
    try {
      const response = await request<{ conversation_id: number; answer: string; citations: Citation[]; web_citations?: { title: string; url: string }[] }>('/api/assistant/ask', {
        method: 'POST',
        body: JSON.stringify({ question, conversation_id: conversationId, companion_mode: true }),
      })
      if (!response || !Number.isInteger(response.conversation_id) || typeof response.answer !== 'string' || !response.answer.trim()) {
        throw new Error('The assistant returned an incomplete response. Your message was not saved as an answer; please try again.')
      }
      setConversationId(response.conversation_id)
      try { window.localStorage.setItem(companionStorageKey, String(response.conversation_id)) } catch { /* Conversation still persists in the backend. */ }
      setLoadedConversation(response.conversation_id)
      setMessages((current) => [...current, { id: Date.now() + 1, role: 'assistant', content: response.answer, citations: response.citations ?? [], web_citations: response.web_citations ?? [] }])
      setInput('')
      const supportive = /\b(overwhelmed|overwhelm|stressed|anxious|can't|cannot|too much|burnt out|burned out)\b/i.test(question)
      if (supportive) {
        if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current)
        setState('encouraging')
        transitionTimer.current = window.setTimeout(() => {
          setState('responding')
          transitionTimer.current = window.setTimeout(() => setState(focusMode ? 'focus' : 'happy'), 1300)
        }, 1000)
      } else setTimedState('responding', 1500, focusMode ? 'focus' : 'happy')
    } catch (reason) {
      setMessages((current) => current.filter((message) => message.id !== userMessageId))
      setError(reason instanceof Error ? reason.message : 'NEXUS could not respond. Please try again.')
      setState('error')
    } finally {
      setBusy(false)
    }
  }

  function startNewConversation() {
    if (busy) return
    setConversationId(null)
    setLoadedConversation(null)
    setMessages([])
    setError('')
    setAnnouncement('')
    try { window.localStorage.removeItem(companionStorageKey) } catch { /* Starting a new session still works without storage. */ }
    setState('greeting')
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const activeTasks = snapshot.tasks.filter((task) => task.status !== 'completed')
  const scheduled = snapshot.tasks.filter((task) => task.scheduled_start_at)
  const currentName = snapshot.name || studentName || readLocalName()

  return (
    <div className={`nexus-widget ${isOpen ? 'nexus-open' : ''}`}>
      {isOpen && <section className="nexus-panel" aria-label="NEXUS study companion" aria-busy={busy}>
        <header className="nexus-panel-head">
          <div className="nexus-panel-identity"><RobotFace state={state} small/><div><strong>NEXUS</strong><span><i className={snapshot.configured ? 'nexus-status-ready' : 'nexus-status-away'} />{snapshot.configured ? 'Study companion' : 'Assistant unavailable'}</span></div></div>
          <div className="nexus-panel-actions">
            <button type="button" className={`nexus-icon-action ${focusMode ? 'is-active' : ''}`} aria-label={focusMode ? 'Turn off focus mode' : 'Turn on focus mode'} title={focusMode ? 'Turn off focus mode' : 'Focus mode'} disabled={busy} onClick={() => { setFocusMode((value) => !value); setState(focusMode ? 'idle' : 'focus') }}><Focus size={16}/></button>
            <button type="button" className="nexus-icon-action" aria-label="Start new conversation" title="New conversation" onClick={startNewConversation}><RotateCcw size={15}/></button>
            <button type="button" className="nexus-icon-action" aria-label="Close NEXUS" onClick={openPanel}><X size={17}/></button>
          </div>
        </header>
        <div className="nexus-context-strip" aria-label="Study context">
          <span><CalendarDays size={13}/>{activeTasks.length} open task{activeTasks.length === 1 ? '' : 's'}</span>
          <span><BookOpen size={13}/>{snapshot.notes.length} note{snapshot.notes.length === 1 ? '' : 's'}</span>
          {scheduled.length > 0 && <span><Check size={13}/>{scheduled.length} scheduled</span>}
        </div>
        {contextError && <p className="nexus-context-note" role="status">{contextError}</p>}
        <div className="nexus-chat-log" ref={messageListRef} aria-live="polite">
          {messages.length === 0 && <div className="nexus-welcome"><span className="nexus-welcome-icon"><Sparkles size={17}/></span><h2>Hi {currentName.split(' ')[0]}.</h2><p>{robotMessage(state, currentName.split(' ')[0])}</p><div className="nexus-suggestions"><button type="button" onClick={() => { setInput('What should I focus on next?'); inputRef.current?.focus(); setState('listening') }}>What should I focus on?</button><button type="button" onClick={() => { setInput('Help me break down my next task.'); inputRef.current?.focus(); setState('listening') }}>Break down a task</button>{snapshot.notes.length > 0 && <button type="button" onClick={() => { setInput('Help me study from my notes.'); inputRef.current?.focus(); setState('listening') }}>Study from my notes</button>}</div>{snapshot.recommendations[0] && <article className="nexus-priority-card"><span>From your recommendations</span><strong>{snapshot.recommendations[0].action}</strong><p>{snapshot.recommendations[0].reason}</p><button type="button" onClick={() => { setInput(`Why is “${snapshot.recommendations[0].action}” a priority?`); inputRef.current?.focus(); setState('listening') }}>Ask why <ArrowUpRight size={12}/></button></article>}</div>}
          {announcement && <div className="nexus-celebration-note" role="status"><Sparkles size={14}/>{announcement}</div>}
          {messages.map((message) => <article key={message.id} className={`nexus-message nexus-message-${message.role}`}>
            {message.role === 'assistant' && <span className="nexus-message-avatar"><RobotFace state="happy" small/></span>}
            <div className="nexus-message-body"><p>{message.content}</p>{message.citations?.length ? <div className="nexus-citations" aria-label="Note sources">{message.citations.map((citation, index) => <span key={`${citation.document_id}-${index}`} title={citation.excerpt}>{citation.document_name}{citation.page_number ? ` · p. ${citation.page_number}` : ''}</span>)}</div> : null}{message.web_citations?.map((citation) => <a className="nexus-web-citation" key={citation.url} href={citation.url} target="_blank" rel="noreferrer">{citation.title}<ArrowUpRight size={12}/></a>)}</div>
          </article>)}
          {conversationLoading && <div className="nexus-thinking-row" role="status"><span>Restoring conversation…</span></div>}
          {busy && <div className="nexus-thinking-row" role="status"><span className="nexus-thinking-dots"><i/><i/><i/></span><span>NEXUS is thinking</span></div>}
          {error && <div className="nexus-error" role="alert"><CircleHelp size={15}/><span>{error}</span></div>}
        </div>
        <form className="nexus-composer" onSubmit={(event) => void sendMessage(event)}>
          <textarea ref={inputRef} value={input} rows={1} maxLength={3000} disabled={busy || conversationLoading} aria-label="Message NEXUS" placeholder="Ask about your studies…" onFocus={() => { if (!busy && !focusMode) setState('listening') }} onChange={(event) => { setInput(event.target.value); if (!busy && !focusMode) setState('listening') }} onKeyDown={onInputKeyDown}/>
          <button type="submit" aria-label="Send message" disabled={busy || conversationLoading || !input.trim()}><Send size={16}/></button>
          <small>Enter to send · Shift + Enter for a new line</small>
        </form>
      </section>}
      {!isOpen && <div className="nexus-teaser" role="status"><span>{announcement || robotMessage(state, currentName.split(' ')[0])}</span><ChevronDown size={13}/></div>}
      <button ref={launcherRef} type="button" className="nexus-launcher" aria-label={isOpen ? 'Close NEXUS companion' : 'Open NEXUS study companion'} aria-expanded={isOpen} onClick={openPanel}>
        <span className="nexus-launcher-glow" />{isOpen ? <X className="nexus-close-icon" size={20}/> : <RobotFace state={state}/>}
        {!isOpen && <span className="nexus-launcher-label"><MessageCircle size={13}/><span>Ask NEXUS</span></span>}
        {state === 'thinking' && <span className="nexus-launcher-thinking"><i/><i/><i/></span>}
      </button>
    </div>
  )
}
