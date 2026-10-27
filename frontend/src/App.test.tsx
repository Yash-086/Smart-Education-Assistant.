import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function mockApi(tasks: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => ({
    ok: true,
    json: async () => {
      const path = String(input)
      if (path.endsWith('/api/health')) return { status: 'ok', database: 'connected' }
      if (path.startsWith('/api/profile')) return { name: 'Avery Student', university: 'North University', college: 'Engineering', degree: '', branch: '', academic_year: '', semester: '', subjects: [], exam_dates: [], weekly_study_hours: 8 }
      if (path.startsWith('/api/recommendations')) return { items: [], basis: 'Based on saved data.' }
      if (path.startsWith('/api/conversations')) return []
      if (path.startsWith('/api/notes')) return []
      return tasks
    },
  } as Response)))
}

describe('application navigation and dashboard', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
    vi.unstubAllGlobals()
  })

  it('shows a truthful empty dashboard and API state when there are no saved tasks', async () => {
    window.history.replaceState(null, '', '/#/dashboard')
    mockApi()
    render(<App />)

    expect(await screen.findByRole('heading', { name: /make room for better learning/i })).toBeInTheDocument()
    expect(await screen.findByText(/good to see you, avery/i)).toBeInTheDocument()
    expect(await screen.findByText('Your semester starts with one task')).toBeInTheDocument()
    expect(await screen.findByText('Workspace ready')).toBeInTheDocument()
  })

  it('renders saved task data as a planner link', async () => {
    window.history.replaceState(null, '', '/#/dashboard')
    mockApi([{
      id: 7,
      title: 'Prepare circuits lab',
      subject: 'Circuit Theory',
      task_type: 'lab_record',
      due_date: '2026-12-01',
      estimated_minutes: 75,
      priority: 'high',
      status: 'todo',
      scheduled_start_at: null,
      created_at: '2026-10-23T10:00:00',
      updated_at: '2026-10-23T10:00:00',
    }])
    render(<App />)

    const taskLink = await screen.findByRole('link', { name: /Prepare circuits lab/ })
    expect(taskLink).toHaveAttribute('href', '#/planner')
    expect(taskLink).toHaveTextContent('Circuit Theory')
  })

  it('routes sidebar items to the implemented notes module', async () => {
    window.history.replaceState(null, '', '/#/dashboard')
    mockApi()
    render(<App />)

    fireEvent.click(screen.getAllByRole('link', { name: /study planner/i })[0])
    expect(await screen.findByRole('heading', { name: 'Your tasks' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: /college notes/i }))
    expect(await screen.findByRole('heading', { name: /your materials, ready to learn from/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /document library/i })).toBeInTheDocument()
  })

  it('exposes the three AI Study Studio areas without removing the existing assistant route', async () => {
    window.history.replaceState(null, '', '/#/dashboard')
    mockApi()
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: 'Study Sources' }))
    expect(await screen.findByRole('heading', { name: /your materials, ready to learn from/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Smart Learning' }))
    expect(await screen.findByRole('heading', { name: 'Learn it, test it, remember it.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Exam Preparation' }))
    expect(await screen.findByRole('heading', { name: 'Prepare with a clear plan.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'AI Chat Assistant' }))
    expect(await screen.findByRole('heading', { name: 'Your academic co-pilot.' })).toBeInTheDocument()
  })

  it('reports a backend outage without crashing the dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    window.history.replaceState(null, '', '/#/dashboard')
    render(<App />)

    expect(await screen.findByText('API offline')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the API/)
  })

  it('switches themes across routes and nested controls, then restores the saved theme', async () => {
    window.history.replaceState(null, '', '/#/dashboard')
    mockApi()
    const { container, unmount } = render(<App />)
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-theme', 'dark')
    expect(container.querySelector('.app-shell')).toHaveClass('theme-dark')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to focus theme' }))
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-theme', 'light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(window.localStorage.getItem('campusly-theme')).toBe('light')

    fireEvent.click(screen.getByRole('link', { name: 'Study planner' }))
    expect(await screen.findByRole('heading', { name: 'Your tasks' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = await screen.findByRole('dialog', { name: /add a study task/i })
    expect(dialog.closest('.app-shell')).toHaveAttribute('data-theme', 'light')
    const taskType = screen.getByLabelText('Task type')
    fireEvent.change(taskType, { target: { value: 'lab_record' } })
    expect(taskType).toHaveValue('lab_record')
    fireEvent.click(screen.getByRole('button', { name: 'Close task form' }))

    fireEvent.click(screen.getByRole('link', { name: 'College notes' }))
    expect(await screen.findByRole('heading', { name: /your materials, ready to learn from/i })).toBeInTheDocument()
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-theme', 'light')
    fireEvent.click(screen.getByRole('link', { name: 'Smart Learning' }))
    expect(await screen.findByRole('heading', { name: 'Learn it, test it, remember it.' })).toBeInTheDocument()
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-theme', 'light')
    fireEvent.click(screen.getByRole('link', { name: 'Exam Preparation' }))
    expect(await screen.findByRole('heading', { name: 'Prepare with a clear plan.' })).toBeInTheDocument()
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-theme', 'light')
    fireEvent.click(screen.getByRole('link', { name: 'AI Chat Assistant' }))
    expect(await screen.findByRole('heading', { name: 'Your academic co-pilot.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Recommendations' }))
    expect(await screen.findByRole('heading', { name: 'A practical next step.' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Profile' }))
    expect(await screen.findByRole('heading', { name: /make this workspace yours/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Academic settings' }))
    expect(await screen.findByRole('heading', { name: /shape your semester/i })).toBeInTheDocument()
    unmount()
    const restored = render(<App />)
    expect(restored.container.querySelector('.app-shell')).toHaveAttribute('data-theme', 'light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('opens the task form directly from the dashboard quick action', async () => {
    window.history.replaceState(null, '', '/#/dashboard')
    mockApi()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /new task/i }))
    expect(await screen.findByRole('dialog', { name: /add a study task/i })).toBeInTheDocument()
  })

  it('sends the dashboard command to the existing assistant with the prompt ready', async () => {
    window.history.replaceState(null, '', '/#/dashboard')
    mockApi()
    render(<App />)
    const command = await screen.findByRole('textbox', { name: 'Ask Campusly' })
    fireEvent.change(command, { target: { value: 'Explain recursion step by step' } })
    fireEvent.submit(command.closest('form')!)

    expect(await screen.findByRole('heading', { name: 'Your academic co-pilot.' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Explain recursion step by step')
  })
})
