import os
import sqlite3
import re
import calendar
from datetime import datetime
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

# Locate database path consistently regardless of CWD
root_db = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "finance.db"))
backend_db = os.path.abspath(os.path.join(os.path.dirname(__file__), "finance.db"))
default_db = backend_db if os.path.exists(backend_db) else root_db
DB_PATH = os.environ.get("DATABASE_PATH", default_db)
DATABASE_URL = os.environ.get("DATABASE_URL")
IS_POSTGRES = DATABASE_URL is not None
DATE_REGEX = re.compile(r"^\d{4}-\d{2}-\d{2}$")

app = FastAPI(title="Personal Money Tracker API")

# Setup CORS with local and deployed origins
origins = [
    "http://localhost:8084",
    "http://127.0.0.1:8084",
    "http://localhost:3000",
    "https://crrmoney.netlify.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class Transaction(BaseModel):
    id: Optional[int] = None
    description: str
    amount: float
    category: str
    type: str  # "income" or "expense"
    date: str  # YYYY-MM-DD

class ChatHistoryItem(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class InsightRequest(BaseModel):
    question: Optional[str] = None
    history: Optional[List[ChatHistoryItem]] = None

def validate_transaction_payload(tx: Transaction):
    if not tx.description or not tx.description.strip():
        raise HTTPException(status_code=400, detail="Transaction description cannot be empty.")
    if tx.type not in ["income", "expense"]:
        raise HTTPException(status_code=400, detail="Transaction type must be 'income' or 'expense'.")
    if tx.amount <= 0:
        raise HTTPException(status_code=400, detail="Transaction amount must be positive.")
    if not tx.category or not tx.category.strip():
        raise HTTPException(status_code=400, detail="Transaction category cannot be empty.")
    clean_date = tx.date.strip() if tx.date else ""
    if not clean_date or not DATE_REGEX.match(clean_date):
        raise HTTPException(status_code=400, detail="Transaction date must be in YYYY-MM-DD format.")
    try:
        datetime.strptime(clean_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Transaction date is not a valid calendar date.")

    # Apply trimmed values
    tx.description = tx.description.strip()
    tx.category = tx.category.strip()
    tx.date = clean_date

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
        conn = sqlite3.connect(DB_PATH, timeout=30.0)
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
        except Exception:
            pass
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
        conn = sqlite3.connect(DB_PATH, timeout=30.0)
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
    validate_transaction_payload(tx)
        
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

@app.put("/api/transactions/{tx_id}", response_model=Transaction)
def update_transaction(tx_id: int, tx: Transaction):
    validate_transaction_payload(tx)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    select_query = "SELECT id FROM transactions WHERE id = %s" if IS_POSTGRES else "SELECT id FROM transactions WHERE id = ?"
    cursor.execute(select_query, (tx_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Transaction not found.")
        
    if IS_POSTGRES:
        cursor.execute(
            "UPDATE transactions SET description = %s, amount = %s, category = %s, type = %s, date = %s WHERE id = %s",
            (tx.description, tx.amount, tx.category, tx.type, tx.date, tx_id)
        )
    else:
        cursor.execute(
            "UPDATE transactions SET description = ?, amount = ?, category = ?, type = ?, date = ? WHERE id = ?",
            (tx.description, tx.amount, tx.category, tx.type, tx.date, tx_id)
        )
    conn.commit()
    conn.close()
    
    tx.id = tx_id
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
        current_ym = f"{now.year:04d}-{now.month:02d}"
        target_ym = current_ym if current_ym in sorted_months else sorted_months[-1]
    else:
        target_ym = f"{now.year:04d}-{now.month:02d}"

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

    # Multi-turn conversation context
    history_context = ""
    if req and req.history:
        formatted_turns = []
        for h in req.history[-6:]:
            speaker = "User" if h.role == "user" else "Aura"
            formatted_turns.append(f"{speaker}: {h.content}")
        if formatted_turns:
            history_context = "\nRecent Conversation History:\n" + "\n".join(formatted_turns) + "\n"
    
    # Configure Gemini SDK
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        if question:
            return {
                "insight": f"**[Demo Mode - API Key Missing]** You asked: '{question}'.\n\nTo enable live responses from Gemini AI, please set the `GEMINI_API_KEY` environment variable on the server. \n\n*Based on your logs: Total Income is ₹{total_income:.2f}, Expenses are ₹{total_expense:.2f}, and Savings are ₹{net_savings:.2f}.*"
            }
        else:
            return {
                "insight": f"**[Demo Mode - API Key Missing]**\n\nTo enable live financial coaching from Gemini AI, please configure the `GEMINI_API_KEY` environment variable. \n\n*Based on your logs: Total Income is ₹{total_income:.2f}, Expenses are ₹{total_expense:.2f}, and Savings are ₹{net_savings:.2f}.* \n\n*General Budgeting Tip:* Since your current net savings are **₹{net_savings:.2f}**, try allocating 50% of income to needs, 30% to wants, and 20% to savings/debt repayment (50/30/20 rule)."
            }
            
    try:
        # Respect SSL verification by default
        verify_ssl = os.environ.get("GEMINI_VERIFY_SSL", "true").lower() != "false"
        if not verify_ssl:
            http_options = types.HttpOptions(client_args={"verify": False})
            client = genai.Client(api_key=api_key, http_options=http_options)
        else:
            client = genai.Client(api_key=api_key)
        
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
                f"{history_context}"
                f"User's Question: {question}\n\n"
                f"Please answer the user's question directly and concisely, referencing their financial context and conversation history where relevant."
            )
        else:
            prompt = (
                f"{system_prompt}\n\n"
                f"Financial Context:\n{summary_context}\n"
                f"Please analyze this transaction history and provide 2-3 specific, actionable suggestions for saving money "
                f"or optimizing their budget based on their spending categories."
            )
            
        # Support valid Gemini model candidates with automatic fallback
        configured_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        candidate_models = [configured_model, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
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
                if "503" in err_str or "404" in err_str or "unavailable" in err_str.lower() or "high demand" in err_str.lower() or "not found" in err_str.lower() or "not_found" in err_str.lower():
                    continue
                else:
                    raise model_err

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

class VoiceActionDraft(BaseModel):
    action_type: str  # "add_transaction" | "update_transaction" | "delete_transaction"
    description: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    type: Optional[str] = "expense"
    date: Optional[str] = None
    transaction_id: Optional[int] = None

class VoiceAgentRequest(BaseModel):
    transcript: str
    history: Optional[List[ChatHistoryItem]] = None
    pending_action: Optional[VoiceActionDraft] = None
    user_confirmed: Optional[bool] = None

class VoiceAgentResponse(BaseModel):
    spoken_response: str
    action_taken: Optional[dict] = None
    pending_action: Optional[VoiceActionDraft] = None
    should_refresh_data: bool = False

@app.post("/api/agent/voice", response_model=VoiceAgentResponse)
def process_voice_command(req: VoiceAgentRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, description, amount, category, type, date FROM transactions ORDER BY date DESC, id DESC")
    rows = cursor.fetchall()
    conn.close()

    total_income = sum(row['amount'] for row in rows if row['type'] == 'income')
    total_expense = sum(row['amount'] for row in rows if row['type'] == 'expense')
    net_savings = total_income - total_expense
    
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    current_ym = now.strftime("%Y-%m")
    current_month_name = calendar.month_name[now.month]

    # Calculate Current Month Analytics
    month_expenses = [r for r in rows if r['type'] == 'expense' and r['date'] and r['date'].startswith(current_ym)]
    month_incomes = [r for r in rows if r['type'] == 'income' and r['date'] and r['date'].startswith(current_ym)]
    
    # If current month has no transactions, fallback to latest active month
    active_ym = current_ym
    active_month_name = current_month_name
    if not month_expenses and not month_incomes and rows:
        active_ym = rows[0]['date'][:7] if rows[0]['date'] else current_ym
        ym_parts = active_ym.split("-")
        if len(ym_parts) == 2:
            try:
                active_month_name = calendar.month_name[int(ym_parts[1])]
            except Exception:
                active_month_name = current_month_name
        month_expenses = [r for r in rows if r['type'] == 'expense' and r['date'] and r['date'].startswith(active_ym)]
        month_incomes = [r for r in rows if r['type'] == 'income' and r['date'] and r['date'].startswith(active_ym)]

    month_exp_total = sum(r['amount'] for r in month_expenses)
    month_inc_total = sum(r['amount'] for r in month_incomes)
    month_net = month_inc_total - month_exp_total
    month_sav_rate = round((month_net / month_inc_total * 100), 1) if month_inc_total > 0 else 0.0

    # Daily aggregation for peak day calculation
    daily_spend_map: dict = {}
    for r in month_expenses:
        d = r['date']
        daily_spend_map[d] = daily_spend_map.get(d, 0.0) + float(r['amount'])

    peak_date = max(daily_spend_map, key=daily_spend_map.get) if daily_spend_map else None
    peak_amount = daily_spend_map[peak_date] if peak_date else 0.0
    peak_day_num = int(peak_date.split("-")[2]) if peak_date else None
    peak_items = [r for r in month_expenses if r['date'] == peak_date] if peak_date else []
    peak_top_item = max(peak_items, key=lambda x: x['amount']) if peak_items else None

    # Category breakdown for current month
    month_cat_sums: dict = {}
    for r in month_expenses:
        c = r['category']
        month_cat_sums[c] = month_cat_sums.get(c, 0.0) + float(r['amount'])
    top_cat_month = max(month_cat_sums, key=month_cat_sums.get) if month_cat_sums else None
    top_cat_month_amt = month_cat_sums[top_cat_month] if top_cat_month else 0.0
    top_cat_pct = round((top_cat_month_amt / month_exp_total * 100), 1) if month_exp_total > 0 else 0.0

    # Highest single expense
    highest_tx_month = max(month_expenses, key=lambda x: x['amount']) if month_expenses else None
    all_expenses = [r for r in rows if r['type'] == 'expense']
    highest_tx_all = max(all_expenses, key=lambda x: x['amount']) if all_expenses else None

    transcript_clean = req.transcript.strip()
    transcript_lower = transcript_clean.lower()

    # 1. Handle Confirmation / Cancellation of a pending action
    if req.pending_action:
        pending = req.pending_action
        is_yes = req.user_confirmed is True or any(w in transcript_lower for w in ["yes", "confirm", "proceed", "sure", "ok", "go ahead", "do it", "yeah", "yep", "correct"])
        is_no = req.user_confirmed is False or any(w in transcript_lower for w in ["no", "cancel", "stop", "don't", "dont", "nevermind", "abort", "nope"])

        if is_yes:
            conn = get_db_connection()
            cur = conn.cursor()
            if pending.action_type == "add_transaction":
                desc = pending.description or "Expense"
                amt = float(pending.amount or 0.0)
                cat = pending.category or "Other"
                ttype = pending.type or "expense"
                dt = pending.date or today_str
                
                if IS_POSTGRES:
                    cur.execute("INSERT INTO transactions (description, amount, category, type, date) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                                (desc, amt, cat, ttype, dt))
                    new_id = cur.fetchone()["id"]
                else:
                    cur.execute("INSERT INTO transactions (description, amount, category, type, date) VALUES (?, ?, ?, ?, ?)",
                                (desc, amt, cat, ttype, dt))
                    new_id = cur.lastrowid
                conn.commit()
                conn.close()

                new_balance = net_savings + (amt if ttype == "income" else -amt)
                return VoiceAgentResponse(
                    spoken_response=f"Confirmed! Logged ₹{amt:,.2f} for {desc} under {cat}. Your net balance is now ₹{new_balance:,.2f}.",
                    action_taken={"type": "added", "id": new_id, "description": desc, "amount": amt, "category": cat, "date": dt},
                    pending_action=None,
                    should_refresh_data=True
                )
            elif pending.action_type == "delete_transaction" and pending.transaction_id:
                tx_id = pending.transaction_id
                q = "DELETE FROM transactions WHERE id = %s" if IS_POSTGRES else "DELETE FROM transactions WHERE id = ?"
                cur.execute(q, (tx_id,))
                conn.commit()
                conn.close()
                return VoiceAgentResponse(
                    spoken_response=f"Deleted transaction for {pending.description or 'item'}.",
                    action_taken={"type": "deleted", "id": tx_id},
                    pending_action=None,
                    should_refresh_data=True
                )
            elif pending.action_type == "update_transaction" and pending.transaction_id:
                tx_id = pending.transaction_id
                desc = pending.description or "Updated"
                amt = float(pending.amount or 0.0)
                cat = pending.category or "Other"
                ttype = pending.type or "expense"
                dt = pending.date or today_str
                if IS_POSTGRES:
                    cur.execute("UPDATE transactions SET description = %s, amount = %s, category = %s, type = %s, date = %s WHERE id = %s",
                                (desc, amt, cat, ttype, dt, tx_id))
                else:
                    cur.execute("UPDATE transactions SET description = ?, amount = ?, category = ?, type = ?, date = ? WHERE id = ?",
                                (desc, amt, cat, ttype, dt, tx_id))
                conn.commit()
                conn.close()
                return VoiceAgentResponse(
                    spoken_response=f"Updated {desc} to ₹{amt:,.2f}.",
                    action_taken={"type": "updated", "id": tx_id, "description": desc, "amount": amt},
                    pending_action=None,
                    should_refresh_data=True
                )

        if is_no:
            return VoiceAgentResponse(
                spoken_response="Understood, I have cancelled that action.",
                action_taken=None,
                pending_action=None,
                should_refresh_data=False
            )

    # 2. Direct Greeting Handler for Chiranth
    if re.search(r"^\s*(hi|hello|hey|hey aura|good\s*(morning|afternoon|evening))\b", transcript_lower):
        return VoiceAgentResponse(
            spoken_response="Hey Chiranth! What do you want to track or check today?",
            pending_action=None,
            should_refresh_data=False
        )

    # 3. Check for Direct Keyword Heuristics for Deletion of Last Transaction
    if "delete last" in transcript_lower or "remove last" in transcript_lower:
        if rows:
            last_tx = rows[0]
            draft = VoiceActionDraft(
                action_type="delete_transaction",
                description=last_tx["description"],
                amount=last_tx["amount"],
                category=last_tx["category"],
                transaction_id=last_tx["id"]
            )
            return VoiceAgentResponse(
                spoken_response=f"Are you sure you want to delete your last transaction for {last_tx['description']} of ₹{last_tx['amount']:,.2f}?",
                pending_action=draft,
                should_refresh_data=False
            )
        else:
            return VoiceAgentResponse(
                spoken_response="You have no transactions logged to delete.",
                pending_action=None,
                should_refresh_data=False
            )

    # 4. Use Gemini AI for Agentic Reasoning if API Key is Present
    api_key = os.environ.get("GEMINI_API_KEY")
    if api_key:
        try:
            verify_ssl = os.environ.get("GEMINI_VERIFY_SSL", "true").lower() != "false"
            if not verify_ssl:
                http_options = types.HttpOptions(client_args={"verify": False})
                client = genai.Client(api_key=api_key, http_options=http_options)
            else:
                client = genai.Client(api_key=api_key)

            transactions_context = "\n".join([
                f"- ID {r['id']}: {r['date']} | {r['type'].upper()} | ₹{r['amount']} | '{r['description']}' ({r['category']})"
                for r in rows[:25]
            ])

            peak_summary = f"Peak Spending Day: Day {peak_day_num} ({peak_date}) with ₹{peak_amount:.2f} spent (Top item: {peak_top_item['description'] if peak_top_item else 'None'})" if peak_date else "No peak day recorded."

            system_instruction = f"""
You are Aura, a friendly, concise AI financial voice assistant speaking with Chiranth.
Today's date is {today_str}.
User's Financial Summary: Total Income ₹{total_income:.2f}, Total Expenses ₹{total_expense:.2f}, Net Balance ₹{net_savings:.2f}.
Current Active Month ({active_month_name}): Total Spent ₹{month_exp_total:.2f}, Total Income ₹{month_inc_total:.2f}, Net ₹{month_net:.2f}, Savings Rate {month_sav_rate}%.
{peak_summary}
Top Category ({active_month_name}): {top_cat_month} (₹{top_cat_month_amt:.2f}, {top_cat_pct}%).
Recent transactions:
{transactions_context if transactions_context else "No transactions logged yet."}

Your job is to analyze the user's spoken input and return a strict JSON response.
Allowed categories: 'Food', 'Salary', 'Rent', 'Utilities', 'Leisure', 'Entertainment', 'Other'.

Output Schema (MUST return JSON ONLY without markdown backticks):
{{
  "intent": "draft_add" | "draft_delete" | "draft_update" | "query_answer" | "advice" | "chat",
  "draft": {{
    "action_type": "add_transaction" | "delete_transaction" | "update_transaction",
    "description": "string (capitalized merchant/item)",
    "amount": number,
    "category": "Food" | "Salary" | "Rent" | "Utilities" | "Leisure" | "Entertainment" | "Other",
    "type": "expense" | "income",
    "date": "YYYY-MM-DD",
    "transaction_id": number or null
  }} or null,
  "spoken_response": "1-2 concise sentences for text-to-speech voice output"
}}

Rules:
1. When user greets (e.g. "Hi", "Hello"):
   - spoken_response MUST be: "Hey Chiranth! What do you want to track or check today?"
2. When user wants to log/add an expense or income:
   - Set intent to "draft_add".
   - Infer the category intelligently.
   - Default date to {today_str} if not mentioned.
   - spoken_response MUST ask for confirmation: "I will log an expense of ₹[amount] for [description] under [category] for today. Shall I confirm this?"
3. When user asks for the highest point / peak day / highest expense:
   - Set intent to "query_answer".
   - Answer directly referencing Day {peak_day_num} ({peak_date}) and the ₹{peak_amount:.2f} spent.
4. When user asks a spending/financial query or advice:
   - Answer accurately and concisely in 1-2 sentences. Keep spoken_response under 30 words.
"""
            configured_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
            candidate_models = [configured_model, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
            models_to_try = list(dict.fromkeys(candidate_models))

            for model_name in models_to_try:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=f"{system_instruction}\n\nUser Spoke: \"{transcript_clean}\"",
                    )
                    if response and response.text:
                        raw_json = response.text.strip()
                        if raw_json.startswith("```"):
                            raw_json = re.sub(r"^```(?:json)?|```$", "", raw_json, flags=re.MULTILINE).strip()
                        
                        import json
                        parsed = json.loads(raw_json)
                        spoken = parsed.get("spoken_response", "I heard your request.")
                        draft_data = parsed.get("draft")
                        
                        draft_obj = None
                        if draft_data and parsed.get("intent") in ["draft_add", "draft_delete", "draft_update"]:
                            draft_obj = VoiceActionDraft(
                                action_type=draft_data.get("action_type", "add_transaction"),
                                description=draft_data.get("description"),
                                amount=float(draft_data.get("amount") or 0.0),
                                category=draft_data.get("category", "Other"),
                                type=draft_data.get("type", "expense"),
                                date=draft_data.get("date", today_str),
                                transaction_id=draft_data.get("transaction_id")
                            )

                        return VoiceAgentResponse(
                            spoken_response=spoken,
                            pending_action=draft_obj,
                            should_refresh_data=False
                        )
                except Exception:
                    continue
        except Exception:
            pass

    # 5. Rich Local Semantic & Conversational Intelligence Engine
    
    # A. Wealth Doubling / Investment / Wealth Growth / Compounding
    if any(w in transcript_lower for w in ["double", "grow money", "grow wealth", "multiply", "invest", "investment", "stocks", "mutual fund", "sip", "compounding", "wealth building", "passive income", "make more money", "financial freedom"]):
        target_doubled = net_savings * 2
        return VoiceAgentResponse(
            spoken_response=f"To double your net balance of ₹{net_savings:,.0f} to ₹{target_doubled:,.0f}, you can use the Rule of 72. At an average 12% annual return in index mutual funds or equity SIPs, your money will double in about 6 years. The fastest way is to invest your monthly surplus and reduce discretionary spending.",
            pending_action=None,
            should_refresh_data=False
        )

    # B. Highest Point / Peak Spending Day / Peak Point
    if any(w in transcript_lower for w in ["highest point", "peak point", "peak day", "peak spend", "highest spending day", "highest spend day", "biggest day", "most expensive day"]):
        if peak_date and peak_day_num:
            item_info = f", led by {peak_top_item['description']} of ₹{peak_top_item['amount']:,.2f}" if peak_top_item else ""
            return VoiceAgentResponse(
                spoken_response=f"Your highest spending point in {active_month_name} was on Day {peak_day_num} ({peak_date}) with ₹{peak_amount:,.2f} spent{item_info}.",
                pending_action=None,
                should_refresh_data=False
            )
        else:
            return VoiceAgentResponse(
                spoken_response=f"You have no recorded expenses for {active_month_name} yet.",
                pending_action=None,
                should_refresh_data=False
            )

    # C. Highest / Biggest Single Expense Item
    if any(w in transcript_lower for w in ["biggest expense", "highest expense", "biggest transaction", "highest transaction", "largest expense", "highest single", "biggest purchase"]):
        if "this month" in transcript_lower and highest_tx_month:
            return VoiceAgentResponse(
                spoken_response=f"Your highest single expense in {active_month_name} was ₹{highest_tx_month['amount']:,.2f} for {highest_tx_month['description']} under {highest_tx_month['category']} on {highest_tx_month['date']}.",
                pending_action=None,
                should_refresh_data=False
            )
        elif highest_tx_all:
            return VoiceAgentResponse(
                spoken_response=f"Your highest single expense all-time was ₹{highest_tx_all['amount']:,.2f} for {highest_tx_all['description']} under {highest_tx_all['category']} on {highest_tx_all['date']}.",
                pending_action=None,
                should_refresh_data=False
            )

    # D. Top Spending Category / Most Spent On
    if any(w in transcript_lower for w in ["top category", "highest category", "spend the most", "spent the most", "biggest category", "most spent on"]):
        if top_cat_month:
            return VoiceAgentResponse(
                spoken_response=f"Your top expense category in {active_month_name} is {top_cat_month} at ₹{top_cat_month_amt:,.2f}, accounting for {top_cat_pct}% of your monthly expenses.",
                pending_action=None,
                should_refresh_data=False
            )

    # E. Financial Health / "How am I doing"
    if any(w in transcript_lower for w in ["how am i doing", "financial health", "am i spending too much", "how are my finances", "rate my budget", "financial status", "how's my spending", "am i broke"]):
        if net_savings > 50000:
            return VoiceAgentResponse(
                spoken_response=f"You're in great shape, Chiranth! Your net balance is ₹{net_savings:,.2f} with total income of ₹{total_income:,.2f}. Keeping your expenses controlled will accelerate your financial growth.",
                pending_action=None,
                should_refresh_data=False
            )
        else:
            return VoiceAgentResponse(
                spoken_response=f"Your net balance is ₹{net_savings:,.2f}. In {active_month_name}, you spent ₹{month_exp_total:,.2f}. Focus on trimming non-essential costs to build a stronger safety net.",
                pending_action=None,
                should_refresh_data=False
            )

    # F. Emergency Fund / Safety Net
    if any(w in transcript_lower for w in ["emergency fund", "emergency savings", "safety net", "rainy day"]):
        target_ef_min = month_exp_total * 3 if month_exp_total > 0 else 30000
        target_ef_max = month_exp_total * 6 if month_exp_total > 0 else 60000
        return VoiceAgentResponse(
            spoken_response=f"A healthy emergency fund should cover 3 to 6 months of living expenses. For your spending level, aim for ₹{target_ef_min:,.0f} to ₹{target_ef_max:,.0f} in liquid savings.",
            pending_action=None,
            should_refresh_data=False
        )

    # G. Savings Strategies & Cost Cutting
    if any(w in transcript_lower for w in ["how to save", "save more", "cut cost", "cut expenses", "reduce spending", "save faster", "spend less"]):
        cat_hint = f" Start by putting a cap on {top_cat_month} (currently ₹{top_cat_month_amt:,.2f})." if top_cat_month else ""
        return VoiceAgentResponse(
            spoken_response=f"To boost your savings, automate an investment transfer on payday and follow the 50/30/20 rule.{cat_hint}",
            pending_action=None,
            should_refresh_data=False
        )

    # H. Budgeting Rules
    if any(w in transcript_lower for w in ["50 30 20", "50/30/20", "budget rule", "budgeting rule", "rule of 72"]):
        return VoiceAgentResponse(
            spoken_response="The 50/30/20 rule recommends spending 50% on needs, 30% on wants, and allocating 20% directly to savings and investments.",
            pending_action=None,
            should_refresh_data=False
        )

    # I. Monthly Spending / Total Expense This Month
    if any(w in transcript_lower for w in ["spent this month", "this month expenses", "spending this month", "total expense this month", "monthly spend", "expenses this month", "how much did i spend"]):
        return VoiceAgentResponse(
            spoken_response=f"In {active_month_name}, your total spending is ₹{month_exp_total:,.2f} across {len(month_expenses)} logged expenses.",
            pending_action=None,
            should_refresh_data=False
        )

    # J. Monthly Income
    if any(w in transcript_lower for w in ["income this month", "earned this month", "earnings this month", "received this month", "salary this month"]):
        return VoiceAgentResponse(
            spoken_response=f"In {active_month_name}, your total income is ₹{month_inc_total:,.2f}.",
            pending_action=None,
            should_refresh_data=False
        )

    # K. Savings Rate / Monthly Savings
    if any(w in transcript_lower for w in ["savings rate", "saved this month", "monthly savings", "savings this month"]):
        return VoiceAgentResponse(
            spoken_response=f"For {active_month_name}, your net savings are ₹{month_net:,.2f} with a savings rate of {month_sav_rate}%.",
            pending_action=None,
            should_refresh_data=False
        )

    # L. Overall Net Balance
    if any(w in transcript_lower for w in ["balance", "net balance", "how much do i have", "total savings", "total balance", "how much money"]):
        return VoiceAgentResponse(
            spoken_response=f"Hey Chiranth, your current net balance is ₹{net_savings:,.2f}, with ₹{total_income:,.2f} in total income and ₹{total_expense:,.2f} in total expenses.",
            pending_action=None,
            should_refresh_data=False
        )

    # M. Advice / Budgeting Tips
    if any(w in transcript_lower for w in ["advice", "tip", "suggest", "recommendation"]):
        cat_tip = f" Since {top_cat_month} is your largest spend at ₹{top_cat_month_amt:,.2f}, setting a weekly budget there will make a big difference." if top_cat_month else ""
        return VoiceAgentResponse(
            spoken_response=f"Your net balance is ₹{net_savings:,.2f}.{cat_tip} Aim to invest at least 20% of your earnings systematically.",
            pending_action=None,
            should_refresh_data=False
        )

    # N. Bot Persona / Small Talk / Appreciation
    if any(w in transcript_lower for w in ["thank you", "thanks", "awesome", "great job", "you're smart", "good job", "nice"]):
        return VoiceAgentResponse(
            spoken_response="You're very welcome, Chiranth! I'm here anytime to help you stay on top of your financial goals.",
            pending_action=None,
            should_refresh_data=False
        )

    if any(w in transcript_lower for w in ["who are you", "what are you", "what is your name"]):
        return VoiceAgentResponse(
            spoken_response="I'm Aura, your AI financial assistant. I help you track transactions, manage your budget, and build long-term wealth.",
            pending_action=None,
            should_refresh_data=False
        )

    if any(w in transcript_lower for w in ["what can you do", "help me", "how to use", "capabilities"]):
        return VoiceAgentResponse(
            spoken_response="You can ask me to log expenses, check your balance, review peak spending days, or get tailored financial advice.",
            pending_action=None,
            should_refresh_data=False
        )

    # O. Log/Add Expense or Income via Heuristics
    amount_match = re.search(r"(?:₹|rs\.?|rupees?)?\s*(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|rupees?)?", transcript_lower)
    if amount_match:
        amt = float(amount_match.group(1))
        ttype = "income" if any(w in transcript_lower for w in ["salary", "earned", "income", "received", "credited", "freelance"]) else "expense"
        
        category = "Other"
        if any(w in transcript_lower for w in ["food", "pizza", "burger", "lunch", "dinner", "breakfast", "swiggy", "zomato", "groceries", "milk", "tea", "coffee", "restaurant", "snack"]):
            category = "Food"
        elif any(w in transcript_lower for w in ["salary", "bonus", "dividend", "interest"]):
            category = "Salary"
        elif any(w in transcript_lower for w in ["rent", "pg", "flat", "room"]):
            category = "Rent"
        elif any(w in transcript_lower for w in ["bill", "electricity", "water", "wifi", "internet", "petrol", "gas", "fuel", "cab", "uber", "ola", "recharge", "utilities"]):
            category = "Utilities"
        elif any(w in transcript_lower for w in ["movie", "cinema", "netflix", "prime", "game", "gaming", "concert"]):
            category = "Entertainment"
        elif any(w in transcript_lower for w in ["shopping", "clothes", "shoes", "amazon", "flipkart", "party", "trip"]):
            category = "Leisure"

        desc = transcript_clean
        clean_words = [w for w in transcript_clean.split() if not re.match(r"^(spent|log|add|paid|for|on|₹|rs|rupees?|\d+)$", w, re.I)]
        if clean_words:
            desc = " ".join(clean_words).capitalize()
        else:
            desc = f"{category} Expense"

        draft = VoiceActionDraft(
            action_type="add_transaction",
            description=desc,
            amount=amt,
            category=category,
            type=ttype,
            date=today_str
        )
        return VoiceAgentResponse(
            spoken_response=f"I will log a {ttype} of ₹{amt:,.2f} for {desc} under {category} for today. Shall I confirm this?",
            pending_action=draft,
            should_refresh_data=False
        )

    # P. Intelligent Contextual Conversational Fallback (Natural, personalized, helpful)
    return VoiceAgentResponse(
        spoken_response=f"I hear you, Chiranth! With your current balance of ₹{net_savings:,.2f}, smart budgeting and disciplined investing are your best moves. What specific financial goal are you targeting?",
        pending_action=None,
        should_refresh_data=False
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8083))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)



