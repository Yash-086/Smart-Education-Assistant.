import json
import re
import uuid
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
try:
    from pypdf import PdfReader
except ImportError:  # Keep health/profile features usable before dependencies are installed.
    PdfReader = None
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.core.documents import extract_docx, extract_txt, split_text
from backend.app.core.assistant_provider import (
    get_assistant_provider,
    get_search_provider,
    missing_ai_configuration,
)
from backend.app.core.agent_tools import (
    select_tools,
)
from backend.app.db.session import get_db
from backend.app.models.academic import Conversation, ConversationMessage, NoteChunk, NoteDocument, NotePage, StudentProfile
from backend.app.models.task import Task

router = APIRouter(prefix="/api", tags=["academic workspace"])


class ProfileInput(BaseModel):
    name: str = Field(default="", max_length=120)
    university: str = Field(default="", max_length=160)
    college: str = Field(default="", max_length=160)
    degree: str = Field(default="", max_length=120)
    branch: str = Field(default="", max_length=120)
    academic_year: str = Field(default="", max_length=40)
    semester: str = Field(default="", max_length=40)
    subjects: list[str] = Field(default_factory=list, max_length=40)
    exam_dates: list[dict] = Field(default_factory=list, max_length=100)
    weekly_study_hours: int = Field(default=10, ge=0, le=100)


class AskInput(BaseModel):
    question: str = Field(min_length=1, max_length=3000)
    conversation_id: int | None = None
    document_ids: list[int] | None = Field(default=None, max_length=10)
    companion_mode: bool = False


class NoteSearchInput(BaseModel):
    question: str = Field(min_length=1, max_length=3000)
    document_ids: list[int] | None = Field(default=None, max_length=10)


def profile_read(profile: StudentProfile) -> dict:
    return {"id": profile.id, "name": profile.name, "university": profile.university, "college": profile.college,
            "degree": profile.degree, "branch": profile.branch, "academic_year": profile.academic_year,
            "semester": profile.semester, "subjects": json.loads(profile.subjects_json),
            "exam_dates": json.loads(profile.exams_json), "weekly_study_hours": profile.weekly_study_hours,
            "updated_at": profile.updated_at}


@router.get("/profile")
def get_profile(db: Session = Depends(get_db)):
    profile = db.get(StudentProfile, 1)
    if profile is None:
        profile = StudentProfile(id=1)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile_read(profile)


@router.put("/profile")
def save_profile(payload: ProfileInput, db: Session = Depends(get_db)):
    profile = db.get(StudentProfile, 1) or StudentProfile(id=1)
    for key in ("name", "university", "college", "degree", "branch", "academic_year", "semester", "weekly_study_hours"):
        setattr(profile, key, getattr(payload, key))
    profile.subjects_json = json.dumps([s.strip() for s in payload.subjects if s.strip()])
    profile.exams_json = json.dumps(payload.exam_dates)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile_read(profile)


def _doc_read(doc: NoteDocument) -> dict:
    path = Path(get_settings().upload_dir).resolve() / doc.storage_key
    return {"id": doc.id, "title": doc.title, "subject": doc.subject, "filename": doc.original_name,
            "status": doc.status, "status_message": doc.status_message, "page_count": doc.page_count,
            "file_type": Path(doc.original_name).suffix.lstrip(".").upper(),
            "size_bytes": path.stat().st_size if path.is_file() else 0,
            "created_at": doc.created_at}


@router.get("/notes")
def list_notes(q: str = "", db: Session = Depends(get_db)):
    query = select(NoteDocument).order_by(NoteDocument.created_at.desc())
    if q.strip():
        term = f"%{q.strip()}%"
        query = query.where(NoteDocument.title.ilike(term) | NoteDocument.subject.ilike(term) | NoteDocument.original_name.ilike(term))
    docs = list(db.scalars(query))
    if q.strip():
        page_matches = set(db.scalars(select(NotePage.document_id).where(NotePage.text.ilike(f"%{q.strip()}%"))).all())
        docs.extend(d for d in db.scalars(select(NoteDocument).order_by(NoteDocument.created_at.desc())) if d.id in page_matches and d.id not in {x.id for x in docs})
    return [_doc_read(doc) for doc in docs]


