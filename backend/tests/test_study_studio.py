from datetime import date, timedelta
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile


def _settings(upload_dir):
    return SimpleNamespace(
        llm_provider="ollama", llm_base_url="http://localhost:11434", llm_model="llama3.2",
        llm_timeout_seconds=5, upload_dir=str(upload_dir), max_upload_bytes=1_000_000,
    )


def _docx(text: str) -> bytes:
    document_xml = (
        "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
        "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body>"
        f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>"
        "</w:body></w:document>"
    )
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document_xml)
    return buffer.getvalue()


def _upload_text(api_request, monkeypatch, tmp_path, content=b"Photosynthesis converts light energy into chemical energy in plants using chlorophyll."):
    from backend.app.api import academic

    monkeypatch.setattr(academic, "get_settings", lambda: _settings(tmp_path))
    return api_request("POST", "/api/notes", files={"file": ("photosynthesis.txt", content, "text/plain")})


def test_docx_upload_extracts_and_indexes_text_without_fake_page_numbers(api_request, monkeypatch, tmp_path):
    from backend.app.api import academic

    monkeypatch.setattr(academic, "get_settings", lambda: _settings(tmp_path))
    uploaded = api_request("POST", "/api/notes", files={
        "file": ("lecture.docx", _docx("Newton's first law describes inertia. A net force changes the motion of an object."),
                 "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    })
    assert uploaded.status_code == 201
    assert uploaded.json()["status"] == "ready"
    assert uploaded.json()["file_type"] == "DOCX"
    assert uploaded.json()["size_bytes"] > 0
    detail = api_request("GET", f"/api/notes/{uploaded.json()['id']}").json()
    assert detail["pages"][0]["page_number"] is None
    assert "inertia" in detail["pages"][0]["text"].lower()
    found = api_request("POST", "/api/notes/search", json={"question": "Newton inertia force"}).json()
    assert found["citations"][0]["document_name"] == "lecture"
    assert found["citations"][0]["page_number"] is None


def test_smart_quiz_uses_selected_source_and_returns_valid_scored_questions(api_request, monkeypatch, tmp_path):
    from backend.app.api import academic, study

    uploaded = _upload_text(api_request, monkeypatch, tmp_path)
    assert uploaded.status_code == 201

    class Provider:
        mode = "configured_ai"
        received_passages = []

        def answer(self, question, passages, history=None, academic_context="", web_results=None):
            self.received_passages = passages
            return '{"questions":[{"question":"What does photosynthesis convert?","options":["Light to chemical energy","Water to oxygen","Sugar to light"],"answer_index":0,"explanation":"Light energy is stored as chemical energy."}]}'

    provider = Provider()
    monkeypatch.setattr(study, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(study, "get_assistant_provider", lambda _settings: provider)
    generated = api_request("POST", "/api/study/generate", json={
        "action": "quiz", "document_ids": [uploaded.json()["id"]], "count": 3,
    })
    assert generated.status_code == 200
    assert generated.json()["items"][0]["answer_index"] == 0
    assert generated.json()["citations"][0]["document_name"] == "photosynthesis"
    assert "chlorophyll" in provider.received_passages[0]["excerpt"]


def test_document_question_without_matching_source_does_not_call_the_model(api_request, monkeypatch, tmp_path):
    from backend.app.api import study

    uploaded = _upload_text(api_request, monkeypatch, tmp_path)

    class Provider:
        called = False

        def answer(self, *args, **kwargs):
            self.called = True
            return "unsupported answer"

    provider = Provider()
    monkeypatch.setattr(study, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(study, "get_assistant_provider", lambda _settings: provider)
    response = api_request("POST", "/api/study/generate", json={
        "action": "ask", "question": "Explain quantum entanglement", "document_ids": [uploaded.json()["id"]],
    })
    assert response.status_code == 200
    assert response.json()["mode"] == "no_matching_source"
    assert response.json()["citations"] == []
    assert provider.called is False


def test_revision_plan_and_completion_progress_persist(api_request, monkeypatch, tmp_path):
    from backend.app.api import study

    uploaded = _upload_text(api_request, monkeypatch, tmp_path)

    class Provider:
        def answer(self, *args, **kwargs):
            return '{"topics":[{"topic":"Light reactions","reason":"Repeatedly emphasized in the source."},{"topic":"Chlorophyll","reason":"Defined directly in the source."}]}'

    monkeypatch.setattr(study, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(study, "get_assistant_provider", lambda _settings: Provider())
    created = api_request("POST", "/api/study/plans", json={
        "title": "Biology revision", "exam_date": (date.today() + timedelta(days=5)).isoformat(),
        "minutes_per_day": 45, "document_ids": [uploaded.json()["id"]],
    })
    assert created.status_code == 201
    assert len(created.json()["sessions"]) == 2
    changed = api_request("PATCH", f"/api/study/plans/{created.json()['id']}/sessions/0", json={"completed": True})
    assert changed.status_code == 200
    assert changed.json()["sessions"][0]["completed"] is True
    assert api_request("GET", "/api/study/plans").json()[0]["sessions"][0]["completed"] is True


def test_corrupt_docx_upload_returns_actionable_validation_error(api_request, monkeypatch, tmp_path):
    from backend.app.api import academic

    monkeypatch.setattr(academic, "get_settings", lambda: _settings(tmp_path))
    response = api_request("POST", "/api/notes", files={"file": ("broken.docx", b"not a word document", "application/octet-stream")})
    assert response.status_code == 400
    assert "corrupted" in response.json()["detail"].lower()


def test_exam_answer_passes_the_requested_mark_structure_to_the_existing_model(api_request, monkeypatch, tmp_path):
    from backend.app.api import study

    class Provider:
        prompts = []
        mode = "ollama"

        def answer(self, question, passages, history=None, academic_context="", web_results=None):
            self.prompts.append(question)
            return "A structured answer in the requested length."

    provider = Provider()
    monkeypatch.setattr(study, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(study, "get_assistant_provider", lambda _settings: provider)
    for mark_format in (2, 5, 10):
        response = api_request("POST", "/api/study/generate", json={
            "action": "exam_answer", "question": "Define photosynthesis", "mark_format": mark_format,
        })
        assert response.status_code == 200
        assert response.json()["content"] == "A structured answer in the requested length."
    assert ["2-mark", "5-mark", "10-mark"] == [
        next(marker for marker in ("2-mark", "5-mark", "10-mark") if marker in prompt)
        for prompt in provider.prompts
    ]
