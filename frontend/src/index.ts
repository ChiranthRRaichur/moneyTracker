import "./styles.css";

const BACKEND_URL = "http://localhost:8083";

interface Transaction {
  id?: number;
  description: string;
  amount: number;
  category: string;
  type: "income" | "expense";
  date: string;
}

// State
let transactions: Transaction[] = [];

// DOM Elements
const apiStatusBadge = document.getElementById("api-status") as HTMLDivElement;
const netBalanceEl = document.getElementById("net-balance") as HTMLHeadingElement;
const netBalanceTrendEl = document.getElementById("net-balance-trend") as HTMLSpanElement;
const totalIncomeEl = document.getElementById("total-income") as HTMLHeadingElement;
const totalIncomeCountEl = document.getElementById("total-income-count") as HTMLSpanElement;
const totalExpensesEl = document.getElementById("total-expenses") as HTMLHeadingElement;
const totalExpensesCountEl = document.getElementById("total-expenses-count") as HTMLSpanElement;

const transactionForm = document.getElementById("transaction-form") as HTMLFormElement;
const txDescriptionInput = document.getElementById("tx-description") as HTMLInputElement;
const txAmountInput = document.getElementById("tx-amount") as HTMLInputElement;
const txTypeSelect = document.getElementById("tx-type") as HTMLSelectElement;
const txCategorySelect = document.getElementById("tx-category") as HTMLSelectElement;
const txDateInput = document.getElementById("tx-date") as HTMLInputElement;

const ledgerListEl = document.getElementById("ledger-list") as HTMLDivElement;

const aiInsightPanelEl = document.getElementById("ai-insight-panel") as HTMLDivElement;
const chatMessagesEl = document.getElementById("chat-messages") as HTMLDivElement;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const btnRefreshInsights = document.getElementById("btn-refresh-insights") as HTMLButtonElement;

// Helper to set current date in form
const setDefaultDate = () => {
  const today = new Date().toISOString().split("T")[0];
  txDateInput.value = today;
};

// Inline Markdown Helper
function parseInlineMarkdown(text: string): string {
  // Convert bold: **text** -> <strong>text</strong>
  let html = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Convert italic: *text* -> <em>text</em>
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  return html;
}

// Markdown Parser Helper for AI text
function parseMarkdown(text: string): string {
  const lines = text.split(/\r?\n/);
  let html = "";
  let currentListType: "ul" | "ol" | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
      if (currentListType) {
        html += `</${currentListType}>`;
        currentListType = null;
      }
      continue;
    }

    if (line === "---" || line === "***") {
      if (currentListType) {
        html += `</${currentListType}>`;
        currentListType = null;
      }
      html += "<hr>";
      continue;
    }

    const isBulletList = line.startsWith("* ") || line.startsWith("- ");
    const isNumberedList = /^\d+\.\s/.test(line);

    if (isBulletList || isNumberedList) {
      const newListType = isBulletList ? "ul" : "ol";
      if (currentListType && currentListType !== newListType) {
        html += `</${currentListType}>`;
        currentListType = null;
      }
      if (!currentListType) {
        html += `<${newListType}>`;
        currentListType = newListType;
      }
      const content = isBulletList ? line.substring(2) : line.replace(/^\d+\.\s/, "");
      html += `<li>${parseInlineMarkdown(content)}</li>`;
    } else {
      if (currentListType) {
        html += `</${currentListType}>`;
        currentListType = null;
      }

      if (line.startsWith("### ")) {
        html += `<h3>${parseInlineMarkdown(line.substring(4))}</h3>`;
      } else if (line.startsWith("## ")) {
        html += `<h2>${parseInlineMarkdown(line.substring(3))}</h2>`;
      } else if (line.startsWith("# ")) {
        html += `<h1>${parseInlineMarkdown(line.substring(2))}</h1>`;
      } else {
        html += `<p>${parseInlineMarkdown(line)}</p>`;
      }
    }
  }

  if (currentListType) {
    html += `</${currentListType}>`;
  }

  return html;
}

// Check backend API connection status
async function checkApiStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/transactions`);
    if (response.ok) {
      apiStatusBadge.className = "api-status-badge";
      apiStatusBadge.innerHTML = `
        <span class="status-dot green"></span>
        <span class="status-text">Backend Connected</span>
      `;
      return true;
    } else {
      throw new Error();
    }
  } catch (error) {
    apiStatusBadge.className = "api-status-badge error";
    apiStatusBadge.innerHTML = `
        <span class="status-dot red"></span>
        <span class="status-text">Backend Offline</span>
      `;
    return false;
  }
}

// Fetch all transactions
async function loadTransactions() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/transactions`);
    if (!response.ok) throw new Error("Failed to load transactions.");
    transactions = await response.json();
    updateUI();
  } catch (error) {
    console.error(error);
    showNotification("Error loading transactions from database.", "danger");
  }
}

