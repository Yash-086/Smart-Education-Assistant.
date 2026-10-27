import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExamPreparationPage, SmartLearningPage } from './StudyStudioPages'

const source = { id: 4, title: 'Biology Lecture', filename: 'bio.txt', subject: 'Biology', status: 'ready', status_message: 'Text extracted and indexed.' }

function response(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AI Study Studio interactions', () => {
  it('generates a source-grounded quiz, scores answers, and restarts', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/notes') return response([source])
      if (String(input) === '/api/study/generate') return response({
        action: 'quiz', content: '', citations: [{ document_id: 4, document_name: 'Biology Lecture', page_number: null, excerpt: 'source' }],
        items: [{ question: 'What converts light energy?', options: ['Photosynthesis', 'Respiration'], answer_index: 0, explanation: 'Photosynthesis stores light energy.' }],
      })
      return response({ detail: 'Unexpected request' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SmartLearningPage />)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Biology Lecture' }))
    fireEvent.click(screen.getByRole('button', { name: /generate smart quiz/i }))
    expect(await screen.findByText(/What converts light energy/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Photosynthesis' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }))
    expect(await screen.findByText('Score 1 / 1')).toBeInTheDocument()
    expect(screen.getByText('Photosynthesis stores light energy.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /restart quiz/i }))
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled()

    const request = fetchMock.mock.calls.find(([url]) => String(url) === '/api/study/generate')
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ action: 'quiz', document_ids: [4] })
  })

  it('flips, advances, and marks flashcards for review', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/notes') return response([source])
      if (String(input) === '/api/study/generate') return response({ action: 'flashcards', content: '', citations: [], items: [
        { front: 'Define chlorophyll', back: 'The green pigment that absorbs light.' },
        { front: 'What is a chloroplast?', back: 'The organelle where photosynthesis occurs.' },
      ] })
      return response({ detail: 'Unexpected request' }, 404)
    }))
    render(<SmartLearningPage />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Biology Lecture' }))
    fireEvent.click(screen.getByRole('button', { name: /create flashcards/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal answer' }))
    expect(screen.getByText('The green pigment that absorbs light.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Needs revision' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Card 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('What is a chloroplast?')).toBeInTheDocument()
  })

  it('saves a revision plan and persists completed sessions through the API', async () => {
    const plan = { id: 8, title: 'Exam revision plan', exam_date: '2027-01-10', minutes_per_day: 45, sessions: [{ date: '2026-12-30', topic: 'Light reactions', reason: 'A repeated concept.', minutes: 45, completed: false }] }
    let savedPlans: typeof plan[] = []
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/notes') return response([source])
      if (url === '/api/study/plans' && (!init?.method || init.method === 'GET')) return response(savedPlans)
      if (url === '/api/study/plans' && init?.method === 'POST') { savedPlans = [plan]; return response(plan, 201) }
      if (url === '/api/study/plans/8/sessions/0') { const updated = { ...plan, sessions: [{ ...plan.sessions[0], completed: true }] }; savedPlans = [updated]; return response(updated) }
      return response({ detail: 'Unexpected request' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ExamPreparationPage />)
    fireEvent.click((await screen.findAllByRole('checkbox', { name: 'Biology Lecture' }))[0])
    fireEvent.click(screen.getByRole('button', { name: 'Generate revision plan' }))
    const session = await screen.findByRole('checkbox', { name: /light reactions/i })
    fireEvent.click(session)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/study/plans/8/sessions/0', expect.objectContaining({ method: 'PATCH' })))
  })
})
