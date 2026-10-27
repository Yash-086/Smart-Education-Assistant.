"""AI Study Studio endpoints built on the existing private LLM and notes pipeline."""

import json
import re
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.api.academic import retrieve
from backend.app.core.assistant_provider import get_assistant_provider, missing_ai_configuration
from backend.app.core.config import get_settings
from backend.app.db.session import get_db
from backend.app.models.academic import NoteChunk, NoteDocument, NotePage, RevisionPlan

router = APIRouter(prefix="/api/study", tags=["AI Study Studio"])

StudyAction = Literal[
    "ask", "summary", "detailed_summary", "key_concepts", "quiz", "flashcards",
    "explain", "practice_questions", "important_topics", "exam_answer", "revision_notes",
]


class StudyGenerateInput(BaseModel):
    action: StudyAction
    question: str = Field(default="", max_length=2_000)
    document_ids: list[int] = Field(default_factory=list, max_length=10)
    level: Literal["beginner", "detailed"] = "beginner"
    mark_format: Literal[2, 5, 10] = 5
    count: int = Field(default=5, ge=1, le=12)


class RevisionPlanInput(BaseModel):
    exam_date: date
    minutes_per_day: int = Field(ge=15, le=600)
    document_ids: list[int] = Field(min_length=1, max_length=10)
    title: str = Field(default="Revision plan", max_length=200)


class SessionProgressInput(BaseModel):
    completed: bool


def _json_payload(answer: str) -> dict:
    candidate = answer.strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", candidate, re.I)
    if fenced:
        candidate = fenced.group(1).strip()
    if not candidate.startswith("{"):
        start, end = candidate.find("{"), candidate.rfind("}")
        if start < 0 or end <= start:
            raise RuntimeError("The model did not return the structured study content. Try again.")
        candidate = candidate[start:end + 1]
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError as error:
        raise RuntimeError("The model returned invalid structured content. Try again.") from error
    if not isinstance(payload, dict):
        raise RuntimeError("The model returned an unsupported structured response. Try again.")
    return payload


def _selected_documents(db: Session, document_ids: list[int]) -> list[NoteDocument]:
    if not document_ids:
        return []
    documents = list(db.scalars(select(NoteDocument).where(NoteDocument.id.in_(set(document_ids)))))
    found = {document.id for document in documents}
    missing = [document_id for document_id in document_ids if document_id not in found]
    if missing:
        raise HTTPException(404, "One or more selected study sources no longer exist.")
    unavailable = [document.original_name for document in documents if document.status != "ready"]
    if unavailable:
        raise HTTPException(422, f"These sources are not ready for study yet: {', '.join(unavailable)}.")
    return documents


def _representative_passages(db: Session, document_ids: list[int], limit: int = 5) -> list[dict]:
    rows = list(db.execute(
        select(NoteChunk, NoteDocument)
        .join(NoteDocument, NoteDocument.id == NoteChunk.document_id)
        .where(NoteDocument.id.in_(document_ids), NoteDocument.status == "ready")
        .order_by(NoteDocument.id, NoteChunk.page_number, NoteChunk.chunk_index)
    ))
    indexed_ids = {document.id for _, document in rows}
    legacy_ids = set(document_ids) - indexed_ids
    if legacy_ids:
        rows.extend(
            (page, document) for page, document in db.execute(
            select(NotePage, NoteDocument)
            .join(NoteDocument, NoteDocument.id == NotePage.document_id)
            .where(NoteDocument.id.in_(legacy_ids), NoteDocument.status == "ready")
            .order_by(NoteDocument.id, NotePage.page_number)
            )
        )
    if len(rows) > limit:
        step = (len(rows) - 1) / (limit - 1) if limit > 1 else 0
        rows = [rows[round(index * step)] for index in range(limit)]
    passages = []
    for item, document in rows:
        page_number = getattr(item, "page_number", None) or None
        text = item.text.strip()
        passages.append({
            "document_id": document.id,
            "document_name": document.title,
            "subject": document.subject,
            "page_number": page_number,
            "excerpt": text[:1_200],
            "score": 1.0,
        })
    return passages


