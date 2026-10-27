import { useEffect, useLayoutEffect, useState } from 'react'
import { CalendarDays, Compass, GraduationCap, LayoutDashboard, LibraryBig, Menu, MessageSquareText, PanelLeftClose, Settings2, Sparkles, PanelLeftOpen, UserRound, Sun, Moon, BrainCircuit, NotebookTabs } from 'lucide-react'
import DashboardPage from './features/dashboard/DashboardPage'
import PlannerPage from './features/planner/PlannerPage'
import { AssistantPage, NotesPage, ProfilePage, RecommendationsPage } from './features/academic/AcademicPages'
import { ExamPreparationPage, SmartLearningPage } from './features/study/StudyStudioPages'
import ExperienceEffects from './features/shared/ExperienceEffects'
import NexusCompanion from './features/shared/NexusCompanion'

type Health = 'checking' | 'connected' | 'unavailable'
type RoutePath = '/dashboard' | '/planner' | '/notes' | '/assistant' | '/recommendations' | '/profile' | '/settings' | '/sources' | '/learning' | '/exam-prep'
type RouteItem = { label: string; path: RoutePath; icon: typeof LayoutDashboard }

const workspaceItems: RouteItem[] = [{ label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard }]
const studyItems: RouteItem[] = [
  { label: 'Study planner', path: '/planner', icon: CalendarDays },
  { label: 'College notes', path: '/notes', icon: LibraryBig },
  { label: 'Recommendations', path: '/recommendations', icon: Compass },
]
const assistantItems: RouteItem[] = [{ label: 'AI Chat Assistant', path: '/assistant', icon: MessageSquareText }]
const studioItems: RouteItem[] = [
  { label: 'Study Sources', path: '/sources', icon: NotebookTabs },
  { label: 'Smart Learning', path: '/learning', icon: BrainCircuit },
  { label: 'Exam Preparation', path: '/exam-prep', icon: GraduationCap },
]
const settingsItems: RouteItem[] = [
  { label: 'Profile', path: '/profile', icon: UserRound },
  { label: 'Academic settings', path: '/settings', icon: Settings2 },
]
const routeTitles: Record<RoutePath, string> = {
  '/dashboard': 'Dashboard',
  '/planner': 'Study planner',
  '/notes': 'College notes',
  '/assistant': 'AI study assistant',
  '/recommendations': 'Recommendations',
  '/profile': 'Profile',
  '/settings': 'Academic settings',
  '/sources': 'Study Sources',
  '/learning': 'Smart Learning',
  '/exam-prep': 'Exam Preparation',
}
function readRoute(): RoutePath {
  const path = window.location.hash.slice(1).split('?')[0]
  return (path in routeTitles ? path : '/dashboard') as RoutePath
}

