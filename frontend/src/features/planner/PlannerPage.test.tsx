import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlannerPage from './PlannerPage'

function installTaskApiMock() {
  let tasks: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    if (path.endsWith('/api/health')) return { ok: true, json: async () => ({ status: 'ok', database: 'connected' }) } as Response
    if (path === '/api/tasks' && method === 'GET') return { ok: true, json: async () => tasks } as Response
    if (path === '/api/tasks' && method === 'POST') {
      const inputTask = JSON.parse(String(init?.body)) as Record<string, unknown>
      const created = { ...inputTask, id: 1, created_at: '2026-10-23T10:00:00', updated_at: '2026-10-23T10:00:00' }
      tasks = [created]
      return { ok: true, status: 201, json: async () => created } as Response
    }
    if (path === '/api/tasks/1' && method === 'PATCH') {
      tasks = tasks.map((task) => ({ ...task, ...JSON.parse(String(init?.body)) }))
      return { ok: true, json: async () => tasks[0] } as Response
    }
    if (path === '/api/tasks/1' && method === 'DELETE') {
      tasks = []
      return { ok: true, status: 204 } as Response
    }
    throw new Error(`Unexpected API request: ${method} ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('study planner', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a saved task and lets the student complete and delete it', async () => {
    const fetchMock = installTaskApiMock()
    render(<PlannerPage onNavigate={vi.fn()} />)
    expect(await screen.findByText('Your planner is ready for its first task')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add your first task' }))
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Finish circuits assignment' } })
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Circuit Theory' } })
    fireEvent.change(screen.getByLabelText('Task type'), { target: { value: 'assignment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByRole('heading', { name: 'Finish circuits assignment' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'POST' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Finish circuits assignment' }))
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Submit circuits assignment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('heading', { name: 'Submit circuits assignment' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark Submit circuits assignment complete' }))
    expect(await screen.findByText('Task marked complete.')).toBeInTheDocument()
    expect(await screen.findByText('Completed', { selector: '.status-badge' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Submit circuits assignment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(screen.getByText('Your planner is ready for its first task')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/1', expect.objectContaining({ method: 'DELETE' }))
  })
})
