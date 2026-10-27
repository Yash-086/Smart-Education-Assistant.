from datetime import date

from httpx import Response


def task_payload(**overrides) -> dict:
    payload = {
        "title": "Complete lab record",
        "subject": "Engineering Physics",
        "task_type": "lab_record",
        "due_date": date.today().isoformat(),
        "estimated_minutes": 90,
        "priority": "high",
    }
    payload.update(overrides)
    return payload


def test_create_and_list_tasks(api_request):
    created = api_request("POST", "/api/tasks", json=task_payload())

    assert created.status_code == 201
    task = created.json()
    assert task["title"] == "Complete lab record"
    assert task["subject"] == "Engineering Physics"
    assert task["status"] == "todo"

    listed = api_request("GET", "/api/tasks")
    assert [item["id"] for item in listed.json()] == [task["id"]]


def test_edit_complete_and_delete_task(api_request):
    task = api_request("POST", "/api/tasks", json=task_payload()).json()

    edited = api_request("PATCH", f"/api/tasks/{task['id']}", json={"title": "Finish physics lab"})
    assert edited.status_code == 200
    assert edited.json()["title"] == "Finish physics lab"

    completed = api_request("PATCH", f"/api/tasks/{task['id']}", json={"status": "completed"})
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"

    deleted = api_request("DELETE", f"/api/tasks/{task['id']}")
    assert deleted.status_code == 204
    assert api_request("GET", "/api/tasks").json() == []


def test_rejects_invalid_task_data(api_request):
    blank_title: Response = api_request("POST", "/api/tasks", json=task_payload(title="   "))
    invalid_minutes = api_request("POST", "/api/tasks", json=task_payload(estimated_minutes=0))
    invalid_type = api_request("POST", "/api/tasks", json=task_payload(task_type="surprise"))

    assert blank_title.status_code == 422
    assert invalid_minutes.status_code == 422
    assert invalid_type.status_code == 422


def test_detects_schedule_overlaps_and_allows_adjacent_sessions(api_request):
    first = api_request(
        "POST",
        "/api/tasks",
        json=task_payload(title="Revision", scheduled_start_at="2026-12-01T10:00:00"),
    )
    assert first.status_code == 201

    overlap = api_request(
        "POST",
        "/api/tasks",
        json=task_payload(title="Practice", scheduled_start_at="2026-12-01T11:00:00"),
    )
    assert overlap.status_code == 409
    assert overlap.json()["detail"]["conflicts"][0]["title"] == "Revision"

    adjacent = api_request(
        "POST",
        "/api/tasks",
        json=task_payload(title="Practice", scheduled_start_at="2026-12-01T11:30:00"),
    )
    assert adjacent.status_code == 201


def test_rejects_edit_that_would_create_a_schedule_conflict(api_request):
    first = api_request(
        "POST", "/api/tasks", json=task_payload(scheduled_start_at="2026-12-01T10:00:00")
    ).json()
    second = api_request(
        "POST", "/api/tasks", json=task_payload(title="Second", scheduled_start_at="2026-12-01T13:00:00")
    ).json()

    response = api_request(
        "PATCH",
        f"/api/tasks/{second['id']}",
        json={"scheduled_start_at": "2026-12-01T10:30:00"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["conflicts"][0]["id"] == first["id"]