function readInitialTheme(): 'dark' | 'light' {
  try {
    return window.localStorage.getItem('campusly-theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function App() {
  const [health, setHealth] = useState<Health>('checking')
  const [studentName, setStudentName] = useState('Student')
  const [university, setUniversity] = useState('Academic workspace')
  const [route, setRoute] = useState<RoutePath>(readRoute)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(readInitialTheme)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('campusly-theme', theme)
    } catch {
      // The active theme still applies when browser storage is unavailable.
    }
  }, [theme])

  useEffect(() => {
    const updateRoute = () => setRoute(readRoute())
    window.addEventListener('hashchange', updateRoute)
    if (!window.location.hash) window.location.hash = '#/dashboard'
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])

  useEffect(() => {
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [route])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/profile', { signal: controller.signal }).then((response) => response.ok ? response.json() : null).then((profile: {name?: string; university?: string} | null) => {
      if (!profile) return
      if (profile.name?.trim()) setStudentName(profile.name.trim())
      if (profile.university?.trim()) setUniversity(profile.university.trim())
    }).catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error('API unavailable')
      return response.json() as Promise<{ status: string; database: string }>
    }).then((data) => {
      setHealth(data.status === 'ok' && data.database === 'connected' ? 'connected' : 'unavailable')
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return
      setHealth('unavailable')
    })
    return () => controller.abort()
  }, [])

  function navigate(path: string) {
    const routePath = path.split('?')[0]
    const next = (routePath in routeTitles ? routePath : '/dashboard') as RoutePath
    const nextHash = path.includes('?') ? `#${next}?${path.split('?').slice(1).join('?')}` : `#${next}`
    if (window.location.hash === nextHash) setRoute(next)
    else window.location.hash = nextHash
    setMobileMenuOpen(false)
  }

  return (
    <div className={`app-shell theme-${theme} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-theme={theme}>
      <ExperienceEffects />
      <div className="scroll-progress-track" aria-hidden="true"><span className="scroll-progress-fill" /></div>
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`} aria-label="Main navigation">
        <div className="brand-row"><a className="brand-home" href="#/dashboard" aria-label="Campusly dashboard"><span className="brand-mark"><GraduationCap size={20} strokeWidth={2.2} /></span><span className="brand-name">campus<span>ly</span></span></a><button className="icon-button sidebar-collapse" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)}><PanelLeftClose size={18} /></button></div>
        <button className="university-picker" aria-label="Open academic settings" onClick={() => navigate('/settings')}><span className="uni-avatar">{studentName.charAt(0).toUpperCase()}</span><span className="university-copy"><strong>{university}</strong><small>Personal study hub</small></span><Settings2 size={15} className="muted-icon" /></button>

        <nav className="sidebar-nav">
          <NavGroup label="Workspace" items={workspaceItems} route={route} onNavigate={navigate} />
          <NavGroup label="Your AI assistant" items={assistantItems} route={route} onNavigate={navigate} />
          <NavGroup label="AI Study Studio" items={studioItems} route={route} onNavigate={navigate} />
          <NavGroup label="Your tools" items={studyItems} route={route} onNavigate={navigate} />
          <NavGroup label="Account" items={settingsItems} route={route} onNavigate={navigate} />
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-bottom">
          <a className="help-card" href="#/assistant"><span className="help-icon"><Sparkles size={17} /></span><span><strong>Need help studying?</strong><span className="help-copy">Ask your notes in the study assistant</span></span></a>
          <div className="profile-row"><div className="profile-avatar">{studentName.charAt(0).toUpperCase()}</div><div className="profile-copy"><strong>{studentName}</strong><small>{university}</small></div><button className="profile-settings" aria-label="Open profile" onClick={() => navigate('/profile')}><UserRound size={17} /></button></div>
        </div>
      </aside>
      {mobileMenuOpen && <button className="mobile-scrim" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} />}

      <main className="main-content">
        <header className="topbar"><button className="icon-button sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileMenuOpen(true)}><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{routeTitles[route]}</strong></div><div className="topbar-actions"><div className={`connection-pill ${health}`} role="status" aria-live="polite"><span className="connection-dot" />{health === 'checking' ? 'Connecting' : health === 'connected' ? 'Workspace ready' : 'API offline'}</div><button className="theme-toggle" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'focus' : 'midnight'} theme`} title={`Switch to ${theme === 'dark' ? 'focus' : 'midnight'} theme`}>{theme === 'dark' ? <Moon size={16}/> : <Sun size={16}/>}<span>{theme === 'dark' ? 'Focus' : 'Midnight'}</span></button></div></header>
        <div className="route-viewport" key={route}>
        {route === '/dashboard' && <DashboardPage onNavigate={navigate} />}
        {route === '/planner' && <PlannerPage onNavigate={navigate} initialCreate={window.location.hash.includes('create=1')} />}
        {route === '/notes' && <NotesPage />}
        {route === '/assistant' && <AssistantPage />}
        {route === '/recommendations' && <RecommendationsPage />}
        {route === '/profile' && <ProfilePage mode="profile" />}
        {route === '/settings' && <ProfilePage mode="academic" />}
        {route === '/sources' && <NotesPage />}
        {route === '/learning' && <SmartLearningPage />}
        {route === '/exam-prep' && <ExamPreparationPage />}
        </div>
      </main>
      <NexusCompanion studentName={studentName} />
    </div>
  )
}

function NavGroup({ label, items, route, onNavigate }: { label: string; items: RouteItem[]; route: RoutePath; onNavigate: (path: string) => void }) {
  return <div className="nav-group"><p className="nav-label">{label}</p>{items.map(({ label: itemLabel, path, icon: Icon }) => <a key={path} className={`nav-item ${route === path ? 'nav-active' : ''}`} href={`#${path}`} aria-label={itemLabel} title={itemLabel} aria-current={route === path ? 'page' : undefined} onClick={() => onNavigate(path)}><Icon size={17} strokeWidth={1.8} /><span>{itemLabel}</span></a>)}</div>
}

export default App
