import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, BrainCircuit, CalendarDays, Check, Clipboard, FileText, Lightbulb, LoaderCircle, RotateCw, Shuffle, Sparkles } from 'lucide-react'

const panelClass = 'academic-panel'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try { response = await fetch(path, { ...init, headers }) } catch { throw new Error('Could not reach the API. Start the FastAPI server and try again.') }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'The request could not be completed.')
  return body as T
}

type Source = { id: number; title: string; filename: string; subject: string; status: string; status_message: string }
type Citation = { document_id: number; document_name: string; page_number: number | null; excerpt: string }
type QuizQuestion = { question: string; options: string[]; answer_index: number; explanation: string }
type Flashcard = { front: string; back: string }
type Topic = { topic: string; reason: string }
type Generated = { action: string; content: string; items: Array<QuizQuestion | Flashcard | Topic | PracticeQuestion>; citations: Citation[] }
type PracticeQuestion = { question: string; difficulty: string; answer: string; explanation: string }
type RevisionSession = { date: string; topic: string; reason: string; minutes: number; completed: boolean }
type RevisionPlan = { id: number; title: string; exam_date: string; minutes_per_day: number; sessions: RevisionSession[] }

function useSources() {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    api<Source[]>('/api/notes').then((data) => live && setSources(data)).catch((reason) => live && setError(reason instanceof Error ? reason.message : 'Could not load study sources.')).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [])
  return { sources, loading, error }
}

function SourcePicker({ sources, loading, selected, onChange }: { sources: Source[]; loading: boolean; selected: number[]; onChange: (ids: number[]) => void }) {
  if (loading) return <p role="status" className="study-hint">Loading your saved sources…</p>
  const usable = sources.filter((source) => source.status === 'ready')
  if (!sources.length) return <p className="study-hint">Upload a PDF, DOCX, or TXT in Study Sources before generating document-based content.</p>
  return <fieldset className="study-source-picker"><legend>Choose study sources</legend>{sources.map((source) => <label key={source.id} className="study-source-option"><input type="checkbox" aria-label={source.title} disabled={source.status !== 'ready'} checked={selected.includes(source.id)} onChange={(event) => onChange(event.target.checked ? [...selected, source.id] : selected.filter((id) => id !== source.id))}/><span><strong>{source.title}</strong><small>{source.filename} · {source.status === 'ready' ? source.status_message : source.status.replace('_', ' ')}</small></span></label>)}{!usable.length && <small>Sources become selectable after processing completes.</small>}</fieldset>
}

