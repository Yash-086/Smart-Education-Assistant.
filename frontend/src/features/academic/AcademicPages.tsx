import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { BookOpen, Check, Copy, FileText, MessageSquareText, Plus, Send, Trash2, Upload, UserRound, Sparkles, Settings2 } from 'lucide-react'
import { ApiError, taskApi, type TaskInput } from '../planner/taskApi'
import IntelligenceCore, { type CoreState } from '../dashboard/IntelligenceCore'

const panelClass = 'academic-panel'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let response: Response
  try { response = await fetch(path, { ...init, headers }) } catch { throw new Error('Could not reach the API. Start the FastAPI server and try again.') }
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'The request could not be completed.')
  return body as T
}

type Note = { id: number; title: string; subject: string; filename: string; file_type?: string; size_bytes?: number; status: string; status_message: string; page_count: number; created_at: string }
type NoteDetails = Note & { pages: { page_number: number | null; text: string }[] }
type Citation = { document_id: number; document_name: string; page_number: number | null; excerpt: string }
type StudyGeneration = { action: string; content: string; items: unknown[]; citations: Citation[]; mode: string }

function highlightText(text: string, term: string): ReactNode {
  const value = term.trim()
  if (!value) return text
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return parts.map((part, index) => part.toLocaleLowerCase() === value.toLocaleLowerCase()
    ? <mark className="search-highlight" key={`${index}-${part}`}>{part}</mark>
    : part)
}

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<NoteDetails | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState<Citation[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [generated, setGenerated] = useState<StudyGeneration | null>(null)
  const [busy, setBusy] = useState(false)
  const [notesLoading, setNotesLoading] = useState(true)
  const [error, setError] = useState('')
  async function load() { setNotesLoading(true); try { setNotes(await api<Note[]>(`/api/notes?q=${encodeURIComponent(query)}`)) } finally { setNotesLoading(false) } }
  useEffect(() => { let live = true; setNotesLoading(true); api<Note[]>(`/api/notes?q=${encodeURIComponent(query)}`).then((v) => live && setNotes(v)).catch((e) => live && setError(e.message)).finally(() => live && setNotesLoading(false)); return () => { live = false } }, [query])
  async function upload(event: FormEvent) {
    event.preventDefault(); if (!file) return
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) { setError('Choose a PDF, DOCX, or TXT file.'); return }
    if (file.size > 20 * 1024 * 1024) { setError('Study materials must be 20 MB or smaller.'); return }
    setBusy(true); setError('')
    try { const body = new FormData(); body.set('file', file); body.set('title', title); body.set('subject', subject); await api('/api/notes', { method: 'POST', body }); setFile(null); setTitle(''); setSubject(''); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.') } finally { setBusy(false) }
  }
  function acceptDroppedFile(dropped: File | undefined) {
    if (!dropped) return
    if (!/\.(pdf|docx|txt)$/i.test(dropped.name)) { setError('Choose a PDF, DOCX, or TXT file.'); return }
    if (dropped.size > 20 * 1024 * 1024) { setError('Study materials must be 20 MB or smaller.'); return }
    setError(''); setFile(dropped)
  }
  async function openNote(id: number) { try { setSelected(await api<NoteDetails>(`/api/notes/${id}`)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not open document.') } }
  async function remove(id: number) { if (!window.confirm('Delete this study source and its extracted text?')) return; try { await api(`/api/notes/${id}`, { method: 'DELETE' }); if (selected?.id === id) setSelected(null); setSelectedIds((ids) => ids.filter((selectedId) => selectedId !== id)); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete document.') } }
  async function ask(event: FormEvent) { event.preventDefault(); if (!question.trim()) return; setBusy(true); setError(''); try { const result = await api<{answer:string;citations:Citation[]}>('/api/notes/search', { method: 'POST', body: JSON.stringify({ question, document_ids: selected ? [selected.id] : undefined }) }); setAnswer(result.answer); setCitations(result.citations) } catch (e) { setError(e instanceof Error ? e.message : 'Could not search notes.') } finally { setBusy(false) } }
  async function generate(action: string) { if (!selectedIds.length) { setError('Select one or more processed sources first.'); return } setBusy(true); setError(''); setGenerated(null); try { setGenerated(await api<StudyGeneration>('/api/study/generate', { method: 'POST', body: JSON.stringify({ action, question, document_ids: selectedIds }) })) } catch (e) { setError(e instanceof Error ? e.message : 'Study content could not be generated.') } finally { setBusy(false) } }
  return <div className="page-container academic-page"><div className="academic-heading"><div className="eyebrow"><span className="eyebrow-line" /> AI STUDY STUDIO · STUDY SOURCES</div><h1>Your materials, ready to learn from.</h1><p>Upload course materials, ask grounded questions, and generate source-based summaries.</p></div>
    {error && <p className="academic-alert" role="alert">{error}</p>}
    <section className={panelClass}><h2><Upload size={18}/> Add study materials</h2><form className="academic-form upload-form" onSubmit={upload}><label className="pdf-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); acceptDroppedFile(event.dataTransfer.files[0]) }}><input type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,text/plain,.txt" onChange={(e) => acceptDroppedFile(e.target.files?.[0])} required /><span className="drop-icon"><Upload size={18}/></span><strong>{file ? file.name : 'Drop a PDF, DOCX, or TXT here or browse'}</strong><small>PDF · DOCX · TXT · up to 20 MB</small></label><label>Document title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Use filename if blank" maxLength={240}/></label><label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Uncategorized if blank" maxLength={120}/></label><button className="primary-button" disabled={busy || !file}>{busy ? 'Processing…' : 'Add to study sources'}</button><small>Scanned PDFs may need OCR before they can be searched.</small></form></section>
    <section className={panelClass} aria-busy={notesLoading}><div className="academic-section-head"><div><h2><BookOpen size={18}/> Document library</h2><p>Search titles, subjects, and extracted text.</p></div><input aria-label="Search notes" className="academic-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…"/></div>
      {notesLoading ? <div className="notes-skeleton" role="status" aria-label="Loading documents"><span/><span/><span/></div> : !notes.length ? <div className="academic-empty"><FileText/><strong>{query ? 'No matching sources' : 'No study materials yet'}</strong><span>{query ? 'Try a different title or phrase.' : 'Uploaded materials will be processed and searchable here.'}</span></div> : <div className="note-list">{notes.map((note) => <article key={note.id} className={`note-row ${selected?.id === note.id ? 'note-selected' : ''}`}><label className="note-source-check"><input type="checkbox" aria-label={`Use ${note.title} as a study source`} disabled={note.status !== 'ready'} checked={selectedIds.includes(note.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, note.id] : ids.filter((id) => id !== note.id))}/></label><button className="note-open" onClick={() => void openNote(note.id)}><span className="document-icon"><FileText size={18}/></span><span className="note-copy"><strong>{highlightText(note.title, query)}</strong><small>{highlightText(`${note.subject} · ${note.file_type || 'FILE'} · ${((note.size_bytes || 0) / 1024).toFixed(0)} KB`, query)}</small><small className={`note-status status-${note.status}`}>{note.status.replace('_',' ')} · {note.status_message}</small></span></button><button className="icon-button" aria-label={`Delete ${note.title}`} onClick={() => void remove(note.id)}><Trash2 size={16}/></button></article>)}</div>}
    </section>
    <section className={panelClass}><h2><MessageSquareText size={18}/> Ask your selected sources</h2><p className="academic-hint">Answers are generated with the configured backend model and retrieved passages. If a passage does not support an answer, the assistant will say so.</p><form className="ask-form" onSubmit={(event) => { event.preventDefault(); void generate('ask') }}><textarea aria-label="Ask selected study sources" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Select one or more sources, then ask a question…" rows={2}/><button className="primary-button" disabled={busy || !question.trim() || !selectedIds.length}><Send size={15}/>{busy ? 'Thinking…' : 'Ask sources'}</button></form><div className="study-action-grid"><button className="secondary-button" disabled={busy || !selectedIds.length} onClick={() => void generate('summary')}>Short summary</button><button className="secondary-button" disabled={busy || !selectedIds.length} onClick={() => void generate('detailed_summary')}>Detailed summary</button><button className="secondary-button" disabled={busy || !selectedIds.length} onClick={() => void generate('key_concepts')}>Key concepts</button></div>{generated && <div className="answer-box"><div className="study-output-heading"><strong>{generated.action.replace('_', ' ')}</strong><button className="secondary-button" onClick={() => void navigator.clipboard?.writeText(generated.content)}>Copy</button></div><p className="study-output-copy">{generated.content}</p>{generated.citations.map((citation, index) => <small className="message-source" key={`${citation.document_id}-${index}`}>Source · {citation.document_name}{citation.page_number ? `, page ${citation.page_number}` : ''}</small>)}</div>}</section>
    <section className={panelClass}><h2><MessageSquareText size={18}/> Ask your notes</h2><p className="academic-hint">Answers show retrieved passages. The local keyword method is not a generative AI system.</p><form className="ask-form" onSubmit={ask}><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={selected ? `Ask about ${selected.title}…` : 'Ask a question about all uploaded notes…'} rows={2}/><button className="primary-button" disabled={busy || !question.trim()}><Send size={15}/>{busy ? 'Searching…' : 'Find passages'}</button></form>{answer && <div className="answer-box"><strong>Local notes search</strong><p>{answer}</p>{citations.map((c, i) => <blockquote key={`${c.document_id}-${c.page_number}-${i}`}><b>{c.document_name} · page {c.page_number}</b><br/>{c.excerpt}</blockquote>)}</div>}</section>
    {selected && <section className={panelClass}><div className="academic-section-head"><div><h2>{selected.title}</h2><p>{selected.subject} · {selected.filename}</p></div><button className="secondary-button" onClick={() => setSelected(null)}>Close details</button></div>{selected.pages.length ? selected.pages.map((page, index) => <article className="extracted-page" key={`${page.page_number ?? 'document'}-${index}`}><strong>{page.page_number ? `Page ${page.page_number}` : 'Document text'}</strong><p>{highlightText(page.text, query)}</p></article>) : <p className="academic-hint">{selected.status_message}</p>}</section>}
  </div>
}

type WebCitation = { title: string; url: string; snippet: string }
type Message = { id: number; role: string; content: string; citations: Citation[]; web_citations?: WebCitation[] }
type Conversation = { id: number; title: string }

function AssistantContent({ content }: { content: string }) {
  const [copied, setCopied] = useState<number | null>(null)
  const chunks: Array<{ type: 'text' | 'code'; value: string; language?: string }> = []
  const pattern = /```([\w+-]*)\s*\n([\s\S]*?)```/g
  let cursor = 0
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) chunks.push({ type: 'text', value: content.slice(cursor, index) })
    chunks.push({ type: 'code', value: match[2], language: match[1] })
    cursor = index + match[0].length
  }
  if (cursor < content.length) chunks.push({ type: 'text', value: content.slice(cursor) })
  return <div className="assistant-content">{chunks.map((chunk, index) => chunk.type === 'code'
    ? <div className="assistant-code" key={`code-${index}`}><div className="code-heading"><span>{chunk.language || 'CODE'}</span><button type="button" onClick={() => { void navigator.clipboard?.writeText(chunk.value).then(() => { setCopied(index); window.setTimeout(() => setCopied(null), 1600) }).catch(() => undefined) }} aria-label="Copy code">{copied === index ? <Check size={14}/> : <Copy size={14}/>} {copied === index ? 'Copied' : 'Copy'}</button></div><pre><code>{chunk.value}</code></pre></div>
    : chunk.value.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={`text-${index}-${paragraphIndex}`}>{paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, partIndex) => part.startsWith('**') && part.endsWith('**') ? <strong key={partIndex}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={partIndex}>{part.slice(1, -1)}</code> : part)}</p>))}</div>
}

