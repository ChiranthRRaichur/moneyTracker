import os
import pytest
from unittest.mock import MagicMock, patch

# Set temporary test database environment variable before importing main
TEST_DB = "test_finance.db"
os.environ["DATABASE_PATH"] = TEST_DB

from fastapi.testclient import TestClient
from main import app, init_db, DB_PATH

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    # Setup test DB
    init_db()
    yield
    # Clean up test DB file
    if os.path.exists(TEST_DB):
        try:
            os.remove(TEST_DB)
        except PermissionError:
            pass

def test_crud_transactions():
    # 1. Get initial transactions (should be empty)
    response = client.get("/api/transactions")
    assert response.status_code == 200
    assert response.json() == []

    # 2. Add a new transaction
    payload = {
        "description": "Weekly Groceries",
        "amount": 75.50,
        "category": "Food",
        "type": "expense",
        "date": "2026-07-26"
    }
    response = client.post("/api/transactions", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["description"] == payload["description"]
    assert data["amount"] == payload["amount"]
    assert data["category"] == payload["category"]
    assert data["type"] == payload["type"]
    assert data["date"] == payload["date"]
    assert "id" in data
    tx_id = data["id"]

    # 3. Get transactions again (should contain 1 transaction)
    response = client.get("/api/transactions")
    assert response.status_code == 200
    txs = response.json()
    assert len(txs) == 1
    assert txs[0]["id"] == tx_id

    # 4. Try adding transaction with invalid data
    bad_payload = payload.copy()
    bad_payload["type"] = "invalid_type"
    response = client.post("/api/transactions", json=bad_payload)
    assert response.status_code == 400

    bad_payload2 = payload.copy()
    bad_payload2["amount"] = -10.0
    response = client.post("/api/transactions", json=bad_payload2)
    assert response.status_code == 400

    # 5. Delete transaction
    response = client.delete(f"/api/transactions/{tx_id}")
    assert response.status_code == 204

    # 6. Verify empty list again
    response = client.get("/api/transactions")
    assert response.status_code == 200
    assert response.json() == []

    # 7. Try deleting non-existent transaction
    response = client.delete("/api/transactions/9999")
    assert response.status_code == 404

def test_insights_no_api_key():
    # Test insights with fallback when GEMINI_API_KEY is not set
    with patch.dict(os.environ, {}, clear=True):
        # We also need to keep DATABASE_PATH in os.environ for the test database to stay test_finance.db
        with patch.dict(os.environ, {"DATABASE_PATH": TEST_DB}):
            # Insert a quick transaction
            client.post("/api/transactions", json={
                "description": "Salary",
                "amount": 2000.00,
                "category": "Salary",
                "type": "income",
                "date": "2026-07-01"
            })
            
            response = client.post("/api/insights")
            assert response.status_code == 200
            res_data = response.json()
            assert "Demo Mode" in res_data["insight"]
            assert "Total Income is $2000.00" in res_data["insight"]

            response_q = client.post("/api/insights", json={"question": "Can I buy a laptop?"})
            assert response_q.status_code == 200
            res_data_q = response_q.json()
            assert "Demo Mode" in res_data_q["insight"]
            assert "Can I buy a laptop?" in res_data_q["insight"]

@patch("google.generativeai.GenerativeModel")
def test_insights_with_api_key(mock_gen_model):
    # Setup mock response
    mock_model_instance = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "AI Financial Advice: Great job saving money!"
    mock_model_instance.generate_content.return_code = 0
    mock_model_instance.generate_content.return_value = mock_response
    mock_gen_model.return_value = mock_model_instance

    # Mock environment variable for GEMINI_API_KEY
    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-api-key", "DATABASE_PATH": TEST_DB}):
        client.post("/api/transactions", json={
            "description": "Salary",
            "amount": 2000.00,
            "category": "Salary",
            "type": "income",
            "date": "2026-07-01"
        })
        
        response = client.post("/api/insights", json={"question": "Analyze my income"})
        assert response.status_code == 200
        assert response.json()["insight"] == "AI Financial Advice: Great job saving money!"
        
        mock_gen_model.assert_called_once_with("gemini-1.5-flash")
        mock_model_instance.generate_content.assert_called_once()