@router.post("/notes", status_code=201)
async def upload_note(file: UploadFile = File(...), title: str = Form(""), subject: str = Form(""), db: Session = Depends(get_db)):
    filename = Path(file.filename or "study-material.txt").name[:255]
    extension = Path(filename).suffix.lower()
    if extension not in (".pdf", ".docx", ".txt"):
        raise HTTPException(415, "Supported study materials are PDF, DOCX, and TXT files.")
    settings = get_settings()
    key = f"{uuid.uuid4().hex}{extension}"
    folder = Path(get_settings().upload_dir).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / key
    size = 0
    with target.open("wb") as output:
        while block := await file.read(64 * 1024):
            size += len(block)
            if size > settings.max_upload_bytes:
                target.unlink(missing_ok=True)
                raise HTTPException(413, f"Files must be {settings.max_upload_bytes // (1024 * 1024)} MB or smaller.")
            output.write(block)
    if size == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(400, "The selected file is empty.")
    with target.open("rb") as uploaded_stream:
        header = uploaded_stream.read(5)
    if extension == ".pdf" and header != b"%PDF-":
        target.unlink(missing_ok=True)
        raise HTTPException(400, "This file does not contain a valid PDF header.")
    if extension == ".docx":
        import zipfile
        if not zipfile.is_zipfile(target):
            target.unlink(missing_ok=True)
            raise HTTPException(400, "This DOCX file is corrupted or could not be read. Re-export it and try again.")
    safe_title = (title.strip() or Path(filename).stem)[:240]
    safe_subject = (subject.strip() or "Uncategorized")[:120]
    doc = NoteDocument(title=safe_title, subject=safe_subject, original_name=filename, storage_key=key, status="processing")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    try:
        extracted_pages: list[tuple[int | None, str]] = []
        if extension == ".pdf":
            if PdfReader is None:
                raise RuntimeError("PDF reader dependency is not installed.")
            reader = PdfReader(str(target), strict=False)
            if reader.is_encrypted:
                raise ValueError("This PDF is password protected.")
            doc.page_count = len(reader.pages)
            extracted_pages = [(number, (page.extract_text() or "").strip()) for number, page in enumerate(reader.pages, start=1)]
        elif extension == ".docx":
            extracted_pages = [(None, extract_docx(target, max_xml_bytes=settings.max_upload_bytes * 3))]
        else:
            extracted_pages = [(None, extract_txt(target))]
        readable_pages = [(number, text[:100_000]) for number, text in extracted_pages if text.strip()]
        if readable_pages:
            db.add_all([NotePage(document_id=doc.id, page_number=number or 0, text=text) for number, text in readable_pages])
            chunks = []
            for page_number, text in readable_pages:
                chunks.extend(NoteChunk(document_id=doc.id, page_number=page_number, chunk_index=index, text=chunk)
                              for index, chunk in enumerate(split_text(text)))
            db.add_all(chunks)
            doc.status = "ready"
            if extension == ".pdf":
                doc.status_message = f"Text extracted and indexed from {len(readable_pages)} page(s)."
            else:
                doc.status_message = f"Text extracted and indexed from {len(chunks)} searchable section(s)."
        elif extension == ".pdf":
            doc.status = "needs_ocr"
            doc.status_message = "No selectable text was found. This may be a scanned PDF; OCR is required to search its contents."
        else:
            doc.status = "error"
            doc.status_message = "No readable text was found in this file. Check that it contains selectable text and try again."
        db.commit()
    except ValueError as error:
        db.rollback()
        target.unlink(missing_ok=True)
        failed_upload = db.get(NoteDocument, doc.id)
        if failed_upload:
            db.delete(failed_upload)
            db.commit()
        raise HTTPException(400, str(error)) from error
    except Exception:
        db.rollback()
        doc = db.get(NoteDocument, doc.id)
        if doc:
            doc.status = "error"
            doc.status_message = "The PDF could not be read. Check that the PDF reader dependency is installed, then try exporting or downloading it again."
            db.commit()
    return _doc_read(doc)


