from datetime import date, timedelta
from types import SimpleNamespace

import httpx


def _configured_settings():
    return SimpleNamespace(
        hf_token="test-secret", hf_model="campusly-test",
        llm_timeout_seconds=9, tavily_api_key=None, search_timeout_seconds=7,
    )


def test_profile_persists_subjects_and_exam_dates(api_request):
    payload = {
        "name": "A Student", "university": "Example University", "college": "Engineering",
        "degree": "B.Tech", "branch": "CSE", "academic_year": "2", "semester": "3",
        "subjects": ["Data Structures", "Mathematics"], "exam_dates": [{"subject": "Mathematics", "date": "2026-12-10"}],
        "weekly_study_hours": 12,
    }
    saved = api_request("PUT", "/api/profile", json=payload)
    assert saved.status_code == 200
    assert saved.json()["subjects"] == payload["subjects"]
    assert api_request("GET", "/api/profile").json()["exam_dates"] == payload["exam_dates"]


def test_missing_ai_configuration_is_actionable_and_never_simulates_an_answer(api_request, monkeypatch):
    from backend.app.api import academic

    missing = SimpleNamespace(hf_token=None, hf_model="openai/gpt-oss-120b", tavily_api_key=None)
    monkeypatch.setattr(academic, "get_settings", lambda: missing)
    status = api_request("GET", "/api/assistant/status").json()
    assert status["configured"] is False
    assert status["missing_configuration"] == ["HF_TOKEN"]

    response = api_request("POST", "/api/assistant/ask", json={"question": "Hi"})
    assert response.status_code == 503
    assert "No AI answer was generated" in response.json()["detail"]
    assert "repository-root .env" in response.json()["detail"]
    assert api_request("GET", "/api/conversations").json() == []


def test_configured_ai_answers_greeting_and_receives_follow_up_history(api_request, monkeypatch):
    from backend.app.api import academic

    class Provider:
        mode = "configured_ai"
        received_history = []

        def answer(self, question, passages, history=None, academic_context="", web_results=None):
            self.received_history = history or []
            return "Hello! Let’s work through that together." if question == "Hi" else "Here is a simpler explanation using the previous question."

    provider = Provider()
    monkeypatch.setattr(academic, "get_settings", _configured_settings)
    monkeypatch.setattr(academic, "get_assistant_provider", lambda _settings: provider)
    first = api_request("POST", "/api/assistant/ask", json={"question": "Hi"}).json()
    second = api_request("POST", "/api/assistant/ask", json={
        "question": "Explain that more simply", "conversation_id": first["conversation_id"],
    }).json()

    assert first["mode"] == "configured_ai"
    assert first["answer"].startswith("Hello!")
    assert second["answer"].startswith("Here is a simpler")
    assert provider.received_history[0] == {"role": "user", "content": "Hi"}
    history = api_request("GET", f"/api/conversations/{first['conversation_id']}").json()["messages"]
    assert [message["role"] for message in history] == ["user", "assistant", "user", "assistant"]


def test_huggingface_provider_sends_secret_history_and_bounded_context(monkeypatch):
    from backend.app.core import assistant_provider

    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": "A concise model answer."}}]}

    class Client:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers, json):
            captured.update(url=url, headers=headers, body=json)
            return Response()

    monkeypatch.setattr(assistant_provider.httpx, "Client", Client)
    provider = assistant_provider.HuggingFaceInferenceProvider("private-token", "model-x", timeout=11)
    answer = provider.answer(
        "Explain that more simply", [], history=[{"role": "user", "content": "Explain pandas"}],
        academic_context="Saved subject: Data Science",
    )
    assert answer == "A concise model answer."
    assert captured["url"] == "https://router.huggingface.co/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer private-token"
    assert captured["body"]["model"] == "model-x"
    assert captured["body"]["messages"][1] == {"role": "user", "content": "Explain pandas"}
    assert "Saved subject: Data Science" in captured["body"]["messages"][-1]["content"]
    assert captured["timeout"] == 11


def test_ollama_provider_uses_configured_local_chat_api_and_preserves_context(monkeypatch):
    from backend.app.core import assistant_provider

    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"message": {"content": "A local model answer."}}

    class Client:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, json):
            captured.update(url=url, body=json)
            return Response()

    monkeypatch.setattr(assistant_provider.httpx, "Client", Client)
    provider = assistant_provider.OllamaProvider("http://localhost:11434/", "llama3.2", timeout=13)
    answer = provider.answer(
        "Explain that simply", [], history=[{"role": "user", "content": "Explain recursion"}],
        academic_context="Saved subject: Computer Science",
    )

    assert answer == "A local model answer."
    assert captured["url"] == "http://localhost:11434/api/chat"
    assert captured["body"]["model"] == "llama3.2"
    assert captured["body"]["stream"] is False
    assert captured["body"]["messages"][1] == {"role": "user", "content": "Explain recursion"}
    assert "Saved subject: Computer Science" in captured["body"]["messages"][-1]["content"]
    assert captured["timeout"] == 13


