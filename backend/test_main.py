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
            assert "Total Income is ₹2000.00" in res_data["insight"]

            response_q = client.post("/api/insights", json={"question": "Can I buy a laptop?"})
            assert response_q.status_code == 200
            res_data_q = response_q.json()
            assert "Demo Mode" in res_data_q["insight"]
            assert "Can I buy a laptop?" in res_data_q["insight"]

@patch("google.genai.Client")
def test_insights_with_api_key(mock_client_class):
    # Setup mock response
    mock_client_instance = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "AI Financial Advice: Great job saving money!"
    mock_client_instance.models.generate_content.return_value = mock_response
    mock_client_class.return_value = mock_client_instance

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
        
        assert mock_client_class.call_count == 1
        assert mock_client_class.call_args[1]["api_key"] == "fake-api-key"
        mock_client_instance.models.generate_content.assert_called_once()

def test_monthly_analytics():
    with patch.dict(os.environ, {"DATABASE_PATH": TEST_DB}):
        # 1. Test empty database analytics
        res_empty = client.get("/api/analytics/monthly")
        assert res_empty.status_code == 200
        data_empty = res_empty.json()
        assert "selected_month" in data_empty
        assert "months" in data_empty
        assert "selected_month_detail" in data_empty
        assert data_empty["selected_month_detail"]["total_expense"] == 0.0

        # 2. Add transactions across multiple months
        # July 2026: Income ₹10,000, Food ₹1,500, Utilities ₹500
        client.post("/api/transactions", json={
            "description": "Salary July",
            "amount": 10000.0,
            "category": "Salary",
            "type": "income",
            "date": "2026-07-01"
        })
        client.post("/api/transactions", json={
            "description": "Groceries",
            "amount": 1500.0,
            "category": "Food",
            "type": "expense",
            "date": "2026-07-10"
        })
        client.post("/api/transactions", json={
            "description": "Electricity",
            "amount": 500.0,
            "category": "Utilities",
            "type": "expense",
            "date": "2026-07-15"
        })

        # August 2026: Income ₹12,000, Food ₹2,000, Leisure ₹1,000
        client.post("/api/transactions", json={
            "description": "Salary August",
            "amount": 12000.0,
            "category": "Salary",
            "type": "income",
            "date": "2026-08-01"
        })
        client.post("/api/transactions", json={
            "description": "Dinner Out",
            "amount": 2000.0,
            "category": "Food",
            "type": "expense",
            "date": "2026-08-05"
        })
        client.post("/api/transactions", json={
            "description": "Shopping",
            "amount": 1000.0,
            "category": "Leisure",
            "type": "expense",
            "date": "2026-08-20"
        })

        # 3. Query all months analytics
        res = client.get("/api/analytics/monthly")
        assert res.status_code == 200
        data = res.json()
        assert len(data["months"]) >= 2

        # Check July summary
        july = next((m for m in data["months"] if m["year_month"] == "2026-07"), None)
        assert july is not None
        assert july["total_expense"] == 2000.0
        assert july["total_income"] == 10000.0
        assert july["net_savings"] == 8000.0
        assert july["savings_rate"] == 80.0
        assert july["top_category"] == "Food"

        # Check August summary & MoM comparison (spent 3000 vs 2000 = +1000, +50%)
        aug = next((m for m in data["months"] if m["year_month"] == "2026-08"), None)
        assert aug is not None
        assert aug["total_expense"] == 3000.0
        assert aug["mom_diff"] == 1000.0
        assert aug["mom_pct"] == 50.0

        # 4. Query specific month detail for August 2026
        res_aug = client.get("/api/analytics/monthly?year=2026&month=8")
        assert res_aug.status_code == 200
        aug_detail = res_aug.json()["selected_month_detail"]
        assert aug_detail["year_month"] == "2026-08"
        assert aug_detail["total_expense"] == 3000.0
        assert aug_detail["peak_day"]["day"] == 5
        assert aug_detail["peak_day"]["amount"] == 2000.0

        # Check category breakdown in August
        categories = {c["category"]: c for c in aug_detail["category_breakdown"]}
        assert "Food" in categories
        assert categories["Food"]["amount"] == 2000.0
        assert "Leisure" in categories
        assert categories["Leisure"]["amount"] == 1000.0