function Citations({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null
  return <div className="study-citations"><strong>Grounded in your sources</strong><div>{citations.map((citation, index) => <span key={`${citation.document_id}-${citation.page_number}-${index}`}>{citation.document_name}{citation.page_number ? ` · page ${citation.page_number}` : ''}</span>)}</div></div>
}

function OutputText({ result }: { result: Generated | null }) {
  if (!result?.content) return null
  return <section className={`${panelClass} study-output`} aria-live="polite"><div className="study-output-heading"><h2><Sparkles size={17}/> Generated study material</h2><button className="secondary-button" onClick={() => void navigator.clipboard?.writeText(result.content)}> <Clipboard size={14}/> Copy</button></div><div className="study-output-copy">{result.content}</div><Citations citations={result.citations}/></section>
}

function useGeneration() {
  const [result, setResult] = useState<Generated | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function generate(payload: Record<string, unknown>) {
    setBusy(true); setError(''); setResult(null)
    try { setResult(await api<Generated>('/api/study/generate', { method: 'POST', body: JSON.stringify(payload) })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Study content could not be generated.') }
    finally { setBusy(false) }
  }
  return { result, busy, error, generate, setResult }
}

export function SmartLearningPage() {
  const { sources, loading: sourcesLoading, error: sourcesError } = useSources()
  const { result, busy, error, generate, setResult } = useGeneration()
  const [selected, setSelected] = useState<number[]>([])
  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState<'beginner' | 'detailed'>('beginner')
  const [count, setCount] = useState(5)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [known, setKnown] = useState<Record<number, boolean>>({})
  const [copied, setCopied] = useState(false)
  const quiz = result?.action === 'quiz' ? result.items as QuizQuestion[] : []
  const flashcards = result?.action === 'flashcards' ? result.items as Flashcard[] : []
  const practice = result?.action === 'practice_questions' ? result.items as PracticeQuestion[] : []
  const score = useMemo(() => quiz.reduce((total, question, index) => total + (answers[index] === question.answer_index ? 1 : 0), 0), [answers, quiz])

  async function copyResult() { if (!result) return; const text = result.content || JSON.stringify(result.items, null, 2); try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { setCopied(false) } }
  async function make(action: string) {
    setSubmitted(false); setAnswers({}); setCardIndex(0); setFlipped(false); setKnown({})
    await generate({ action, question: topic.trim(), document_ids: selected, level, count })
  }
  function restartQuiz() { setAnswers({}); setSubmitted(false) }
  function shuffleCards() {
    if (!flashcards.length) return
    const shuffled = [...flashcards].sort(() => Math.random() - 0.5)
    setResult({ ...result!, items: shuffled }); setCardIndex(0); setFlipped(false); setKnown({})
  }

  return <div className="page-container academic-page study-studio-page">
    <header className="study-studio-hero"><div className="eyebrow"><span className="eyebrow-line"/> AI STUDY STUDIO · SMART LEARNING</div><h1>Learn it, test it, remember it.</h1><p>Turn your own course materials into grounded explanations, quizzes, flashcards, and practice questions.</p><div className="study-hero-mark"><BrainCircuit size={34}/></div></header>
    {(error || sourcesError) && <p className="academic-alert" role="alert">{error || sourcesError}</p>}
    <section className={`${panelClass} study-controls`}><SourcePicker sources={sources} loading={sourcesLoading} selected={selected} onChange={setSelected}/><div className="study-controls-grid"><label>Topic for an explanation or practice set<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. Binary search trees" maxLength={200}/></label><label>Explanation depth<select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}><option value="beginner">Beginner friendly</option><option value="detailed">Detailed</option></select></label><label>Questions or cards<select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[3, 5, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="study-action-grid"><button className="primary-button" disabled={busy || !selected.length} onClick={() => void make('quiz')}><BrainCircuit size={15}/> Generate smart quiz</button><button className="secondary-button" disabled={busy || !selected.length} onClick={() => void make('flashcards')}><BookOpen size={15}/> Create flashcards</button><button className="secondary-button" disabled={busy || (!topic.trim() && !selected.length)} onClick={() => void make('explain')}><Lightbulb size={15}/> Explain topic</button><button className="secondary-button" disabled={busy || (!topic.trim() && !selected.length)} onClick={() => void make('practice_questions')}><FileText size={15}/> Practice questions</button></div>{busy && <p className="study-hint" role="status"><LoaderCircle size={14}/> Asking your configured AI model…</p>}</section>

    {result?.action === 'quiz' && quiz.length > 0 && <section className={`${panelClass} study-output`}><div className="study-output-heading"><h2><BrainCircuit size={17}/> Smart quiz</h2><span>{submitted ? `Score ${score} / ${quiz.length}` : `${quiz.length} questions`}</span></div>{quiz.map((item, index) => <fieldset className="quiz-question" key={`${index}-${item.question}`}><legend>{index + 1}. {item.question}</legend>{item.options.map((option, optionIndex) => <label key={optionIndex} className={`quiz-option ${submitted && optionIndex === item.answer_index ? 'is-correct' : ''} ${submitted && answers[index] === optionIndex && optionIndex !== item.answer_index ? 'is-incorrect' : ''}`}><input type="radio" name={`quiz-${index}`} checked={answers[index] === optionIndex} disabled={submitted} onChange={() => setAnswers({ ...answers, [index]: optionIndex })}/>{option}</label>)}{submitted && <p className="quiz-explanation">{item.explanation || `Correct answer: ${item.options[item.answer_index]}`}</p>}</fieldset>)}{submitted ? <button className="secondary-button" onClick={restartQuiz}><RotateCw size={14}/> Restart quiz</button> : <button className="primary-button" disabled={Object.keys(answers).length !== quiz.length} onClick={() => setSubmitted(true)}>Submit answers</button>}<Citations citations={result.citations}/></section>}

    {result?.action === 'flashcards' && flashcards.length > 0 && <section className={`${panelClass} study-output`}><div className="study-output-heading"><h2><BookOpen size={17}/> Flashcards</h2><span>Card {cardIndex + 1} of {flashcards.length}</span></div><button type="button" className={`flashcard ${flipped ? 'is-flipped' : ''}`} onClick={() => setFlipped(!flipped)} aria-label={flipped ? 'Show question side' : 'Reveal answer'}><small>{flipped ? 'ANSWER' : 'QUESTION · SELECT TO FLIP'}</small><strong>{flipped ? flashcards[cardIndex].back : flashcards[cardIndex].front}</strong></button><div className="flashcard-controls"><button className="secondary-button" disabled={cardIndex === 0} onClick={() => { setCardIndex(cardIndex - 1); setFlipped(false) }}>Previous</button><span>{Object.values(known).filter(Boolean).length} known · {Object.values(known).filter((value) => !value).length} for review</span><button className="secondary-button" disabled={cardIndex >= flashcards.length - 1} onClick={() => { setCardIndex(cardIndex + 1); setFlipped(false) }}>Next</button></div><div className="study-action-grid"><button className="secondary-button" onClick={() => setKnown({ ...known, [cardIndex]: true })}><Check size={14}/> I know this</button><button className="secondary-button" onClick={() => setKnown({ ...known, [cardIndex]: false })}>Needs revision</button><button className="secondary-button" onClick={shuffleCards}><Shuffle size={14}/> Shuffle</button></div><Citations citations={result.citations}/></section>}

    {practice.length > 0 && <section className={`${panelClass} study-output`}><div className="study-output-heading"><h2><FileText size={17}/> Practice questions</h2><button className="secondary-button" onClick={() => void copyResult()}>{copied ? 'Copied' : 'Copy answers'}</button></div>{practice.map((item, index) => <article className="practice-question" key={`${index}-${item.question}`}><span>{item.difficulty}</span><h3>{item.question}</h3><details><summary>Show answer and explanation</summary><p><strong>Answer:</strong> {item.answer}</p><p>{item.explanation}</p></details></article>)}<Citations citations={result?.citations ?? []}/></section>}

    {result && !['quiz', 'flashcards', 'practice_questions'].includes(result.action) && <section className={`${panelClass} study-output`}><div className="study-output-heading"><h2><Sparkles size={17}/> Topic explanation</h2><button className="secondary-button" onClick={() => void copyResult()}>{copied ? 'Copied' : 'Copy'}</button></div><div className="study-output-copy">{result.content}</div><Citations citations={result.citations}/></section>}
  </div>
}

function tomorrowDate() { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); return `${tomorrow.getFullYear()}-${`${tomorrow.getMonth() + 1}`.padStart(2, '0')}-${`${tomorrow.getDate()}`.padStart(2, '0')}` }

export function ExamPreparationPage() {
  const { sources, loading: sourcesLoading, error: sourcesError } = useSources()
  const { result, busy, error, generate } = useGeneration()
  const [selected, setSelected] = useState<number[]>([])
  const [question, setQuestion] = useState('')
  const [markFormat, setMarkFormat] = useState<2 | 5 | 10>(5)
  const [examDate, setExamDate] = useState(tomorrowDate)
  const [minutes, setMinutes] = useState(60)
  const [plans, setPlans] = useState<RevisionPlan[]>([])
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState('')
  const topics = result?.action === 'important_topics' ? result.items as Topic[] : []
  async function loadPlans() { try { setPlans(await api<RevisionPlan[]>('/api/study/plans')) } catch (reason) { setPlanError(reason instanceof Error ? reason.message : 'Could not load saved revision plans.') } }
  useEffect(() => { void loadPlans() }, [])
  async function createPlan(event: FormEvent) {
    event.preventDefault(); setPlanBusy(true); setPlanError('')
    try { await api<RevisionPlan>('/api/study/plans', { method: 'POST', body: JSON.stringify({ exam_date: examDate, minutes_per_day: minutes, document_ids: selected, title: 'Exam revision plan' }) }); await loadPlans() }
    catch (reason) { setPlanError(reason instanceof Error ? reason.message : 'Could not generate a revision plan.') }
    finally { setPlanBusy(false) }
  }
  async function toggleSession(plan: RevisionPlan, index: number, completed: boolean) {
    try { const updated = await api<RevisionPlan>(`/api/study/plans/${plan.id}/sessions/${index}`, { method: 'PATCH', body: JSON.stringify({ completed }) }); setPlans(plans.map((item) => item.id === plan.id ? updated : item)) }
    catch (reason) { setPlanError(reason instanceof Error ? reason.message : 'Could not save revision progress.') }
  }

  return <div className="page-container academic-page study-studio-page">
    <header className="study-studio-hero"><div className="eyebrow"><span className="eyebrow-line"/> AI STUDY STUDIO · EXAM PREPARATION</div><h1>Prepare with a clear plan.</h1><p>Find high-value topics in your material, shape exam answers, and track a realistic revision schedule.</p><div className="study-hero-mark"><CalendarDays size={34}/></div></header>
    {(error || sourcesError || planError) && <p className="academic-alert" role="alert">{error || sourcesError || planError}</p>}
    <section className={`${panelClass} study-controls`}><SourcePicker sources={sources} loading={sourcesLoading} selected={selected} onChange={setSelected}/><div className="study-controls-grid"><label>Question for an exam answer<input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Enter or adapt a question from your material" maxLength={1_000}/></label><label>Answer length<select value={markFormat} onChange={(event) => setMarkFormat(Number(event.target.value) as 2 | 5 | 10)}><option value={2}>2 marks · concise</option><option value={5}>5 marks · structured</option><option value={10}>10 marks · detailed</option></select></label></div><div className="study-action-grid"><button className="primary-button" disabled={busy || !selected.length} onClick={() => void generate({ action: 'important_topics', document_ids: selected, count: 10 })}><Lightbulb size={15}/> Find important topics</button><button className="secondary-button" disabled={busy || !selected.length} onClick={() => void generate({ action: 'revision_notes', document_ids: selected })}><BookOpen size={15}/> Create revision notes</button><button className="secondary-button" disabled={busy || !question.trim()} onClick={() => void generate({ action: 'exam_answer', question: question.trim(), mark_format: markFormat, document_ids: selected })}>Generate exam answer</button></div>{busy && <p className="study-hint" role="status"><LoaderCircle size={14}/> Preparing material with your configured AI model…</p>}</section>
    {topics.length > 0 && <section className={`${panelClass} study-output`}><div className="study-output-heading"><h2><Lightbulb size={17}/> Important topics</h2><span>Evidence-based signals, not exam predictions</span></div><div className="important-topic-list">{topics.map((item, index) => <article key={`${index}-${item.topic}`}><span>{`${index + 1}`.padStart(2, '0')}</span><div><h3>{item.topic}</h3><p>{item.reason}</p></div></article>)}</div><Citations citations={result?.citations ?? []}/></section>}
    {result?.content && <OutputText result={result}/>}
    <section className={`${panelClass} study-controls`}><div className="study-output-heading"><div><h2><CalendarDays size={17}/> Revision planner</h2><p>Build a schedule from your selected material and actual exam date.</p></div></div><SourcePicker sources={sources} loading={sourcesLoading} selected={selected} onChange={setSelected}/><form className="study-controls-grid revision-plan-form" onSubmit={(event) => void createPlan(event)}><label>Exam date<input type="date" value={examDate} min={tomorrowDate()} onChange={(event) => setExamDate(event.target.value)} required/></label><label>Available study time per day<input type="number" min={15} max={600} step={15} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} required/><small>15–600 minutes per day</small></label><button className="primary-button" disabled={planBusy || !selected.length}>{planBusy ? 'Planning…' : 'Generate revision plan'}</button></form></section>
    {plans.length > 0 && <section className={`${panelClass} study-output`}><div className="study-output-heading"><h2>Your saved revision plans</h2></div>{plans.map((plan) => <article className="revision-plan" key={plan.id}><div className="revision-plan-title"><h3>{plan.title}</h3><span>Exam · {new Date(`${plan.exam_date}T00:00:00`).toLocaleDateString()}</span></div>{plan.sessions.map((session, index) => <label className={`revision-session ${session.completed ? 'is-complete' : ''}`} key={`${plan.id}-${index}`}><input type="checkbox" checked={session.completed} onChange={(event) => void toggleSession(plan, index, event.target.checked)}/><span><strong>{session.topic}</strong><small>{new Date(`${session.date}T00:00:00`).toLocaleDateString()} · {session.minutes} min · {session.reason}</small></span></label>)}</article>)}</section>}
  </div>
}
