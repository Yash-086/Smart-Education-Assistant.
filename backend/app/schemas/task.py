from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class TaskType(StrEnum):
    assignment = "assignment"
    internal_exam = "internal_exam"
    lab_record = "lab_record"
    coding_practice = "coding_practice"
    project = "project"
    revision = "revision"
    presentation = "presentation"
    practical_exam = "practical_exam"
    other = "other"


class TaskPriority(StrEnum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


class TaskStatus(StrEnum):
    todo = "todo"
    in_progress = "in_progress"
    completed = "completed"


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    subject: str = Field(min_length=1, max_length=120)
    task_type: TaskType
    due_date: date
    estimated_minutes: int = Field(ge=1, le=1440)
    priority: TaskPriority = TaskPriority.normal
    status: TaskStatus = TaskStatus.todo
    scheduled_start_at: datetime | None = None

    @field_validator("title", "subject")
    @classmethod
    def clean_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank.")
        return value

    @field_validator("scheduled_start_at")
    @classmethod
    def normalize_scheduled_time(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            raise ValueError("Use a local date and time without a timezone.")
        return value


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    subject: str | None = Field(default=None, min_length=1, max_length=120)
    task_type: TaskType | None = None
    due_date: date | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=1440)
    priority: TaskPriority | None = None
    status: TaskStatus | None = None
    scheduled_start_at: datetime | None = None

    @field_validator("title", "subject")
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank.")
        return value

    @field_validator("scheduled_start_at")
    @classmethod
    def normalize_scheduled_time(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            raise ValueError("Use a local date and time without a timezone.")
        return value

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "TaskUpdate":
        for field in ("title", "subject", "task_type", "due_date", "estimated_minutes", "priority", "status"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null.")
        return self


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    subject: str
    task_type: TaskType
    due_date: date
    estimated_minutes: int
    priority: TaskPriority
    status: TaskStatus
    scheduled_start_at: datetime | None
    created_at: datetime
    updated_at: datetime
