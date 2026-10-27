from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.models.task import Task
from backend.app.schemas.task import TaskCreate, TaskRead, TaskStatus, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _check_schedule_conflicts(
    db: Session,
    scheduled_start_at: datetime | None,
    estimated_minutes: int,
    status_value: TaskStatus | str,
    exclude_id: int | None = None,
) -> None:
    if scheduled_start_at is None or status_value == TaskStatus.completed or status_value == "completed":
        return
    scheduled_end = scheduled_start_at + timedelta(minutes=estimated_minutes)
    query = select(Task).where(Task.scheduled_start_at.is_not(None), Task.status != TaskStatus.completed.value)
    if exclude_id is not None:
        query = query.where(Task.id != exclude_id)
    conflicts = []
    for existing in db.scalars(query):
        existing_start = existing.scheduled_start_at
        if existing_start is None:
            continue
        existing_end = existing_start + timedelta(minutes=existing.estimated_minutes)
        if scheduled_start_at < existing_end and scheduled_end > existing_start:
            conflicts.append({"id": existing.id, "title": existing.title, "start": existing_start.isoformat(), "end": existing_end.isoformat()})
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "This study session overlaps another scheduled task.", "conflicts": conflicts},
        )


@router.get("", response_model=list[TaskRead])
def list_tasks(db: Session = Depends(get_db)) -> list[Task]:
    return list(db.scalars(select(Task).order_by(Task.due_date, Task.id)))


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)) -> Task:
    _check_schedule_conflicts(db, payload.scheduled_start_at, payload.estimated_minutes, payload.status)
    task = Task(**payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    changes = payload.model_dump(exclude_unset=True)
    proposed = {field: changes.get(field, getattr(task, field)) for field in ("scheduled_start_at", "estimated_minutes", "status")}
    _check_schedule_conflicts(db, proposed["scheduled_start_at"], proposed["estimated_minutes"], proposed["status"], exclude_id=task_id)
    for field, value in changes.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: Session = Depends(get_db)) -> Response:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    db.delete(task)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