def _prompt(payload: StudyGenerateInput) -> str:
    topic = payload.question.strip()
    source_rule = (
        "Use only the supplied source passages for document-grounded claims. Cite document and page where available. "
        "If sources do not support a claim, say so clearly; never invent source details. "
        if payload.document_ids else
        "The user asked for general topic practice rather than document-grounded content. Be accurate and clear about uncertainty. "
    )
    instructions = {
        "ask": f"Answer the student's question from the selected study sources: {topic}",
        "summary": "Write a short, clear summary of the selected study sources with their central ideas.",
        "detailed_summary": "Write a detailed, well-organized summary of the selected study sources, grouped by theme or section.",
        "key_concepts": "Extract the key concepts, definitions, formulas, and important points from the selected study sources.",
        "quiz": f"Create {payload.count} multiple-choice questions from the selected study sources. Output only JSON with shape {{\"questions\":[{{\"question\":string,\"options\":[string,string,string,string],\"answer_index\":integer,\"explanation\":string}}]}}. answer_index is zero-based.",
        "flashcards": f"Create {payload.count} useful flashcards from the selected study sources. Output only JSON with shape {{\"flashcards\":[{{\"front\":string,\"back\":string}}]}}.",
        "explain": f"Explain {topic or 'the central topics in the selected study sources'} for a {payload.level} learner. Include a definition, example, key concepts, and takeaways when supported.",
        "practice_questions": f"Create {payload.count} practice questions about {topic or 'the selected study sources'}, with a balanced easy, medium, and difficult mix. Output only JSON with shape {{\"questions\":[{{\"question\":string,\"difficulty\":\"easy|medium|difficult\",\"answer\":string,\"explanation\":string}}]}}.",
        "important_topics": f"Identify up to {payload.count} important topics in the selected study sources. Use headings, repetition, definitions, formulas, and emphasis as evidence. Do not predict exam questions. Output only JSON with shape {{\"topics\":[{{\"topic\":string,\"reason\":string}}]}}.",
        "exam_answer": f"Answer this question in a {payload.mark_format}-mark exam format: {topic}. Use suitable structure and detail, and do not invent source-specific facts.",
        "revision_notes": "Create concise revision notes from the selected study sources. Organize by topic and highlight definitions, formulas, differences, and key concepts.",
    }
    if payload.action in ("ask", "exam_answer") and not topic:
        raise HTTPException(422, "Enter a question or topic first.")
    return source_rule + instructions[payload.action]


def _structured_items(action: str, output: str) -> list[dict]:
    key = {"quiz": "questions", "practice_questions": "questions", "flashcards": "flashcards", "important_topics": "topics"}[action]
    payload = _json_payload(output)
    values = payload.get(key)
    if not isinstance(values, list) or not values:
        raise RuntimeError(f"The model did not return any {key}. Try again.")
    clean: list[dict] = []
    for item in values[:12]:
        if not isinstance(item, dict):
            continue
        if action == "quiz":
            question, options, answer_index = item.get("question"), item.get("options"), item.get("answer_index")
            if not isinstance(question, str) or not isinstance(options, list) or not 2 <= len(options) <= 6:
                continue
            if not all(isinstance(option, str) and option.strip() for option in options):
                continue
            if not isinstance(answer_index, int) or isinstance(answer_index, bool) or not 0 <= answer_index < len(options):
                continue
            clean.append({"question": question, "options": options, "answer_index": answer_index,
                          "explanation": str(item.get("explanation") or "")})
        elif action == "flashcards":
            front, back = item.get("front"), item.get("back")
            if isinstance(front, str) and front.strip() and isinstance(back, str) and back.strip():
                clean.append({"front": front, "back": back})
        elif action == "important_topics":
            topic, reason = item.get("topic"), item.get("reason")
            if isinstance(topic, str) and topic.strip() and isinstance(reason, str) and reason.strip():
                clean.append({"topic": topic, "reason": reason})
        else:
            question, answer = item.get("question"), item.get("answer")
            if isinstance(question, str) and question.strip() and isinstance(answer, str) and answer.strip():
                difficulty = item.get("difficulty") if item.get("difficulty") in ("easy", "medium", "difficult") else "medium"
                clean.append({"question": question, "difficulty": difficulty, "answer": answer,
                              "explanation": str(item.get("explanation") or "")})
    if not clean:
        raise RuntimeError(f"The model returned invalid {key}. Try again.")
    return clean