@router.get("/notes/{document_id}")
def get_note(document_id: int, db: Session = Depends(get_db)):
    doc = db.get(NoteDocument, document_id)
    if not doc:
        raise HTTPException(404, "Document not found.")
    pages = list(db.scalars(select(NotePage).where(NotePage.document_id == document_id).order_by(NotePage.page_number)))
    return {**_doc_read(doc), "pages": [{"page_number": p.page_number or None, "text": p.text} for p in pages]}


@router.delete("/notes/{document_id}", status_code=204)
def delete_note(document_id: int, db: Session = Depends(get_db)):
    doc = db.get(NoteDocument, document_id)
    if not doc:
        raise HTTPException(404, "Document not found.")
    (Path(get_settings().upload_dir).resolve() / doc.storage_key).unlink(missing_ok=True)
    db.query(NotePage).filter(NotePage.document_id == document_id).delete()
    db.query(NoteChunk).filter(NoteChunk.document_id == document_id).delete()
    db.delete(doc)
    db.commit()


WORD_RE = re.compile(r"[a-z0-9]{2,}", re.I)


def retrieve(question: str, db: Session, document_ids: list[int] | None = None, limit: int = 5) -> list[dict]:
    terms = {word.lower() for word in WORD_RE.findall(question)}
    query = select(NoteChunk, NoteDocument).join(NoteDocument, NoteDocument.id == NoteChunk.document_id).where(NoteDocument.status == "ready")
    if document_ids:
        query = query.where(NoteDocument.id.in_(document_ids))
    results = []
    indexed_document_ids: set[int] = set()
    for chunk, doc in db.execute(query):
        indexed_document_ids.add(doc.id)
        tokens = {word.lower() for word in WORD_RE.findall(chunk.text)}
        overlap = terms & tokens
        if not overlap:
            continue
        score = len(overlap) / max(1, len(terms))
        if score < 0.08:
            continue
        excerpt = chunk.text
        results.append({"document_id": doc.id, "document_name": doc.title, "subject": doc.subject,
                        "page_number": chunk.page_number, "excerpt": excerpt, "score": round(score, 3)})
    # Older documents predate chunk indexing; keep them searchable until re-uploaded.
    legacy_query = select(NotePage, NoteDocument).join(NoteDocument, NoteDocument.id == NotePage.document_id).where(NoteDocument.status == "ready")
    if indexed_document_ids:
        legacy_query = legacy_query.where(NoteDocument.id.not_in(indexed_document_ids))
    if document_ids:
        legacy_query = legacy_query.where(NoteDocument.id.in_(document_ids))
    for page, doc in db.execute(legacy_query):
        for chunk in split_text(page.text):
            tokens = {word.lower() for word in WORD_RE.findall(chunk)}
            overlap = terms & tokens
            if not overlap:
                continue
            score = len(overlap) / max(1, len(terms))
            if score < 0.08:
                continue
            results.append({"document_id": doc.id, "document_name": doc.title, "subject": doc.subject,
                            "page_number": page.page_number or None, "excerpt": chunk, "score": round(score, 3)})
    return sorted(results, key=lambda result: result["score"], reverse=True)[:limit]


@router.post("/notes/search")
def search_note_passages(payload: NoteSearchInput, db: Session = Depends(get_db)):
    """Keep local notes retrieval usable without implying it is a generated AI answer."""
    passages = retrieve(payload.question.strip(), db, payload.document_ids, limit=5)
    if passages:
        answer = f"Retrieved {len(passages)} matching passage(s) by local keyword search. This is source retrieval, not an AI-generated explanation."
    else:
        answer = "No relevant passage was found in your uploaded notes. Try different keywords or check that the document has selectable text."
    return {"answer": answer, "citations": passages, "mode": "local_notes_retrieval"}


