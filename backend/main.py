import os
import sqlite3
from typing import List, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

DB_PATH = os.environ.get("DATABASE_PATH", "finance.db")

app = FastAPI(title="Personal Money Tracker API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local development, allow all origins. Can be restricted to http://localhost:8080
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

class InsightRequest(BaseModel):
    question: Optional[str] = None

# Database initialization
def init_db():
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
    cursor.execute(
        "INSERT INTO transactions (description, amount, category, type, date) VALUES (?, ?, ?, ?, ?)",
        (tx.description, tx.amount, tx.category, tx.type, tx.date)
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    
    tx.id = new_id
    return tx

@app.delete("/api/transactions/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(tx_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM transactions WHERE id = ?", (tx_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Transaction not found.")
        
    cursor.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    conn.commit()
    conn.close()
    return None

@app.post("/api/insights")
def get_financial_insights(req: Optional[InsightRequest] = None):
    # Fetch all transactions to form context
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT description, amount, category, type, date FROM transactions")
    rows = cursor.fetchall()
    conn.close()
    
    transactions_list = [
        f"- {row['date']}: {row['type'].upper()} of ${row['amount']:.2f} for '{row['description']}' (Category: {row['category']})"
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
        f"- Total Income: ${total_income:.2f}\n"
        f"- Total Expenses: ${total_expense:.2f}\n"
        f"- Net Savings: ${net_savings:.2f}\n"
    )
    
    question = req.question if req else None
    
    # Configure Gemini SDK
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # Fallback if API key is not configured
        if question:
            return {
                "insight": f"**[Demo Mode - API Key Missing]** You asked: '{question}'.\n\nTo enable live responses from Gemini AI, please set the `GEMINI_API_KEY` environment variable on the server. \n\n*Based on your logs: Total Income is ${total_income:.2f}, Expenses are ${total_expense:.2f}, and Savings are ${net_savings:.2f}.*"
            }
        else:
            return {
                "insight": f"**[Demo Mode - API Key Missing]**\n\nTo enable live financial coaching from Gemini AI, please configure the `GEMINI_API_KEY` environment variable. \n\n*General Budgeting Tip:* Since your current net savings are **${net_savings:.2f}**, try allocating 50% of income to needs, 30% to wants, and 20% to savings/debt repayment (50/30/20 rule)."
            }
            
    try:
        genai.configure(api_key=api_key)
        # Use gemini-1.5-flash-latest as default model
        model = genai.GenerativeModel("gemini-1.5-flash-latest")
        
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
            
        response = model.generate_content(prompt)
        return {"insight": response.text}
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error communicating with Gemini AI: {str(e)}"
        )