@router.post("/generate")
def generate_study_content(payload: StudyGenerateInput, db: Session = Depends(get_db)):
    documents = _selected_documents(db, payload.document_ids)
    needs_sources = payload.action in ("ask", "summary", "detailed_summary", "key_concepts", "quiz", "flashcards", "revision_notes", "important_topics")
    if needs_sources and not documents:
        raise HTTPException(422, "Select at least one processed study source first.")
    query = payload.question.strip() or "key ideas, definitions, formulas, and important topics"
    use_retrieval = payload.action in ("ask", "explain", "exam_answer", "practice_questions") and bool(payload.question.strip())
    passages = retrieve(query, db, payload.document_ids, limit=5) if use_retrieval and documents else []
    if payload.action == "ask" and not passages:
        return {"action": payload.action, "content": "I could not find a relevant passage in the selected sources, so I cannot ground an answer in them.", "items": [], "citations": [], "mode": "no_matching_source"}
    if documents and use_retrieval and not passages:
        raise HTTPException(422, "No matching passage was found in the selected sources. Try different wording or choose another source.")
    if documents and not use_retrieval:
        passages = _representative_passages(db, [document.id for document in documents])
    if documents and not passages:
        raise HTTPException(422, "The selected study sources do not contain readable text yet.")
    settings = get_settings()
    if missing_ai_configuration(settings):
        raise HTTPException(503, "The configured AI provider is missing credentials. Configure it on the backend before generating study content.")
    provider = get_assistant_provider(settings)
    if provider is None:
        raise HTTPException(503, "The AI provider is unavailable. Check backend configuration and try again.")
    try:
        output = provider.answer(_prompt(payload), passages)
        items = _structured_items(payload.action, output) if payload.action in ("quiz", "flashcards", "practice_questions", "important_topics") else []
    except RuntimeError as error:
        raise HTTPException(502, str(error)) from error
    return {"action": payload.action, "content": output if not items else "", "items": items,
            "citations": passages, "mode": provider.mode}


def _plan_read(plan: RevisionPlan) -> dict:
    return {"id": plan.id, "title": plan.title, "exam_date": plan.exam_date.isoformat(),
            "minutes_per_day": plan.minutes_per_day, "document_ids": json.loads(plan.document_ids_json),
            "sessions": json.loads(plan.sessions_json), "created_at": plan.created_at, "updated_at": plan.updated_at}


@router.get("/plans")
def list_revision_plans(db: Session = Depends(get_db)):
    return [_plan_read(plan) for plan in db.scalars(select(RevisionPlan).order_by(RevisionPlan.created_at.desc()))]


@router.post("/plans", status_code=201)
def create_revision_plan(payload: RevisionPlanInput, db: Session = Depends(get_db)):
    if payload.exam_date <= date.today():
        raise HTTPException(422, "Choose an exam date in the future so there is time to revise.")
    documents = _selected_documents(db, payload.document_ids)
    settings = get_settings()
    if missing_ai_configuration(settings):
        raise HTTPException(503, "The configured AI provider is missing credentials. Configure it on the backend before generating a revision plan.")
    provider = get_assistant_provider(settings)
    if provider is None:
        raise HTTPException(503, "The AI provider is unavailable. Check backend configuration and try again.")
    passages = _representative_passages(db, [document.id for document in documents])
    if not passages:
        raise HTTPException(422, "The selected sources do not contain readable text yet.")
    prompt = StudyGenerateInput(action="important_topics", count=12, document_ids=payload.document_ids)
    try:
        output = provider.answer(_prompt(prompt), passages)
        topics = _structured_items("important_topics", output)
    except RuntimeError as error:
        raise HTTPException(502, str(error)) from error
    days = max(1, (payload.exam_date - date.today()).days)
    # Prioritize the highest-ranked material that fits a modest per-topic revision block.
    topic_budget = max(1, min(len(topics), days * payload.minutes_per_day // 30))
    topics = topics[:topic_budget]
    days_used = min(days, len(topics))
    sessions = []
    for index, item in enumerate(topics):
        day_index = index * days_used // len(topics)
        topics_on_day = sum(1 for topic_index in range(len(topics)) if topic_index * days_used // len(topics) == day_index)
        session_day = date.today() + timedelta(days=day_index)
        sessions.append({"date": session_day.isoformat(), "topic": item["topic"], "reason": item["reason"],
                         "minutes": max(1, payload.minutes_per_day // topics_on_day), "completed": False})
    plan = RevisionPlan(title=payload.title.strip() or "Revision plan", exam_date=payload.exam_date,
                        minutes_per_day=payload.minutes_per_day,
                        document_ids_json=json.dumps(payload.document_ids), sessions_json=json.dumps(sessions))
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _plan_read(plan)


@router.patch("/plans/{plan_id}/sessions/{session_index}")
def update_revision_session(plan_id: int, session_index: int, payload: SessionProgressInput, db: Session = Depends(get_db)):
    plan = db.get(RevisionPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Revision plan not found.")
    sessions = json.loads(plan.sessions_json)
    if not 0 <= session_index < len(sessions):
        raise HTTPException(404, "Revision session not found.")
    sessions[session_index]["completed"] = payload.completed
    plan.sessions_json = json.dumps(sessions)
    db.commit()
    db.refresh(plan)
    return _plan_read(plan)