def _message_read(message: ConversationMessage) -> dict:
    stored = json.loads(message.citations_json)
    if isinstance(stored, dict):  # New citations retain the pre-existing JSON column and old rows remain readable.
        note_citations = stored.get("notes", [])
        web_citations = stored.get("web", [])
    else:
        note_citations, web_citations = stored, []
    return {"id": message.id, "role": message.role, "content": message.content,
            "citations": note_citations, "web_citations": web_citations, "created_at": message.created_at}


def _recommendation_snapshot(db: Session, today: date) -> dict:
    tasks = list(db.scalars(select(Task).where(Task.status != "completed").order_by(Task.due_date)))
    all_tasks = list(db.scalars(select(Task)))
    subject_totals: dict[str, list[int]] = {}
    for task_item in all_tasks:
        counts = subject_totals.setdefault(task_item.subject, [0, 0])
        counts[0] += 1
        counts[1] += task_item.status == "completed"
    items = []
    for task in tasks:
        days = (task.due_date - today).days
        if days < 0:
            reason, priority = f"Overdue by {abs(days)} day(s); it is still marked {task.status.replace('_', ' ')}.", "urgent"
        elif days <= 3 or task.priority in ("urgent", "high"):
            reason, priority = f"Due in {days} day(s) with {task.priority} priority." if days >= 0 else "", "high" if days >= 0 else "urgent"
        else:
            continue
        total, completed = subject_totals.get(task.subject, [0, 0])
        progress_context = f" {completed} of {total} saved {task.subject} tasks are complete." if total > 1 else ""
        items.append({"task_id": task.id, "action": f"Work on {task.title}", "subject": task.subject,
                      "reason": reason + progress_context, "priority": priority, "suggested_minutes": task.estimated_minutes,
                      "task": {"title": task.title, "subject": task.subject, "due_date": task.due_date.isoformat(),
                               "estimated_minutes": task.estimated_minutes, "priority": task.priority}})
    profile = db.get(StudentProfile, 1)
    if profile:
        for exam in json.loads(profile.exams_json):
            try:
                exam_date = date.fromisoformat(exam.get("date", ""))
            except (ValueError, TypeError):
                continue
            if 0 <= (exam_date - today).days <= 14 and exam.get("subject"):
                days = (exam_date - today).days
                items.append({"action": f"Review for {exam['subject']}", "subject": exam["subject"],
                              "reason": f"Your configured exam date is in {days} day(s).", "priority": "high" if days <= 3 else "normal",
                              "suggested_minutes": min(45, max(15, int(profile.weekly_study_hours * 60 / 5))) if profile.weekly_study_hours else None,
                              "task": {"title": f"Review for {exam['subject']}", "subject": exam["subject"],
                                       "due_date": exam_date.isoformat(), "estimated_minutes": 45,
                                       "priority": "high" if days <= 3 else "normal"}})
    basis = "Rules use saved task deadlines, priorities, task completion counts by subject, and configured exam dates."
    if profile and profile.weekly_study_hours:
        basis += f" Exam session lengths use your configured {profile.weekly_study_hours} study hours per week."
    return {"items": items, "basis": basis + " No performance score is estimated."}


@router.get("/conversations")
def list_conversations(db: Session = Depends(get_db)):
    return [{"id": c.id, "title": c.title, "updated_at": c.updated_at} for c in db.scalars(select(Conversation).order_by(Conversation.updated_at.desc()))]


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    convo = db.get(Conversation, conversation_id)
    if not convo:
        raise HTTPException(404, "Conversation not found.")
    return {"id": convo.id, "title": convo.title,
            "messages": [_message_read(m) for m in db.scalars(select(ConversationMessage).where(ConversationMessage.conversation_id == conversation_id).order_by(ConversationMessage.id))]}


