# Smart Education Assistant

A modular academic productivity app for Vignan University B.Tech students and students across engineering branches. Academic templates are configurable; examples are not represented as official Vignan syllabus data.

## Features

- Dashboard and study planner backed by SQLite, including task status, priority, deadlines, estimates, and schedule overlap checks.
- Student profile with editable academic details, subjects, exam dates, and available study hours.
- Study Sources library with bounded PDF, DOCX, and TXT uploads, safe generated storage names, extraction status, title/subject/text search, document details, multi-source selection, and deletion.
- Chunk-indexed local retrieval-augmented generation (RAG) that returns source references and PDF page numbers when available. Retrieval uses local keyword overlap and does not require a paid embedding service. Scanned PDFs are marked as needing OCR.
- AI Study Studio with source-grounded chat, short/detailed summaries, key concepts, generated multiple-choice quizzes with scoring, interactive flashcards, topic explanations, practice questions, evidence-based important topics, 2/5/10-mark exam answers, revision notes, and saved revision-plan progress.
- Study assistant with locally persisted conversations, a local Ollama model, bounded note/planner/web tool selection, and recent conversation context. The app never substitutes canned answers when the model is unavailable.
- Ollama's local chat API is called only by the backend. Provider, base URL, model, and timeout are configured on the backend; no model credentials or API endpoint are sent to the frontend.
- Optional current web research through Tavily. Set `TAVILY_API_KEY`; genuine result URLs are displayed as citations. The app does not claim current web research when search is unavailable.
- Rule-based recommendations derived from open tasks and configured exam dates, with task creation actions.

No sample academic records or fabricated progress statistics are included. A new workspace starts empty. Generated content requires the configured model and is never replaced with mock responses.

## Requirements

- Node.js 20 or later and pnpm 9 or later
- Python 3.11 or later

## Run locally

```sh
# Download the local model once (start Ollama first)
ollama pull llama3.2

# Backend (terminal 1, from the repository root)
test -f .env || cp .env.example .env  # Keeps any existing .env and secrets intact
nano .env  # Optional: configure LLM_PROVIDER, LLM_BASE_URL, LLM_MODEL, and LLM_TIMEOUT_SECONDS
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
```

```sh
# Frontend (terminal 2)
cd frontend
pnpm install
pnpm dev
```

The frontend runs at `http://localhost:5173`; the API and interactive API docs run at `http://localhost:8000` and `http://localhost:8000/docs`.

The first backend startup creates missing SQLite tables. This additive upgrade adds `note_chunks` for indexed source passages and `revision_plans` for saved study schedules; existing notes, conversations, tasks, and profile records remain intact. Migration `0002_study_studio` is available for databases already tracked at Alembic revision `0001_create_tasks`; the app's existing `create_all` startup also creates the new tables for local databases. By default the backend connects to Ollama at `http://localhost:11434` and uses `llama3.2`; no paid API key is needed. Ollama must be running and the model must be downloaded with `ollama pull llama3.2`. If needed, set `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_TIMEOUT_SECONDS` in the repository-root `.env`, then restart FastAPI. The optional `huggingface` provider requires `HF_TOKEN` and can be selected with `LLM_PROVIDER=huggingface`; it uses `HF_MODEL`. Uploaded files are stored under `./data/uploads` by default, with a configurable 20 MB maximum (`MAX_UPLOAD_BYTES`). DOCX and TXT extraction uses Python's standard library; PDF extraction uses `pypdf`. No additional dependency was added. Never commit `.env`, local databases, or uploaded/private documents.

### AI Study Studio API

- `POST /api/notes` accepts PDF, DOCX, and UTF-8 TXT files. `GET /api/notes` lists documents and `DELETE /api/notes/{id}` removes a document and its extracted text/chunks.
- `POST /api/study/generate` accepts an action (`ask`, `summary`, `detailed_summary`, `key_concepts`, `quiz`, `flashcards`, `explain`, `practice_questions`, `important_topics`, `exam_answer`, or `revision_notes`) and selected document IDs where applicable. All model calls remain on FastAPI.
- `GET/POST /api/study/plans` lists and creates revision plans. `PATCH /api/study/plans/{id}/sessions/{index}` persists completion state.

Document text is chunked and retrieved locally by keyword overlap; no embedding model is configured in this project. Scanned PDF OCR and background ingestion are not included, so extraction runs synchronously and scanned PDFs remain marked as needing OCR. Summaries and structured study content use the configured LLM and return clear errors when it is unavailable.

## Verify

```sh
cd frontend && pnpm build && pnpm test
cd .. && python3 -m pytest backend/tests
```

The backend forwards bounded recent conversation history and selects note retrieval or planner context by intent. Current-information questions additionally require `TAVILY_API_KEY`; ordinary AI questions do not. Missing search credentials or failed model calls return actionable errors without invented answers. Tavily returns source URLs and snippets for citations ([Tavily API overview](https://help.tavily.com/articles/4840311948-tavily-search-api)).