// Add a transaction
async function createTransaction(tx: Transaction) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tx)
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Error adding transaction.");
    }
    const newTx = await response.json();
    transactions.unshift(newTx); // Add to local state (at front)
    updateUI();
    showNotification("Transaction logged successfully!", "success");
    // Trigger auto-refresh of insights
    fetchAutomatedInsights();
  } catch (error: any) {
    showNotification(error.message, "danger");
  }
}

// Delete a transaction
async function removeTransaction(id: number) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/transactions/${id}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Failed to delete transaction.");
    
    transactions = transactions.filter(t => t.id !== id);
    updateUI();
    showNotification("Transaction deleted.", "success");
    // Trigger auto-refresh of insights
    fetchAutomatedInsights();
  } catch (error) {
    showNotification("Error deleting transaction.", "danger");
  }
}

// Fetch automated budget insights
async function fetchAutomatedInsights() {
  aiInsightPanelEl.innerHTML = `
    <div class="insight-placeholder">
      <div class="typing-loader">
        <span></span><span></span><span></span>
      </div>
      <p style="margin-top: 0.5rem;">Analyzing spending ledger...</p>
    </div>
  `;
  try {
    const response = await fetch(`${BACKEND_URL}/api/insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    
    aiInsightPanelEl.innerHTML = `
      <h4>Smart Budget Insights</h4>
      <div>${parseMarkdown(data.insight)}</div>
    `;
  } catch (error) {
    aiInsightPanelEl.innerHTML = `
      <div class="insight-placeholder" style="color: var(--accent-danger);">
        ⚠️ Failed to retrieve AI insights. Verify your backend is running.
      </div>
    `;
  }
}

// Interactive chat with AI financial coach
async function askCoach(question: string) {
  // Append user message
  appendChatMessage(question, "user");
  
  // Append loading bubble
  const loaderId = appendLoadingMessage();
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  try {
    const response = await fetch(`${BACKEND_URL}/api/insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    
    removeLoadingMessage(loaderId);
    
    if (!response.ok) throw new Error();
    const data = await response.json();
    
    appendChatMessage(data.insight, "assistant");
  } catch (error) {
    removeLoadingMessage(loaderId);
    appendChatMessage("Sorry, I had trouble processing your question. Please verify the backend connection.", "assistant");
  }
  
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// DOM UI updating
function updateUI() {
  // 1. Calculate metrics
  let income = 0;
  let expenses = 0;
  let incomeCount = 0;
  let expensesCount = 0;
  
  transactions.forEach(t => {
    if (t.type === "income") {
      income += t.amount;
      incomeCount++;
    } else {
      expenses += t.amount;
      expensesCount++;
    }
  });
  
  const balance = income - expenses;
  
  // 2. Render cards
  netBalanceEl.innerText = `${balance < 0 ? "-" : ""}₹${Math.abs(balance).toFixed(2)}`;
  totalIncomeEl.innerText = `₹${income.toFixed(2)}`;
  totalExpensesEl.innerText = `₹${expenses.toFixed(2)}`;
  
  totalIncomeCountEl.innerText = `${incomeCount} items logged`;
  totalExpensesCountEl.innerText = `${expensesCount} items logged`;
  
  if (balance > 0) {
    netBalanceTrendEl.innerText = "🟢 Net Surplus";
    netBalanceTrendEl.style.color = "var(--accent-success)";
  } else if (balance < 0) {
    netBalanceTrendEl.innerText = "🔴 Net Deficit";
    netBalanceTrendEl.style.color = "var(--accent-danger)";
  } else {
    netBalanceTrendEl.innerText = "⚪ Even Ledger";
    netBalanceTrendEl.style.color = "var(--text-muted)";
  }

  // 3. Render Ledger
  if (transactions.length === 0) {
    ledgerListEl.innerHTML = `
      <div class="ledger-empty">
        <p>No transactions logged yet. Add one above to get started!</p>
      </div>
    `;
    return;
  }
  
  ledgerListEl.innerHTML = transactions.map(t => {
    const amountClass = t.type === "income" ? "text-success" : "text-danger";
    const amountPrefix = t.type === "income" ? "+" : "-";
    const tagClass = `tag-${t.category.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    
    return `
      <div class="ledger-row" data-id="${t.id}">
        <span class="tx-desc-cell">${t.description}</span>
        <span><span class="tag ${tagClass}">${t.category}</span></span>
        <span class="tx-date-cell">${t.date}</span>
        <span class="tx-amount-cell ${amountClass} text-right">${amountPrefix}₹${t.amount.toFixed(2)}</span>
        <span>
          <button class="btn-delete" data-id="${t.id}" title="Delete transaction">×</button>
        </span>
      </div>
    `;
  }).join("");
  
  // Wire delete buttons
  const deleteButtons = ledgerListEl.querySelectorAll(".btn-delete");
  deleteButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const id = parseInt(target.getAttribute("data-id") || "0");
      if (id) {
        removeTransaction(id);
      }
    });
  });
}

// Chat UI helpers
function appendChatMessage(text: string, sender: "user" | "assistant") {
  const msgEl = document.createElement("div");
  msgEl.className = `chat-message ${sender}`;
  
  const bubbleEl = document.createElement("div");
  bubbleEl.className = "message-bubble";
  
  if (sender === "assistant") {
    bubbleEl.innerHTML = parseMarkdown(text);
  } else {
    bubbleEl.innerText = text;
  }
  
  msgEl.appendChild(bubbleEl);
  chatMessagesEl.appendChild(msgEl);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

let loaderCount = 0;
function appendLoadingMessage(): string {
  const loaderId = `loader-${++loaderCount}`;
  const msgEl = document.createElement("div");
  msgEl.className = "chat-message assistant";
  msgEl.id = loaderId;
  
  const bubbleEl = document.createElement("div");
  bubbleEl.className = "message-bubble";
  bubbleEl.innerHTML = `
    <div class="typing-loader">
      <span></span><span></span><span></span>
    </div>
  `;
  
  msgEl.appendChild(bubbleEl);
  chatMessagesEl.appendChild(msgEl);
  return loaderId;
}

function removeLoadingMessage(id: string) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// Custom simple toast notification system
function showNotification(message: string, type: "success" | "danger") {
  const toast = document.createElement("div");
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.background = type === "success" ? "rgba(16, 185, 129, 0.95)" : "rgba(244, 63, 94, 0.95)";
  toast.style.color = "#ffffff";
  toast.style.padding = "0.75rem 1.5rem";
  toast.style.borderRadius = "8px";
  toast.style.zIndex = "1000";
  toast.style.fontWeight = "600";
  toast.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.25)";
  toast.style.backdropFilter = "blur(5px)";
  toast.style.fontSize = "0.9rem";
  toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
  toast.style.opacity = "0";
  toast.style.transform = "translateY(20px)";
  
  toast.innerText = message;
  document.body.appendChild(toast);
  
  // Force reflow
  toast.offsetHeight;
  
  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";
  
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Event Listeners Setup
transactionForm.addEventListener("submit", (e) => {
  e.preventDefault();
  
  const tx: Transaction = {
    description: txDescriptionInput.value.trim(),
    amount: parseFloat(txAmountInput.value),
    type: txTypeSelect.value as "income" | "expense",
    category: txCategorySelect.value,
    date: txDateInput.value
  };
  
  if (!tx.description || isNaN(tx.amount) || tx.amount <= 0 || !tx.date) {
    showNotification("Please fill in all transaction fields correctly.", "danger");
    return;
  }
  
  createTransaction(tx);
  
  // Reset form but retain current date
  txDescriptionInput.value = "";
  txAmountInput.value = "";
  setDefaultDate();
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const promptText = chatInput.value.trim();
  if (!promptText) return;
  
  chatInput.value = "";
  askCoach(promptText);
});

btnRefreshInsights.addEventListener("click", () => {
  fetchAutomatedInsights();
  showNotification("Refreshing ledger analysis...", "success");
});

// Dynamic category logic when transaction type changes
txTypeSelect.addEventListener("change", () => {
  const type = txTypeSelect.value;
  // If income, filter category to appropriate options (e.g. Salary, Other)
  // If expense, filter to food, rent, utilities, leisure, entertainment, other.
  // This is a premium touch!
  const categories = txCategorySelect.options;
  
  if (type === "income") {
    txCategorySelect.value = "Salary";
    for (let i = 0; i < categories.length; i++) {
      const opt = categories[i];
      if (opt.value !== "Salary" && opt.value !== "Other") {
        opt.style.display = "none";
      } else {
        opt.style.display = "block";
      }
    }
  } else {
    txCategorySelect.value = "Food";
    for (let i = 0; i < categories.length; i++) {
      const opt = categories[i];
      if (opt.value === "Salary") {
        opt.style.display = "none";
      } else {
        opt.style.display = "block";
      }
    }
  }
});

// Startup initialization
async function init() {
  setDefaultDate();
  
  // Initial API check
  const isOnline = await checkApiStatus();
  if (isOnline) {
    await loadTransactions();
    fetchAutomatedInsights();
  } else {
    // If backend is offline, update metrics UI to default state
    updateUI();
  }
  
  // Poll API status every 10 seconds
  setInterval(checkApiStatus, 10000);
}

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("load", () => {
  // If DOMContentLoaded already fired
  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  }
});
