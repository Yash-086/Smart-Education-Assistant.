"""Deterministic, bounded tool selection for Campusly's study assistant."""

from dataclasses import dataclass
import re


_NOTE_INTENT = re.compile(
    r"\b(notes?|uploaded|documents?|pdfs?|lecture slides?|my materials|in the file|in my file|"
    r"according to (?:my|the) (?:course|lecture)|from (?:my|the) notes)\b", re.I,
)
_PLANNER_INTENT = re.compile(
    r"\b(tasks?|deadlines?|due|assignments?|planner|study plan|plan my week|study week|"
    r"schedule|exam|revision|prepare|personalized|my profile|my schedule|based on my|"
    r"what should i (?:focus|study)|what(?:'s| is) next)\b", re.I,
)
_WEB_INTENT = re.compile(
    r"\b(latest|current|currently|recent|today|this week|this month|this year|news|"
    r"developments?|release notes?|latest version|search the web|search online|internet research)\b", re.I,
)
_FOLLOW_UP = re.compile(r"\b(that|it|this|those|these|them|above|more simply|more detail|elaborate|why)\b", re.I)


@dataclass(frozen=True)
class ToolPlan:
    notes: bool
    planner: bool
    web: bool


def select_tools(question: str, history: list[dict] | None = None) -> ToolPlan:
    """Pick only relevant tools. No model-directed loops; each tool runs at most once."""
    notes = bool(_NOTE_INTENT.search(question))
    planner = bool(_PLANNER_INTENT.search(question))
    web = bool(_WEB_INTENT.search(question))

    # Resolve note follow-ups by searching their last user query again, not by trusting
    # assistant-generated prose as a source. History is already capped by the endpoint.
    if not notes and _FOLLOW_UP.search(question):
        notes = any(
            item.get("role") == "user" and isinstance(item.get("content"), str)
            and _NOTE_INTENT.search(item["content"])
            for item in list(reversed(history or []))[:8]
        )
    return ToolPlan(notes=notes, planner=planner, web=web)
