from backend.app.core.agent_tools import select_tools


def test_tool_selection_is_intent_based_and_bounded():
    assert select_tools("What is pandas?").notes is False
    assert select_tools("What is pandas?").planner is False
    assert select_tools("What is pandas?").web is False
    assert select_tools("What are my next deadlines?").planner is True
    assert select_tools("Explain my lecture notes on pandas").notes is True
    current = select_tools("What is the latest pandas release?")
    assert current.web is True
    assert current.planner is False


def test_note_follow_up_reselects_notes_from_user_history():
    plan = select_tools(
        "Explain that more simply",
        [{"role": "user", "content": "Summarize my uploaded notes on binary search"}],
    )
    assert plan.notes is True
