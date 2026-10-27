import asyncio

import httpx

from backend.app.main import app


def test_health_reports_api_and_database_available():
    async def request_health():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/api/health")

    response = asyncio.run(request_health())

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "connected"}
