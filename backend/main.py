import os
import sqlite3
from typing import List, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types

# Load environment variables from .env or backend/.env if present
env_path = ".env" if os.path.exists(".env") else "backend/.env" if os.path.exists("backend/.env") else None
if env_path:
    with open(env_path) as f:
        for line in f:
            if "=" in line and not line.strip().startswith("#"):
                key, val = line.strip().split("=", 1)
                os.environ[key.strip()] = val.strip().strip("'\"")

DB_PATH = os.environ.get("DATABASE_PATH", "finance.db")
DATABASE_URL = os.environ.get("DATABASE_URL")
IS_POSTGRES = DATABASE_URL is not None

app = FastAPI(title="Personal Money Tracker API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8084","https://crrmoney.netlify.app"],  # Allow old and new frontend ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class Transaction(BaseModel): #pydantic base model 
    id: Optional[int] = None
    description: str
    amount: float
    category: str
    type: str  # "income" or "expense"
    date: str  # YYYY-MM-DD

class InsightRequest(BaseModel):
    question: Optional[str] = None

# Database initialization
def init_db():
    if IS_POSTGRES:
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                description TEXT NOT NULL,
                amount DOUBLE PRECISION NOT NULL,
                category TEXT NOT NULL,
                type TEXT NOT NULL,
                date TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                type TEXT NOT NULL,
                date TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()

init_db()

# DB Helper Functions
def get_db_connection():
    if IS_POSTGRES:
        import psycopg2
        from psycopg2.extras import RealDictCursor
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        return conn
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

@app.get("/api/transactions", response_model=List[Transaction])
def get_transactions():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, description, amount, category, type, date FROM transactions ORDER BY date DESC, id DESC")
    rows = cursor.fetchall()
    conn.close()
    
    return [
        Transaction(
            id=row["id"],
            description=row["description"],
            amount=row["amount"],
            category=row["category"],
            type=row["type"],
            date=row["date"]
        ) for row in rows
    ]

@app.post("/api/transactions", response_model=Transaction, status_code=status.HTTP_201_CREATED)
def add_transaction(tx: Transaction):
    if tx.type not in ["income", "expense"]:
        raise HTTPException(status_code=400, detail="Transaction type must be 'income' or 'expense'.")
    if tx.amount <= 0:
        raise HTTPException(status_code=400, detail="Transaction amount must be positive.")
        
    conn = get_db_connection()
    cursor = conn.cursor()
    if IS_POSTGRES:
        cursor.execute(
            "INSERT INTO transactions (description, amount, category, type, date) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (tx.description, tx.amount, tx.category, tx.type, tx.date)
        )
        new_id = cursor.fetchone()["id"]
    else:
        cursor.execute(
            "INSERT INTO transactions (description, amount, category, type, date) VALUES (?, ?, ?, ?, ?)",
            (tx.description, tx.amount, tx.category, tx.type, tx.date)
        )
        new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    tx.id = new_id
    return tx