@router.post("/assistant/ask")
def ask_assistant(payload: AskInput, db: Session = Depends(get_db)):
    question = payload.question.strip()
    if not question:
        raise HTTPException(422, "Enter a question.")
    convo = db.get(Conversation, payload.conversation_id) if payload.conversation_id else None
    if payload.conversation_id and not convo:
        raise HTTPException(404, "Conversation not found.")

    settings = get_settings()
    missing = missing_ai_configuration(settings)
    if missing:
        raise HTTPException(
            503,
            f"Campusly AI is not configured. Add {', '.join(missing)} to the repository-root .env file, "
            "then restart FastAPI. Copy .env.example to .env for the template. No AI answer was generated.",
        )
    provider = get_assistant_provider(settings)
    if provider is None:
        raise HTTPException(503, "Campusly AI is not configured. Check the backend .env file and restart FastAPI.")

    prior_messages = []
    if convo:
        saved = list(db.scalars(select(ConversationMessage).where(
            ConversationMessage.conversation_id == convo.id
        ).order_by(ConversationMessage.id.desc()).limit(8)))
        prior_messages = [{"role": item.role, "content": item.content} for item in reversed(saved)]
    tool_plan = select_tools(question, prior_messages)

    retrieve_query = question
    if tool_plan.notes and not re.search(r"\b(notes?|uploaded|documents?|pdfs?|lecture|materials)\b", question, re.I):
        prior_note_query = next((
            item["content"] for item in reversed(prior_messages)
            if item.get("role") == "user" and isinstance(item.get("content"), str)
            and re.search(r"\b(notes?|uploaded|documents?|pdfs?|lecture|materials)\b", item["content"], re.I)
        ), "")
        if prior_note_query:
            retrieve_query = f"{prior_note_query} {question}"
    citations = retrieve(retrieve_query, db, payload.document_ids)[:5] if tool_plan.notes or payload.document_ids else []

    academic_context = ""
    if tool_plan.planner or payload.companion_mode:
        profile = db.get(StudentProfile, 1)
        today = date.today()
        context_lines = []
        exams = []
        if profile:
            for exam in json.loads(profile.exams_json):
                try:
                    exam_date = date.fromisoformat(exam.get("date", ""))
                except (ValueError, TypeError):
                    continue
                if exam_date >= today:
                    exams.append((exam_date, str(exam.get("subject", "Subject"))[:120]))
            exams.sort(key=lambda item: item[0])
            if profile.degree or profile.branch or profile.academic_year or profile.semester:
                details = ", ".join(value for value in (
                    profile.degree, profile.branch,
                    f"year {profile.academic_year}" if profile.academic_year else "",
                    f"semester {profile.semester}" if profile.semester else "",
                ) if value)
                if details:
                    context_lines.append("Saved academic profile: " + details)
            subjects = json.loads(profile.subjects_json)
            if subjects:
                context_lines.append("Saved subjects: " + ", ".join(subjects[:20]))
            if exams:
                context_lines.append("Upcoming configured exams: " + "; ".join(
                    f"{subject}: {exam_date.isoformat()}" for exam_date, subject in exams[:10]
                ))
            if profile.weekly_study_hours:
                context_lines.append(f"Configured study availability: {profile.weekly_study_hours} hours/week")

        upcoming = list(db.scalars(
            select(Task).where(Task.status != "completed", Task.due_date >= today)
            .order_by(Task.due_date, Task.id).limit(8)
        ))
        overdue = list(db.scalars(
            select(Task).where(Task.status != "completed", Task.due_date < today)
            .order_by(Task.due_date, Task.id).limit(4)
        ))
        if upcoming:
            context_lines.append("Upcoming open planner tasks: " + "; ".join(
                f"{task.title} (subject: {task.subject}; due: {task.due_date.isoformat()}; "
                f"priority: {task.priority}; estimate: {task.estimated_minutes} min)" for task in upcoming
            ))
        if overdue:
            context_lines.append("Overdue open planner tasks: " + "; ".join(
                f"{task.title} (subject: {task.subject}; due: {task.due_date.isoformat()}; priority: {task.priority})"
                for task in overdue
            ))
        if payload.companion_mode:
            all_tasks = list(db.scalars(select(Task)))
            completed = [task for task in all_tasks if task.status == "completed"]
            context_lines.append(f"Saved planner progress: {len(completed)} completed task(s) out of {len(all_tasks)} total.")
            scheduled = list(db.scalars(
                select(Task).where(Task.scheduled_start_at.is_not(None))
                .order_by(Task.scheduled_start_at).limit(8)
            ))
            if scheduled:
                context_lines.append("Saved scheduled study sessions: " + "; ".join(
                    f"{task.title} ({task.subject}; {task.scheduled_start_at.isoformat()}; "
                    f"{task.estimated_minutes} min; {task.status.replace('_', ' ')})" for task in scheduled
                ))
            notes = list(db.scalars(
                select(NoteDocument).order_by(NoteDocument.created_at.desc()).limit(12)
            ))
            if notes:
                context_lines.append("Available uploaded notes (metadata only; retrieve passages before making content claims): " + "; ".join(
                    f"{note.title} ({note.subject}; {note.status})" for note in notes
                ))
            snapshot = _recommendation_snapshot(db, today)
            if snapshot["items"]:
                context_lines.append("Current saved-data recommendations: " + "; ".join(
                    f"{item['action']} — {item['reason']}" for item in snapshot["items"][:8]
                ))
            context_lines.append(
                "NEXUS guidance: speak as a warm, concise study companion. Be supportive without assuming feelings. "
                "Use saved records only when relevant, explain task priorities from their recorded reasons, and offer "
                "one practical next step. Never claim a timer, goal, or study session exists unless it appears in saved context."
            )
        academic_context = "\n".join(context_lines)

    web_citations = []
    if tool_plan.web:
        search = get_search_provider(settings)
        if search is None:
            raise HTTPException(
                503,
                "This question asks for current information. Add TAVILY_API_KEY to the repository-root .env and "
                "restart FastAPI to enable cited web research. Ordinary academic questions do not need Tavily.",
            )
        try:
            web_citations = search.search(question)[:5]
        except RuntimeError as error:
            raise HTTPException(502, str(error)) from error
        if not web_citations:
            raise HTTPException(502, "Web search returned no usable sources, so Campusly did not generate a current answer.")

    if tool_plan.notes and not citations:
        academic_context += ("\n" if academic_context else "") + (
            "The user asked about uploaded notes, but local retrieval found no matching note passages. "
            "Do not present a general answer as if it came from their notes; say no relevant passage was found."
        )
    try:
        if payload.companion_mode:
            answer = provider.answer(question, citations, prior_messages, academic_context, web_citations, companion_mode=True)
        else:
            answer = provider.answer(question, citations, prior_messages, academic_context, web_citations)
    except RuntimeError as error:
        raise HTTPException(502, str(error)) from error

    if not convo:
        convo = Conversation(title=question[:70])
        db.add(convo)
        db.flush()
    stored_citations = {"notes": citations, "web": web_citations}
    db.add(ConversationMessage(conversation_id=convo.id, role="user", content=question))
    db.add(ConversationMessage(conversation_id=convo.id, role="assistant", content=answer,
                               citations_json=json.dumps(stored_citations)))
    convo.updated_at = datetime.now()
    db.commit()
    return {"conversation_id": convo.id, "answer": answer, "citations": citations,
            "web_citations": web_citations, "mode": provider.mode,
            "tools_used": [name for name, used in (("notes", tool_plan.notes), ("planner", tool_plan.planner or payload.companion_mode), ("web_search", tool_plan.web)) if used]}


@router.get("/assistant/status")
def assistant_status():
    settings = get_settings()
    provider = get_assistant_provider(settings)
    missing = missing_ai_configuration(settings)
    return {"mode": provider.mode if provider else "unconfigured", "configured": provider is not None,
            "missing_configuration": missing, "web_search_configured": get_search_provider(settings) is not None}


@router.get("/recommendations")
def recommendations(db: Session = Depends(get_db)):
    return _recommendation_snapshot(db, date.today())