export function AssistantPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('prompt') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [providerConfigured, setProviderConfigured] = useState(false)
  const [missingConfiguration, setMissingConfiguration] = useState<string[]>(['LLM_PROVIDER'])
  const [webSearchConfigured, setWebSearchConfigured] = useState(false)
  const [coreState, setCoreState] = useState<CoreState>('idle')
  const [linkedConversation, setLinkedConversation] = useState<number | null>(() => {
    const value = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('conversation'))
    return Number.isInteger(value) && value > 0 ? value : null
  })
  async function refresh() { setConversations(await api<Conversation[]>('/api/conversations')) }
  useEffect(() => { void refresh().catch((e) => setError(e.message)); api<{configured:boolean;missing_configuration?:string[];web_search_configured?:boolean}>('/api/assistant/status').then((status) => { setProviderConfigured(status.configured); setMissingConfiguration(status.missing_configuration ?? []); setWebSearchConfigured(Boolean(status.web_search_configured)) }).catch(() => { setProviderConfigured(false); setWebSearchConfigured(false) }) }, [])
  useEffect(() => {
    const updateLinkedConversation = () => {
      const value = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('conversation'))
      setLinkedConversation(Number.isInteger(value) && value > 0 ? value : null)
    }
    window.addEventListener('hashchange', updateLinkedConversation)
    return () => window.removeEventListener('hashchange', updateLinkedConversation)
  }, [])
  useEffect(() => {
    if (coreState !== 'response') return
    const timer = window.setTimeout(() => setCoreState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [coreState])
  async function selectConversation(id: number) { setActive(id); try { const data = await api<{messages:Message[]}>(`/api/conversations/${id}`); setMessages(data.messages) } catch (e) { setError(e instanceof Error ? e.message : 'Could not load conversation.') } }
  useEffect(() => { if (linkedConversation) void selectConversation(linkedConversation) }, [linkedConversation])
  async function send(event: FormEvent) { event.preventDefault(); const prompt = question.trim(); if (!prompt) return; const pendingId = Date.now(); setBusy(true); setCoreState('processing'); setError(''); setQuestion(''); setMessages((m) => [...m, { id: pendingId, role: 'user', content: prompt, citations: [] }]); try { const response = await api<{conversation_id:number;answer:string;citations:Citation[];web_citations?:WebCitation[]}>('/api/assistant/ask', { method:'POST', body:JSON.stringify({question:prompt,conversation_id:active}) }); setActive(response.conversation_id); setMessages((m) => [...m, { id: pendingId + 1, role:'assistant', content:response.answer, citations:response.citations, web_citations:response.web_citations }]); setCoreState('response'); await refresh() } catch (e) { setMessages((m) => m.filter((message) => message.id !== pendingId)); setCoreState('offline'); setError(e instanceof Error ? e.message : 'The assistant could not respond.') } finally { setBusy(false) } }
  return <div className="page-container academic-page assistant-workspace">
    <div className="academic-heading assistant-heading"><div className="eyebrow"><span className="eyebrow-line"/> CAMPUSLY INTELLIGENCE</div><h1>Your academic co-pilot.</h1><p>Ask questions, work through concepts, or retrieve source-backed passages from your notes.</p></div>
    {error && <p className="academic-alert" role="alert">{error}</p>}
    <div className="assistant-layout">
      <aside className={`${panelClass} conversation-rail`}><button className="primary-button full-button" onClick={() => {setActive(null);setMessages([]);setError('')}}><Plus size={15}/> New conversation</button><h3>Recent conversations</h3>{conversations.map((c) => <button key={c.id} className={`conversation-item ${active === c.id ? 'conversation-active':''}`} onClick={() => void selectConversation(c.id)}>{c.title}</button>)}</aside>
      <section className={`${panelClass} chat-panel`}>
        <div className="assistant-core-header"><IntelligenceCore state={coreState}/><div className={`offline-note ${providerConfigured?'provider-live':''}`}><Sparkles size={16}/><span>{providerConfigured ? <><strong>AI provider configured.</strong> Campusly uses your configured model, saved conversation context, and relevant workspace tools.</> : <><strong>AI setup required.</strong> Check {missingConfiguration.join(', ')} in the repository-root .env file and restart FastAPI. No model response will be simulated.</>}</span></div></div>
        <p className="assistant-capabilities">{webSearchConfigured ? 'Cited current web research is available when a question needs it.' : 'Current web research needs TAVILY_API_KEY; ordinary questions do not.'}</p>
        <div className="chat-messages" aria-live="polite">
          {!messages.length && <div className="chat-empty"><MessageSquareText size={28}/><strong>What are you working on?</strong><span>Choose a starting point, or ask about uploaded notes.</span><div className="prompt-suggestions"><button type="button" onClick={()=>setQuestion('Summarize the key ideas from my notes')}>Summarize my notes</button><button type="button" onClick={()=>setQuestion('Help me prepare for my next exam')}>Plan exam revision</button><button type="button" onClick={()=>setQuestion('Explain this step by step')}>Explain step by step</button></div></div>}
          {messages.map((message) => <article key={message.id} className={`chat-message message-${message.role}`}><div className="message-role">{message.role === 'user' ? 'You' : 'Campusly'}</div><AssistantContent content={message.content}/>{message.citations.map((citation,index) => <small className="message-source" key={`note-${index}-${citation.document_id}`}>Note source · {citation.document_name}, page {citation.page_number}</small>)}{message.web_citations?.length ? <div className="web-source-list"><span className="source-label">WEB SOURCES</span>{message.web_citations.map((source,index) => <a key={`${index}-${source.url}`} href={source.url} target="_blank" rel="noreferrer"><strong>[{index+1}] {source.title}</strong><span>{source.snippet}</span><small>{new URL(source.url).hostname}</small></a>)}</div> : null}</article>)}
          {busy && <div className="chat-loading" role="status">Working through your question…</div>}
        </div>
        <form className="chat-compose" onSubmit={send}><textarea aria-label="Message" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask Campusly anything about your studies…"/><button className="primary-button" disabled={busy || !question.trim()} aria-label="Send message"><Send size={16}/></button><small>Saved in this workspace · powered by your configured model</small></form>
      </section>
    </div>
  </div>
}

type Profile = { name:string; university:string; college:string; degree:string; branch:string; academic_year:string; semester:string; subjects:string[]; exam_dates:{subject:string;date:string}[]; weekly_study_hours:number }
const emptyProfile: Profile = { name:'', university:'', college:'', degree:'', branch:'', academic_year:'', semester:'', subjects:[], exam_dates:[], weekly_study_hours:0 }
export function ProfilePage({ mode = 'profile' }: { mode?: 'profile' | 'academic' }) {
  const [profile, setProfile] = useState<Profile>(emptyProfile)
  const [subjects, setSubjects] = useState('')
  const [exams, setExams] = useState('')
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Profile>('/api/profile').then((data) => { setProfile(data); setSubjects(data.subjects.join(', ')); setExams(data.exam_dates.map((e) => `${e.subject} | ${e.date}`).join('\n')) }).catch((e) => setError(e.message)) }, [])
  function field(key: keyof Profile, label: string) { return <label>{label}<input value={String(profile[key] ?? '')} onChange={(e) => { setProfile({...profile,[key]:e.target.value}); setDirty(true); setSaved(false) }}/></label> }
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setSaved(false); setError(''); try { const exam_dates = exams.split('\n').map((line) => line.split('|').map((part) => part.trim())).filter((parts) => parts.length >= 2 && parts[0] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])).map(([subject,date]) => ({subject,date})); const result = await api<Profile>('/api/profile',{method:'PUT',body:JSON.stringify({...profile,subjects:subjects.split(',').map((s)=>s.trim()).filter(Boolean),exam_dates,weekly_study_hours:Number(profile.weekly_study_hours)})}); setProfile(result); setDirty(false); setSaved(true) } catch(e) { setError(e instanceof Error ? e.message : 'Could not save profile.') } finally { setBusy(false) } }
  const personal = mode === 'profile'
  return <div className="page-container academic-page"><div className="academic-heading"><div className="eyebrow"><span className="eyebrow-line"/> {personal ? 'YOUR PROFILE' : 'ACADEMIC SETTINGS'}</div><h1>{personal ? 'Make this workspace yours.' : 'Shape your semester.'}</h1><p>{personal ? 'Manage the personal details shown across your academic workspace.' : 'Keep your course structure, subjects, and exam dates up to date.'}</p></div>{error && <p className="academic-alert" role="alert">{error}</p>}{saved && <p className="academic-success" role="status">Changes saved to your workspace.</p>}<form className={`${panelClass} academic-form profile-form`} onSubmit={save}><div className="profile-form-heading"><h2>{personal ? <><UserRound size={18}/> Personal details</> : <><Settings2 size={18}/> Academic configuration</>}</h2><span className={`form-save-state ${dirty ? 'is-dirty' : ''}`} role="status">{dirty ? 'Unsaved changes' : saved ? 'All changes saved' : 'Saved in this workspace'}</span></div>{personal ? <>{field('name','Student name')}{field('university','University')}{field('college','College')}</> : <>{field('degree','Degree')}{field('branch','Branch')}{field('academic_year','Academic year')}{field('semester','Current semester')}<label>Subjects (comma separated)<textarea rows={3} value={subjects} onChange={(e)=>{setSubjects(e.target.value);setDirty(true);setSaved(false)}} placeholder="e.g. Mathematics, Physics, Programming"/></label><label>Exam dates (one per line: Subject | YYYY-MM-DD)<textarea rows={4} value={exams} onChange={(e)=>{setExams(e.target.value);setDirty(true);setSaved(false)}} placeholder="Mathematics | 2026-12-10"/><small>Use YYYY-MM-DD. Only dates in this format are saved.</small></label><label>Available study hours per week<input type="number" min={0} max={100} value={profile.weekly_study_hours} onChange={(e)=>{setProfile({...profile,weekly_study_hours:Number(e.target.value)});setDirty(true);setSaved(false)}}/><small>Used to size suggested revision sessions when this information is available.</small></label></>}<div><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div></form></div>
}