def test_ollama_unavailable_returns_actionable_error_without_saving_turn(api_request, monkeypatch):
    from backend.app.api import academic
    from backend.app.core import assistant_provider

    settings = SimpleNamespace(
        llm_provider="ollama", llm_base_url="http://localhost:11434", llm_model="llama3.2",
        llm_timeout_seconds=3, tavily_api_key=None, search_timeout_seconds=7,
    )

    class Client:
        def __init__(self, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(academic, "get_settings", lambda: settings)
    monkeypatch.setattr(assistant_provider.httpx, "Client", Client)
    response = api_request("POST", "/api/assistant/ask", json={"question": "Explain recursion"})

    assert response.status_code == 502
    assert "Start Ollama" in response.json()["detail"]
    assert "ollama pull llama3.2" in response.json()["detail"]
    assert "localhost" not in response.json()["detail"]
    assert api_request("GET", "/api/conversations").json() == []


def test_planner_tool_uses_saved_profile_and_real_open_tasks(api_request, monkeypatch):
    from backend.app.api import academic

    class Provider:
        mode = "configured_ai"
        context = ""

        def answer(self, question, passages, history=None, academic_context="", web_results=None):
            self.context = academic_context
            return "Plan based on the saved semester data."

    provider = Provider()
    monkeypatch.setattr(academic, "get_settings", _configured_settings)
    monkeypatch.setattr(academic, "get_assistant_provider", lambda _settings: provider)
    api_request("PUT", "/api/profile", json={
        "degree": "B.Tech", "branch": "Computer Science", "academic_year": "2", "semester": "4",
        "subjects": ["Data Structures"], "exam_dates": [{"subject": "Data Structures", "date": (date.today() + timedelta(days=10)).isoformat()}],
        "weekly_study_hours": 8,
    })
    api_request("POST", "/api/tasks", json={
        "title": "Revise trees", "subject": "Data Structures", "task_type": "revision",
        "due_date": (date.today() + timedelta(days=3)).isoformat(), "estimated_minutes": 45, "priority": "high",
    })
    response = api_request("POST", "/api/assistant/ask", json={"question": "Make me a study plan for my next exam"})
    assert response.status_code == 200
    assert response.json()["tools_used"] == ["planner"]
    assert "Revise trees" in provider.context
    assert "Data Structures" in provider.context
    assert "8 hours/week" in provider.context


def test_ordinary_academic_question_does_not_need_tavily(api_request, monkeypatch):
    from backend.app.api import academic

    class Provider:
        mode = "configured_ai"

        def answer(self, question, passages, history=None, academic_context="", web_results=None):
            assert question == "What is pandas?"
            assert web_results == []
            return "Pandas is a Python library for data analysis, with DataFrame and Series objects."

    monkeypatch.setattr(academic, "get_settings", _configured_settings)
    monkeypatch.setattr(academic, "get_assistant_provider", lambda _settings: Provider())
    monkeypatch.setattr(academic, "get_search_provider", lambda _settings: None)
    response = api_request("POST", "/api/assistant/ask", json={"question": "What is pandas?"})
    assert response.status_code == 200
    assert response.json()["tools_used"] == []
    assert "DataFrame" in response.json()["answer"]


def test_current_question_requires_sources_instead_of_guessing(api_request, monkeypatch):
    from backend.app.api import academic

    monkeypatch.setattr(academic, "get_settings", _configured_settings)
    monkeypatch.setattr(academic, "get_assistant_provider", lambda _settings: object())
    monkeypatch.setattr(academic, "get_search_provider", lambda _settings: None)
    response = api_request("POST", "/api/assistant/ask", json={"question": "What is the latest Python release?"})
    assert response.status_code == 503
    assert "TAVILY_API_KEY" in response.json()["detail"]
    assert "Ordinary academic questions do not need Tavily" in response.json()["detail"]


def test_provider_failures_are_returned_without_fake_responses_or_saved_turns(api_request, monkeypatch):
    from backend.app.api import academic

    class BrokenProvider:
        mode = "configured_ai"

        def answer(self, *args, **kwargs):
            raise RuntimeError("The AI provider timed out.")

    monkeypatch.setattr(academic, "get_settings", _configured_settings)
    monkeypatch.setattr(academic, "get_assistant_provider", lambda _settings: BrokenProvider())
    response = api_request("POST", "/api/assistant/ask", json={"question": "Explain quantum entanglement"})
    assert response.status_code == 502
    assert response.json()["detail"] == "The AI provider timed out."
    assert api_request("GET", "/api/conversations").json() == []



def test_note_tool_retrieves_and_cites_real_uploaded_passage(api_request, monkeypatch, tmp_path):
    from backend.app.api import academic

    class FakePage:
        def extract_text(self):
            return "Binary search examines the middle element of a sorted array and discards half of the remaining values each step."

    class FakeReader:
        is_encrypted = False
        pages = [FakePage()]

        def __init__(self, *args, **kwargs):
            pass

    class Provider:
        mode = "configured_ai"
        passages = []

        def answer(self, question, passages, history=None, academic_context="", web_results=None):
            self.passages = passages
            return "Your notes say binary search repeatedly halves a sorted search range. (Lecture 4, page 1)"

    provider = Provider()
    settings = SimpleNamespace(
        hf_token="test-secret", hf_model="test",
        llm_timeout_seconds=10, tavily_api_key=None, search_timeout_seconds=10,
        upload_dir=str(tmp_path), max_upload_bytes=1_000_000,
    )
    monkeypatch.setattr(academic, "get_settings", lambda: settings)
    monkeypatch.setattr(academic, "get_assistant_provider", lambda _settings: provider)
    monkeypatch.setattr(academic, "PdfReader", FakeReader)
    uploaded = api_request("POST", "/api/notes", files={"file": ("lecture.pdf", b"%PDF-test", "application/pdf")}, data={"title": "Lecture 4", "subject": "Algorithms"})
    assert uploaded.status_code == 201
    local_search = api_request("POST", "/api/notes/search", json={"question": "binary search sorted array"})
    assert local_search.status_code == 200
    assert local_search.json()["mode"] == "local_notes_retrieval"
    assert local_search.json()["citations"][0]["document_name"] == "Lecture 4"
    result = api_request("POST", "/api/assistant/ask", json={"question": "Explain binary search in my notes"})
    assert result.status_code == 200
    assert result.json()["tools_used"] == ["notes"]
    assert provider.passages[0]["document_name"] == "Lecture 4"
    assert provider.passages[0]["page_number"] == 1
    assert result.json()["citations"][0]["document_name"] == "Lecture 4"
    conversation = api_request("GET", f"/api/conversations/{result.json()['conversation_id']}").json()
    assert conversation["messages"][-1]["citations"][0]["document_name"] == "Lecture 4"


def test_web_tool_passes_real_bounded_sources_to_model(api_request, monkeypatch):
    from backend.app.api import academic

    source = {"title": "Official Python release", "url": "https://python.org/releases/", "snippet": "Release details from the official site."}

    class Search:
        def search(self, query):
            assert "latest" in query.lower()
            return [source]

    class Provider:
        mode = "configured_ai"
        web_results = None

        def answer(self, question, passages, history=None, academic_context="", web_results=None):
            self.web_results = web_results
            return "The current release information is in [1]."

    provider = Provider()
    monkeypatch.setattr(academic, "get_settings", _configured_settings)
    monkeypatch.setattr(academic, "get_assistant_provider", lambda _settings: provider)
    monkeypatch.setattr(academic, "get_search_provider", lambda _settings: Search())
    result = api_request("POST", "/api/assistant/ask", json={"question": "What is the latest Python release?"})
    assert result.status_code == 200
    assert result.json()["tools_used"] == ["web_search"]
    assert provider.web_results == [source]
    assert result.json()["web_citations"] == [source]

def test_recommendations_only_use_saved_urgent_data(api_request):
    due = (date.today() + timedelta(days=2)).isoformat()
    task = api_request("POST", "/api/tasks", json={
        "title": "Review linked lists", "subject": "Data Structures", "task_type": "revision",
        "due_date": due, "estimated_minutes": 60, "priority": "normal",
    })
    assert task.status_code == 201
    result = api_request("GET", "/api/recommendations").json()
    assert result["items"][0]["subject"] == "Data Structures"
    assert result["items"][0]["reason"] == "Due in 2 day(s) with normal priority."


def test_upload_rejects_a_non_pdf_without_storing_it(api_request):
    response = api_request("POST", "/api/notes", files={"file": ("notes.pdf", b"not a PDF", "application/pdf")})
    assert response.status_code == 400
    assert response.json()["detail"] == "This file does not contain a valid PDF header."