@app.delete("/api/transactions/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(tx_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    select_query = "SELECT id FROM transactions WHERE id = %s" if IS_POSTGRES else "SELECT id FROM transactions WHERE id = ?"
    cursor.execute(select_query, (tx_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Transaction not found.")
        
    delete_query = "DELETE FROM transactions WHERE id = %s" if IS_POSTGRES else "DELETE FROM transactions WHERE id = ?"
    cursor.execute(delete_query, (tx_id,))
    conn.commit()
    conn.close()
    return None

import calendar
from datetime import datetime

@app.get("/api/analytics/monthly")
def get_monthly_analytics(year: Optional[int] = None, month: Optional[int] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, description, amount, category, type, date FROM transactions ORDER BY date ASC, id ASC")
    rows = cursor.fetchall()
    conn.close()

    # Group transactions by year-month (YYYY-MM)
    monthly_data = {}
    for row in rows:
        d_str = row["date"]  # YYYY-MM-DD
        if len(d_str) >= 7:
            ym = d_str[:7]
            if ym not in monthly_data:
                monthly_data[ym] = {
                    "year_month": ym,
                    "expenses": [],
                    "incomes": [],
                    "total_expense": 0.0,
                    "total_income": 0.0
                }
            if row["type"] == "expense":
                monthly_data[ym]["expenses"].append(row)
                monthly_data[ym]["total_expense"] += row["amount"]
            elif row["type"] == "income":
                monthly_data[ym]["incomes"].append(row)
                monthly_data[ym]["total_income"] += row["amount"]

    sorted_months = sorted(monthly_data.keys())

    # Build multi-month summary with MoM comparisons
    month_summaries = []
    for idx, ym in enumerate(sorted_months):
        data = monthly_data[ym]
        tot_exp = data["total_expense"]
        tot_inc = data["total_income"]
        net_sav = tot_inc - tot_exp
        sav_rate = round((net_sav / tot_inc) * 100, 1) if tot_inc > 0 else 0.0

        # Calculate top category for this month
        cat_sums = {}
        for exp in data["expenses"]:
            c = exp["category"]
            cat_sums[c] = cat_sums.get(c, 0.0) + exp["amount"]
        top_cat = max(cat_sums, key=cat_sums.get) if cat_sums else "None"

        # Month-over-month spending comparison
        mom_diff = 0.0
        mom_pct = 0.0
        if idx > 0:
            prev_ym = sorted_months[idx - 1]
            prev_exp = monthly_data[prev_ym]["total_expense"]
            mom_diff = round(tot_exp - prev_exp, 2)
            if prev_exp > 0:
                mom_pct = round((mom_diff / prev_exp) * 100, 1)
            elif tot_exp > 0:
                mom_pct = 100.0

        month_summaries.append({
            "year_month": ym,
            "total_expense": round(tot_exp, 2),
            "total_income": round(tot_inc, 2),
            "net_savings": round(net_sav, 2),
            "savings_rate": sav_rate,
            "expense_count": len(data["expenses"]),
            "income_count": len(data["incomes"]),
            "top_category": top_cat,
            "mom_diff": mom_diff,
            "mom_pct": mom_pct
        })

    # Determine target month
    now = datetime.now()
    target_ym = None
    if year and month:
        target_ym = f"{year:04d}-{month:02d}"
    elif sorted_months:
        # Default to latest month that has data, or current calendar month if present
        current_ym = f"{now.year:04d}-{now.month:02d}"
        target_ym = current_ym if current_ym in sorted_months else sorted_months[-1]
    else:
        target_ym = f"{now.year:04d}-{now.month:02d}"

    # Extract year and month integers for target
    try:
        t_year, t_month = [int(p) for p in target_ym.split("-")]
    except Exception:
        t_year, t_month = now.year, now.month
        target_ym = f"{t_year:04d}-{t_month:02d}"

    days_in_month = calendar.monthrange(t_year, t_month)[1]
    target_data = monthly_data.get(target_ym, {
        "year_month": target_ym,
        "expenses": [],
        "incomes": [],
        "total_expense": 0.0,
        "total_income": 0.0
    })

    # Compute category breakdown for target month
    cat_stats = {}
    for exp in target_data["expenses"]:
        c = exp["category"]
        if c not in cat_stats:
            cat_stats[c] = {"amount": 0.0, "count": 0}
        cat_stats[c]["amount"] += exp["amount"]
        cat_stats[c]["count"] += 1

    tot_target_exp = target_data["total_expense"]
    category_breakdown = []
    for c, stats in cat_stats.items():
        pct = round((stats["amount"] / tot_target_exp) * 100, 1) if tot_target_exp > 0 else 0.0
        category_breakdown.append({
            "category": c,
            "amount": round(stats["amount"], 2),
            "percentage": pct,
            "count": stats["count"]
        })
    category_breakdown.sort(key=lambda x: x["amount"], reverse=True)

    # Compute daily breakdown for target month
    daily_stats = {d: {"amount": 0.0, "count": 0} for d in range(1, days_in_month + 1)}
    for exp in target_data["expenses"]:
        try:
            day_num = int(exp["date"].split("-")[2])
            if 1 <= day_num <= days_in_month:
                daily_stats[day_num]["amount"] += exp["amount"]
                daily_stats[day_num]["count"] += 1
        except Exception:
            pass

    daily_breakdown = []
    peak_day = {"day": 1, "date": f"{target_ym}-01", "amount": 0.0}
    for d in range(1, days_in_month + 1):
        day_date = f"{target_ym}-{d:02d}"
        amt = round(daily_stats[d]["amount"], 2)
        if amt > peak_day["amount"]:
            peak_day = {"day": d, "date": day_date, "amount": amt}
        daily_breakdown.append({
            "day": d,
            "date": day_date,
            "amount": amt,
            "count": daily_stats[d]["count"]
        })

    # Find MoM for target month
    target_summary = next((s for s in month_summaries if s["year_month"] == target_ym), None)
    mom_diff = target_summary["mom_diff"] if target_summary else 0.0
    mom_pct = target_summary["mom_pct"] if target_summary else 0.0
    tot_target_inc = target_data["total_income"]
    net_target_sav = tot_target_inc - tot_target_exp
    sav_target_rate = round((net_target_sav / tot_target_inc) * 100, 1) if tot_target_inc > 0 else 0.0

    # Days elapsed in month for daily average calculation
    if t_year == now.year and t_month == now.month:
        effective_days = max(1, now.day)
    else:
        effective_days = max(1, days_in_month)
    avg_daily_spend = round(tot_target_exp / effective_days, 2)

    selected_month_detail = {
        "year_month": target_ym,
        "year": t_year,
        "month": t_month,
        "month_name": calendar.month_name[t_month],
        "days_in_month": days_in_month,
        "total_expense": round(tot_target_exp, 2),
        "total_income": round(tot_target_inc, 2),
        "net_savings": round(net_target_sav, 2),
        "savings_rate": sav_target_rate,
        "avg_daily_spend": avg_daily_spend,
        "peak_day": peak_day,
        "category_breakdown": category_breakdown,
        "daily_breakdown": daily_breakdown,
        "mom_diff": mom_diff,
        "mom_pct": mom_pct,
        "expense_count": len(target_data["expenses"]),
        "income_count": len(target_data["incomes"])
    }

    return {
        "selected_month": target_ym,
        "months": month_summaries,
        "selected_month_detail": selected_month_detail
    }

@app.post("/api/insights")
def get_financial_insights(req: Optional[InsightRequest] = None):
    # Fetch all transactions to form context
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT description, amount, category, type, date FROM transactions")
    rows = cursor.fetchall()
    conn.close()
    
    transactions_list = [
        f"- {row['date']}: {row['type'].upper()} of ₹{row['amount']:.2f} for '{row['description']}' (Category: {row['category']})"
        for row in rows
    ]
    
    # Calculate basic summary
    total_income = sum(row['amount'] for row in rows if row['type'] == 'income')
    total_expense = sum(row['amount'] for row in rows if row['type'] == 'expense')
    net_savings = total_income - total_expense
    
    summary_context = (
        f"The user's current transaction history is:\n"
        + ("\n".join(transactions_list) if transactions_list else "No transactions recorded yet.\n")
        + f"\nSummary statistics:\n"
        f"- Total Income: ₹{total_income:.2f}\n"
        f"- Total Expenses: ₹{total_expense:.2f}\n"
        f"- Net Savings: ₹{net_savings:.2f}\n"
    )
    
    question = req.question if req else None
    
    # Configure Gemini SDK
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # Fallback if API key is not configured
        if question:
            return {
                "insight": f"**[Demo Mode - API Key Missing]** You asked: '{question}'.\n\nTo enable live responses from Gemini AI, please set the `GEMINI_API_KEY` environment variable on the server. \n\n*Based on your logs: Total Income is ₹{total_income:.2f}, Expenses are ₹{total_expense:.2f}, and Savings are ₹{net_savings:.2f}.*"
            }
        else:
            return {
                "insight": f"**[Demo Mode - API Key Missing]**\n\nTo enable live financial coaching from Gemini AI, please configure the `GEMINI_API_KEY` environment variable. \n\n*Based on your logs: Total Income is ₹{total_income:.2f}, Expenses are ₹{total_expense:.2f}, and Savings are ₹{net_savings:.2f}.* \n\n*General Budgeting Tip:* Since your current net savings are **₹{net_savings:.2f}**, try allocating 50% of income to needs, 30% to wants, and 20% to savings/debt repayment (50/30/20 rule)."
            }
            
    try:
        http_options = types.HttpOptions(client_args={"verify": False})
        client = genai.Client(api_key=api_key, http_options=http_options)
        
        system_prompt = (
            "You are a friendly, expert Personal Financial Coach. Your goal is to analyze the user's spending "
            "and income data, provide constructive budgeting advice, highlight potential overspending, "
            "and answer financial queries. Keep responses concise, structured (using markdown bullet points/bolding), "
            "and encouraging. Always base your advice on the user's transaction history provided below."
        )
        
        if question:
            prompt = (
                f"{system_prompt}\n\n"
                f"Financial Context:\n{summary_context}\n"
                f"User's Question: {question}\n\n"
                f"Please answer the user's question directly and concisely, referencing their financial context where relevant."
            )
        else:
            prompt = (
                f"{system_prompt}\n\n"
                f"Financial Context:\n{summary_context}\n"
                f"Please analyze this transaction history and provide 2-3 specific, actionable suggestions for saving money "
                f"or optimizing their budget based on their spending categories."
            )
            
        # Support configurable model with automatic fallback list on 503 high demand
        configured_model = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
        candidate_models = [configured_model, "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]
        # Deduplicate while preserving order
        models_to_try = list(dict.fromkeys(candidate_models))

        last_error = None
        for model_name in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                )
                if response and response.text:
                    return {"insight": response.text}
            except Exception as model_err:
                last_error = model_err
                err_str = str(model_err)
                # If 503, high demand, or model not found, attempt next model candidate
                if "503" in err_str or "404" in err_str or "unavailable" in err_str.lower() or "high demand" in err_str.lower() or "not found" in err_str.lower() or "not_found" in err_str.lower():
                    continue
                else:
                    raise model_err

        # If all candidates hit high demand, return friendly graceful analysis instead of 500
        if last_error and ("503" in str(last_error) or "UNAVAILABLE" in str(last_error) or "high demand" in str(last_error).lower()):
            return {
                "insight": f"**[Aura AI High Demand Notice]** Google's AI servers are temporarily experiencing high traffic.\n\n"
                           f"Here is your financial summary in the meantime:\n"
                           f"- **Total Income:** ₹{total_income:.2f}\n"
                           f"- **Total Expenses:** ₹{total_expense:.2f}\n"
                           f"- **Net Savings:** ₹{net_savings:.2f}\n\n"
                           f"💡 *Quick Tip:* Review your highest expense categories above in Month-Wise Analytics to identify immediate savings opportunities."
            }

        raise last_error or Exception("Unable to generate response from Gemini AI.")
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error communicating with Gemini AI: {str(e)}"
        )