type Recommendation = { task_id?:number; action:string; subject:string; reason:string; priority:'low'|'normal'|'high'|'urgent'; suggested_minutes?:number; task: {title:string;subject:string;due_date:string;estimated_minutes:number;priority:'low'|'normal'|'high'|'urgent'} }
export function RecommendationsPage() {
  const [items, setItems] = useState<Recommendation[]>([])
  const [basis, setBasis] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  async function load() { setLoading(true); try { const result = await api<{items:Recommendation[];basis:string}>('/api/recommendations'); setItems(result.items); setBasis(result.basis); setError('') } catch(e) { setError(e instanceof Error ? e.message : 'Could not load recommendations.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  async function createTask(item: Recommendation) { try { const payload: TaskInput = {...item.task,task_type:'revision',status:'todo',scheduled_start_at:null}; await taskApi.create(payload); setFeedback(`Created “${payload.title}” in your planner.`); await load() } catch(e) { setFeedback(e instanceof ApiError ? e.message : 'Could not create the task.') } }
  return <div className="page-container academic-page"><div className="academic-heading"><div className="eyebrow"><span className="eyebrow-line"/> SMART RECOMMENDATIONS</div><h1>A practical next step.</h1><p>Recommendations use your saved tasks and configured exam dates.</p></div>{error && <p className="academic-alert" role="alert">{error}</p>}{feedback && <p className="academic-success" role="status">{feedback}</p>}<section className={panelClass}><div className="academic-section-head"><div><h2><Sparkles size={18}/> Suggested actions</h2><p>{basis || 'Loading your workspace data…'}</p></div><button className="secondary-button" onClick={() => void load()}>Refresh</button></div>{loading ? <div className="notes-skeleton" role="status" aria-label="Loading recommendations"><span/><span/></div> : !items.length && !error ? <div className="academic-empty"><Sparkles/><strong>No urgent action found</strong><span>Add tasks or configure upcoming exam dates to get grounded suggestions.</span></div> : <div className="recommendation-list">{items.map((item,i)=><article key={`${item.task_id ?? item.action}-${i}`} className="recommendation-card"><span className={`priority-badge priority-${item.priority}`}>{item.priority}</span><h3>{item.action}</h3><p className="recommend-subject">{item.subject}{item.suggested_minutes ? ` · ${item.suggested_minutes} min` : ''}</p><details className="recommendation-explanation"><summary>Why this suggestion</summary><p>{item.reason}</p></details><button className="secondary-button" onClick={() => void createTask(item)}><Plus size={14}/> Create study task</button></article>)}</div>}</section></div>
}
