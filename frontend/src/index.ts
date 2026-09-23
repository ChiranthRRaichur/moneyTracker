import "./styles.css";

// Use the live Render backend when deployed, fall back to localhost for local development
const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BACKEND_URL = isLocalhost
  ? "http://localhost:8083"
  : "https://aura-money-backend.onrender.com";

interface Transaction {
  id?: number;
  description: string;
  amount: number;
  category: string;
  type: "income" | "expense";
  date: string;
}

interface MonthSummary {
  year_month: string;
  total_expense: number;
  total_income: number;
  net_savings: number;
  savings_rate: number;
  expense_count: number;
  income_count: number;
  top_category: string;
  mom_diff: number;
  mom_pct: number;
}

interface CategoryBreakdown {
  category: string;
  amount: number;
  percentage: number;
  count: number;
}

interface DailyBreakdown {
  day: number;
  date: string;
  amount: number;
  count: number;
}

interface SelectedMonthDetail {
  year_month: string;
  year: number;
  month: number;
  month_name: string;
  days_in_month: number;
  total_expense: number;
  total_income: number;
  net_savings: number;
  savings_rate: number;
  avg_daily_spend: number;
  peak_day: { day: number; date: string; amount: number };
  category_breakdown: CategoryBreakdown[];
  daily_breakdown: DailyBreakdown[];
  mom_diff: number;
  mom_pct: number;
  expense_count: number;
  income_count: number;
}

interface MonthlyAnalyticsResponse {
  selected_month: string;
  months: MonthSummary[];
  selected_month_detail: SelectedMonthDetail;
}

// State
let transactions: Transaction[] = [];
let activeAnalyticsTab: "month" | "history" | "weekly" = "month";
let selectedYearMonth: string = "";
let monthlyAnalytics: MonthlyAnalyticsResponse | null = null;
let filteredMonth: string | null = null;
let filteredCategory: string | null = null;
let currentPage = 1;
const itemsPerPage = 8;

// Category Color Palette
const CATEGORY_COLORS: Record<string, string> = {
  Food: "#f59e0b",         // Amber
  Salary: "#10b981",       // Mint green
  Rent: "#6366f1",         // Indigo
  Utilities: "#8b5cf6",    // Violet
  Leisure: "#f43f5e",      // Rose
  Entertainment: "#ec4899",// Pink
  Other: "#64748b"         // Slate
};

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
const ledgerFilterBadge = document.getElementById("ledger-filter-badge") as HTMLSpanElement;
const btnClearFilters = document.getElementById("btn-clear-filters") as HTMLButtonElement;

const aiInsightPanelEl = document.getElementById("ai-insight-panel") as HTMLDivElement;
const chatMessagesEl = document.getElementById("chat-messages") as HTMLDivElement;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const btnRefreshInsights = document.getElementById("btn-refresh-insights") as HTMLButtonElement;

// Analytics View Subviews & Controls
const viewMonthDetail = document.getElementById("view-month-detail") as HTMLDivElement;
const viewMonthHistory = document.getElementById("view-month-history") as HTMLDivElement;
const viewWeeklyChart = document.getElementById("view-weekly-chart") as HTMLDivElement;
const monthNavigator = document.getElementById("month-navigator") as HTMLDivElement;

const btnMonthPrev = document.getElementById("btn-month-prev") as HTMLButtonElement;
const monthSelect = document.getElementById("month-select") as HTMLSelectElement;
const btnMonthNext = document.getElementById("btn-month-next") as HTMLButtonElement;
const btnMonthNow = document.getElementById("btn-month-now") as HTMLButtonElement;

const btnChartMonthly = document.getElementById("btn-chart-monthly") as HTMLButtonElement;
const btnChartHistory = document.getElementById("btn-chart-history") as HTMLButtonElement;
const btnChartWeekly = document.getElementById("btn-chart-weekly") as HTMLButtonElement;

// Monthly KPIs Elements
const monthKpiSpent = document.getElementById("month-kpi-spent") as HTMLHeadingElement;
const monthKpiMom = document.getElementById("month-kpi-mom") as HTMLSpanElement;
const monthKpiTxcount = document.getElementById("month-kpi-txcount") as HTMLSpanElement;
const monthKpiDaily = document.getElementById("month-kpi-daily") as HTMLHeadingElement;
const monthKpiDaysCount = document.getElementById("month-kpi-days-count") as HTMLSpanElement;
const monthKpiSavings = document.getElementById("month-kpi-savings") as HTMLHeadingElement;
const monthKpiSavrate = document.getElementById("month-kpi-savrate") as HTMLSpanElement;
const monthKpiIncome = document.getElementById("month-kpi-income") as HTMLSpanElement;
const monthKpiPeak = document.getElementById("month-kpi-peak") as HTMLHeadingElement;
const monthKpiPeakAmt = document.getElementById("month-kpi-peak-amt") as HTMLSpanElement;

// Category Breakdown Elements
const categoryDonutSvg = document.getElementById("category-donut-svg") as unknown as SVGSVGElement;
const donutCenterAmount = document.getElementById("donut-center-amount") as HTMLSpanElement;
const categoryBarsList = document.getElementById("category-bars-list") as HTMLDivElement;
const monthCategoryCount = document.getElementById("month-category-count") as HTMLSpanElement;

// Daily Timeline Elements
const dailyTimelineSvg = document.getElementById("daily-timeline-svg") as unknown as SVGSVGElement;
const timelineMonthLabel = document.getElementById("timeline-month-label") as HTMLSpanElement;

// Month Action Elements
const btnFilterLedgerMonth = document.getElementById("btn-filter-ledger-month") as HTMLButtonElement;
const btnAnalyzeMonthAi = document.getElementById("btn-analyze-month-ai") as HTMLButtonElement;

// Multi-Month History Elements
const multiMonthSvg = document.getElementById("multi-month-svg") as unknown as SVGSVGElement;
const monthHistoryTbody = document.getElementById("month-history-tbody") as HTMLTableSectionElement;
const historyMonthsCount = document.getElementById("history-months-count") as HTMLSpanElement;

// Weekly Chart Elements
const chartSummaryLabel = document.getElementById("chart-summary-label") as HTMLSpanElement;
const chartSummaryValue = document.getElementById("chart-summary-value") as HTMLHeadingElement;
const spendingChartSvg = document.getElementById("spending-chart") as unknown as SVGSVGElement;
const chartTooltipEl = document.getElementById("chart-tooltip") as HTMLDivElement;
const chartComparisonBadge = document.getElementById("chart-comparison-badge") as HTMLDivElement;
const comparisonTrendIcon = document.getElementById("comparison-trend-icon") as HTMLSpanElement;
const comparisonTrendText = document.getElementById("comparison-trend-text") as HTMLSpanElement;

const btnPrevPage = document.getElementById("btn-prev-page") as HTMLButtonElement;
const btnNextPage = document.getElementById("btn-next-page") as HTMLButtonElement;
const pageIndicatorEl = document.getElementById("page-indicator") as HTMLSpanElement;

// Helper to set current date in form
const setDefaultDate = () => {
  const today = new Date().toISOString().split("T")[0];
  txDateInput.value = today;
};

// Helper to format ISO date (YYYY-MM-DD) into readable date (e.g. 01 Aug 2026)
const formatDate = (dateStr: string): string => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const dateObj = new Date(year, month, day);
  if (isNaN(dateObj.getTime())) return dateStr;
  return dateObj.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
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
    const response = await fetch(`${BACKEND_URL}/api/transactions?_t=${Date.now()}`, { cache: "no-store" });
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

// Helper to format month-year like "2026-03" to "March 2026"
const formatMonthYear = (ym: string): string => {
  if (!ym) return "";
  const parts = ym.split("-");
  if (parts.length < 2) return ym;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = new Date(y, m, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

// Client-side fallback computation for monthly analytics
function computeClientMonthlyAnalytics(targetYM?: string): MonthlyAnalyticsResponse {
  const expenses = transactions.filter(t => t.type === "expense");
  const incomes = transactions.filter(t => t.type === "income");

  const monthlyData: Record<string, { expenses: Transaction[]; incomes: Transaction[]; total_expense: number; total_income: number }> = {};

  transactions.forEach(t => {
    if (t.date && t.date.length >= 7) {
      const ym = t.date.substring(0, 7);
      if (!monthlyData[ym]) {
        monthlyData[ym] = { expenses: [], incomes: [], total_expense: 0, total_income: 0 };
      }
      if (t.type === "expense") {
        monthlyData[ym].expenses.push(t);
        monthlyData[ym].total_expense += t.amount;
      } else {
        monthlyData[ym].incomes.push(t);
        monthlyData[ym].total_income += t.amount;
      }
    }
  });

  const sortedMonths = Object.keys(monthlyData).sort();
  const monthSummaries: MonthSummary[] = [];

  sortedMonths.forEach((ym, idx) => {
    const data = monthlyData[ym];
    const totExp = data.total_expense;
    const totInc = data.total_income;
    const netSav = totInc - totExp;
    const savRate = totInc > 0 ? parseFloat(((netSav / totInc) * 100).toFixed(1)) : 0;

    // Top Category
    const catSums: Record<string, number> = {};
    data.expenses.forEach(e => {
      catSums[e.category] = (catSums[e.category] || 0) + e.amount;
    });
    let topCat = "None";
    let maxCatVal = -1;
    for (const c in catSums) {
      if (catSums[c] > maxCatVal) {
        maxCatVal = catSums[c];
        topCat = c;
      }
    }

    let momDiff = 0;
    let momPct = 0;
    if (idx > 0) {
      const prevYm = sortedMonths[idx - 1];
      const prevExp = monthlyData[prevYm].total_expense;
      momDiff = parseFloat((totExp - prevExp).toFixed(2));
      momPct = prevExp > 0 ? parseFloat(((momDiff / prevExp) * 100).toFixed(1)) : (totExp > 0 ? 100 : 0);
    }

    monthSummaries.push({
      year_month: ym,
      total_expense: parseFloat(totExp.toFixed(2)),
      total_income: parseFloat(totInc.toFixed(2)),
      net_savings: parseFloat(netSav.toFixed(2)),
      savings_rate: savRate,
      expense_count: data.expenses.length,
      income_count: data.incomes.length,
      top_category: topCat,
      mom_diff: momDiff,
      mom_pct: momPct
    });
  });

  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let finalTargetYM = targetYM || selectedYearMonth;

  if (!finalTargetYM) {
    if (sortedMonths.includes(currentYM)) {
      finalTargetYM = currentYM;
    } else if (sortedMonths.length > 0) {
      finalTargetYM = sortedMonths[sortedMonths.length - 1];
    } else {
      finalTargetYM = currentYM;
    }
  }

  const [tYearStr, tMonthStr] = finalTargetYM.split("-");
  const tYear = parseInt(tYearStr, 10) || now.getFullYear();
  const tMonth = parseInt(tMonthStr, 10) || (now.getMonth() + 1);

  // Number of days in target month
  const daysInMonth = new Date(tYear, tMonth, 0).getDate();
  const targetData = monthlyData[finalTargetYM] || { expenses: [], incomes: [], total_expense: 0, total_income: 0 };

  // Category breakdown
  const catStats: Record<string, { amount: number; count: number }> = {};
  targetData.expenses.forEach(e => {
    if (!catStats[e.category]) catStats[e.category] = { amount: 0, count: 0 };
    catStats[e.category].amount += e.amount;
    catStats[e.category].count += 1;
  });

  const totExp = targetData.total_expense;
  const categoryBreakdown: CategoryBreakdown[] = Object.keys(catStats).map(c => ({
    category: c,
    amount: parseFloat(catStats[c].amount.toFixed(2)),
    percentage: totExp > 0 ? parseFloat(((catStats[c].amount / totExp) * 100).toFixed(1)) : 0,
    count: catStats[c].count
  })).sort((a, b) => b.amount - a.amount);

  // Daily breakdown
  const dailyStats: Record<number, { amount: number; count: number }> = {};
  for (let d = 1; d <= daysInMonth; d++) dailyStats[d] = { amount: 0, count: 0 };

  targetData.expenses.forEach(e => {
    const parts = e.date.split("-");
    if (parts.length === 3) {
      const dayNum = parseInt(parts[2], 10);
      if (dayNum >= 1 && dayNum <= daysInMonth) {
        dailyStats[dayNum].amount += e.amount;
        dailyStats[dayNum].count += 1;
      }
    }
  });

  let peakDay = { day: 1, date: `${finalTargetYM}-01`, amount: 0 };
  const dailyBreakdown: DailyBreakdown[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${finalTargetYM}-${String(d).padStart(2, "0")}`;
    const amt = parseFloat(dailyStats[d].amount.toFixed(2));
    if (amt > peakDay.amount) {
      peakDay = { day: d, date: dStr, amount: amt };
    }
    dailyBreakdown.push({
      day: d,
      date: dStr,
      amount: amt,
      count: dailyStats[d].count
    });
  }

  const targetSummary = monthSummaries.find(s => s.year_month === finalTargetYM);
  const momDiff = targetSummary ? targetSummary.mom_diff : 0;
  const momPct = targetSummary ? targetSummary.mom_pct : 0;
  const totInc = targetData.total_income;
  const netSav = totInc - totExp;
  const savRate = totInc > 0 ? parseFloat(((netSav / totInc) * 100).toFixed(1)) : 0;

  const isCurrentMonth = tYear === now.getFullYear() && tMonth === (now.getMonth() + 1);
  const elapsedDays = isCurrentMonth ? Math.max(1, now.getDate()) : daysInMonth;
  const avgDailySpend = parseFloat((totExp / elapsedDays).toFixed(2));

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  return {
    selected_month: finalTargetYM,
    months: monthSummaries,
    selected_month_detail: {
      year_month: finalTargetYM,
      year: tYear,
      month: tMonth,
      month_name: monthNames[tMonth - 1],
      days_in_month: daysInMonth,
      total_expense: parseFloat(totExp.toFixed(2)),
      total_income: parseFloat(totInc.toFixed(2)),
      net_savings: parseFloat(netSav.toFixed(2)),
      savings_rate: savRate,
      avg_daily_spend: avgDailySpend,
      peak_day: peakDay,
      category_breakdown: categoryBreakdown,
      daily_breakdown: dailyBreakdown,
      mom_diff: momDiff,
      mom_pct: momPct,
      expense_count: targetData.expenses.length,
      income_count: targetData.incomes.length
    }
  };
}

// Fetch monthly analytics from backend with fallback
async function fetchMonthlyAnalytics(targetYM?: string) {
  try {
    let url = `${BACKEND_URL}/api/analytics/monthly?_t=${Date.now()}`;
    if (targetYM) {
      const [y, m] = targetYM.split("-");
      url += `&year=${y}&month=${parseInt(m, 10)}`;
    }
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("API error");
    monthlyAnalytics = await response.json();
    if (monthlyAnalytics) {
      selectedYearMonth = monthlyAnalytics.selected_month;
    }
  } catch (err) {
    // Graceful fallback to client-side analytics
    monthlyAnalytics = computeClientMonthlyAnalytics(targetYM);
    selectedYearMonth = monthlyAnalytics.selected_month;
  }
}

// Fetch all transactions
async function loadTransactions() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/transactions?_t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load transactions.");
    transactions = await response.json();
    await fetchMonthlyAnalytics();
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
    transactions.unshift(newTx);
    currentPage = 1;
    await fetchMonthlyAnalytics(selectedYearMonth);
    updateUI();
    showNotification("Transaction logged successfully!", "success");
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
    await fetchMonthlyAnalytics(selectedYearMonth);
    updateUI();
    showNotification("Transaction deleted.", "success");
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
  appendChatMessage(question, "user");
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

// ==========================================
// 1. RENDER MONTH DEEP-DIVE BREAKDOWN
// ==========================================
function renderMonthBreakdown() {
  if (!monthlyAnalytics || !monthlyAnalytics.selected_month_detail) return;
  const detail = monthlyAnalytics.selected_month_detail;

  // 1. Populate Month Dropdown
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const allMonthsSet = new Set(monthlyAnalytics.months.map(m => m.year_month));
  allMonthsSet.add(currentYM);
  if (detail.year_month) allMonthsSet.add(detail.year_month);
  const sortedMonths = Array.from(allMonthsSet).sort().reverse();

  monthSelect.innerHTML = sortedMonths.map(ym => {
    const isCurrent = ym === currentYM ? " (Current)" : "";
    return `<option value="${ym}" ${ym === detail.year_month ? "selected" : ""}>${formatMonthYear(ym)}${isCurrent}</option>`;
  }).join("");

  // Update navigation button states
  const currentIndex = sortedMonths.indexOf(detail.year_month);
  btnMonthNext.disabled = currentIndex <= 0; // newer months are at smaller index
  btnMonthPrev.disabled = currentIndex >= sortedMonths.length - 1; // older months at larger index

  // 2. Monthly KPI Badges
  monthKpiSpent.innerText = `₹${detail.total_expense.toFixed(2)}`;
  monthKpiTxcount.innerText = `${detail.expense_count} expenses logged`;

  // MoM badge
  if (detail.mom_diff > 0) {
    monthKpiMom.className = "chart-comparison-badge trend-up";
    monthKpiMom.innerHTML = `<span>▲</span> +₹${detail.mom_diff.toFixed(0)} (+${detail.mom_pct.toFixed(0)}%) vs last mo`;
  } else if (detail.mom_diff < 0) {
    monthKpiMom.className = "chart-comparison-badge trend-down";
    monthKpiMom.innerHTML = `<span>▼</span> -₹${Math.abs(detail.mom_diff).toFixed(0)} (-${Math.abs(detail.mom_pct).toFixed(0)}%) vs last mo`;
  } else {
    monthKpiMom.className = "chart-comparison-badge trend-neutral";
    monthKpiMom.innerHTML = `<span>•</span> Even vs last mo`;
  }

  monthKpiDaily.innerHTML = `₹${detail.avg_daily_spend.toFixed(2)} <span class="unit">/ day</span>`;
  monthKpiDaysCount.innerText = `${detail.days_in_month} days in ${detail.month_name}`;

  monthKpiSavings.innerText = `${detail.net_savings < 0 ? "-" : ""}₹${Math.abs(detail.net_savings).toFixed(2)}`;
  monthKpiSavings.className = `kpi-value ${detail.net_savings < 0 ? "text-danger" : "text-success"}`;
  monthKpiSavrate.innerText = `${detail.savings_rate.toFixed(1)}% saved`;
  monthKpiIncome.innerText = `Income: ₹${detail.total_income.toFixed(2)}`;

  if (detail.peak_day && detail.peak_day.amount > 0) {
    monthKpiPeak.innerText = `Day ${detail.peak_day.day}`;
    monthKpiPeakAmt.innerText = `₹${detail.peak_day.amount.toFixed(2)} peak`;
  } else {
    monthKpiPeak.innerText = "No Spikes";
    monthKpiPeakAmt.innerText = "₹0.00 spent";
  }

  // 3. Category Breakdown Section
  monthCategoryCount.innerText = `${detail.category_breakdown.length} active categories`;

  // Render Category Donut SVG
  const cx = 80;
  const cy = 80;
  const radius = 48;
  const circumference = 2 * Math.PI * radius; // ~301.59
  let donutSvgHtml = `
    <defs>
      <filter id="donut-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
    </defs>
    <!-- Background track -->
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="rgba(255, 255, 255, 0.05)" stroke-width="15"/>
  `;

  if (detail.total_expense === 0 || detail.category_breakdown.length === 0) {
    donutCenterAmount.innerText = "₹0";
  } else {
    donutCenterAmount.innerText = detail.total_expense >= 1000
      ? `₹${(detail.total_expense / 1000).toFixed(1)}k`
      : `₹${detail.total_expense.toFixed(0)}`;

    let currentOffset = 0;
    detail.category_breakdown.forEach(cat => {
      if (cat.percentage <= 0) return;
      const strokeLen = (cat.percentage / 100) * circumference;
      const color = CATEGORY_COLORS[cat.category] || "#6366f1";

      donutSvgHtml += `
        <circle 
          cx="${cx}" 
          cy="${cy}" 
          r="${radius}" 
          fill="none" 
          stroke="${color}" 
          stroke-width="15"
          stroke-dasharray="${strokeLen} ${circumference}"
          stroke-dashoffset="${-currentOffset}"
          transform="rotate(-90 ${cx} ${cy})"
          style="transition: stroke-dasharray 0.6s ease;"
        />
      `;
      currentOffset += strokeLen;
    });
  }
  categoryDonutSvg.innerHTML = donutSvgHtml;

  // Render Category Bars List
  if (detail.category_breakdown.length === 0) {
    categoryBarsList.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); padding: 0.5rem 0;">No expense categories recorded for this month.</p>`;
  } else {
    categoryBarsList.innerHTML = detail.category_breakdown.map(cat => {
      const color = CATEGORY_COLORS[cat.category] || "#6366f1";
      const isFiltered = filteredCategory === cat.category;
      return `
        <div class="category-bar-row ${isFiltered ? 'active-filter' : ''}" data-cat="${cat.category}" title="Click to filter ledger by ${cat.category}">
          <div class="cat-bar-header">
            <span class="cat-name-tag">
              <span class="cat-dot" style="background: ${color};"></span>
              ${cat.category}
              <span class="cat-pct">(${cat.percentage.toFixed(1)}%)</span>
            </span>
            <span class="cat-amounts">₹${cat.amount.toFixed(2)}</span>
          </div>
          <div class="cat-progress-bg">
            <div class="cat-progress-fill" style="width: ${cat.percentage}%; background: ${color};"></div>
          </div>
        </div>
      `;
    }).join("");

    // Category click-to-filter binding
    categoryBarsList.querySelectorAll(".category-bar-row").forEach(row => {
      row.addEventListener("click", () => {
        const catName = row.getAttribute("data-cat");
        if (catName) {
          if (filteredCategory === catName) {
            filteredCategory = null;
          } else {
            filteredCategory = catName;
            filteredMonth = detail.year_month;
          }
          currentPage = 1;
          updateUI();
          document.querySelector(".history-card")?.scrollIntoView({ behavior: "smooth" });
        }
      });
    });
  }

  // 4. Daily Spending Histogram (1 to 28/30/31)
  timelineMonthLabel.innerText = `1 ${detail.month_name.slice(0, 3)} - ${detail.days_in_month} ${detail.month_name.slice(0, 3)} (${detail.year})`;

  const daysCount = detail.days_in_month;
  const maxDayAmt = Math.max(...detail.daily_breakdown.map(d => d.amount), 50);

  const svgW = 540;
  const svgH = 130;
  const padL = 40;
  const padR = 15;
  const padT = 15;
  const padB = 25;
  const chW = svgW - padL - padR;
  const chH = svgH - padT - padB;

  let dailySvgHtml = `
    <defs>
      <linearGradient id="daily-bar-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent-secondary)"/>
        <stop offset="100%" stop-color="var(--accent-primary)"/>
      </linearGradient>
      <linearGradient id="peak-bar-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f43f5e"/>
        <stop offset="100%" stop-color="#fb7185"/>
      </linearGradient>
    </defs>
  `;

  // Draw 3 horizontal gridlines
  for (let i = 0; i <= 2; i++) {
    const ratio = i / 2;
    const y = padT + chH - ratio * chH;
    const val = ratio * maxDayAmt;
    dailySvgHtml += `<line class="chart-gridline" x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}"/>`;
    const label = val >= 1000 ? `₹${(val / 1000).toFixed(1)}k` : `₹${val.toFixed(0)}`;
    dailySvgHtml += `<text class="chart-axis-label" x="${padL - 6}" y="${y + 3}" text-anchor="end">${label}</text>`;
  }

  const slotW = chW / daysCount;
  const barW = Math.max(3, slotW * 0.7);

  detail.daily_breakdown.forEach((item, idx) => {
    const barH = (item.amount / maxDayAmt) * chH;
    const x = padL + idx * slotW + (slotW - barW) / 2;
    const y = padT + chH - barH;
    const isPeak = item.amount > 0 && item.amount === detail.peak_day.amount;
    const fillStyle = isPeak ? "url(#peak-bar-grad)" : "url(#daily-bar-grad)";

    if (item.amount > 0) {
      dailySvgHtml += `
        <rect 
          class="chart-bar" 
          x="${x}" 
          y="${y}" 
          width="${barW}" 
          height="${barH}" 
          rx="2" 
          fill="${fillStyle}"
          opacity="${isPeak ? '0.9' : '0.7'}"
          data-label="${formatDate(item.date)}"
          data-value="₹${item.amount.toFixed(2)}"
          data-count="${item.count}"
        />
      `;
    }

    // X-axis day markers: day 1, 5, 10, 15, 20, 25, last day
    if (item.day === 1 || item.day % 5 === 0 || item.day === daysCount) {
      dailySvgHtml += `
        <text class="chart-axis-label" x="${x + barW / 2}" y="${svgH - padB + 14}" text-anchor="middle">${item.day}</text>
      `;
    }
  });

  // Base axes lines
  dailySvgHtml += `
    <line class="chart-axis-line" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chH}"/>
    <line class="chart-axis-line" x1="${padL}" y1="${padT + chH}" x2="${svgW - padR}" y2="${padT + chH}"/>
  `;

  dailyTimelineSvg.innerHTML = dailySvgHtml;

  // Bind tooltip hover to daily bars
  dailyTimelineSvg.querySelectorAll(".chart-bar").forEach(bar => {
    bar.addEventListener("mouseenter", (e) => {
      const target = e.currentTarget as SVGElement;
      const label = target.getAttribute("data-label");
      const val = target.getAttribute("data-value");
      const cnt = target.getAttribute("data-count");
      if (chartTooltipEl && label && val) {
        chartTooltipEl.innerHTML = `
          <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 2px;">${label}</div>
          <div style="font-size: 0.85rem; color: #ffffff; font-weight: 700;">Spent: ${val}</div>
          <div style="font-size: 0.7rem; color: var(--accent-primary);">${cnt} transaction(s)</div>
        `;
        chartTooltipEl.style.opacity = "1";
      }
    });

    bar.addEventListener("mousemove", (e) => {
      const mouseEvent = e as MouseEvent;
      const containerRect = dailyTimelineSvg.parentElement?.getBoundingClientRect();
      if (chartTooltipEl && containerRect) {
        chartTooltipEl.style.left = `${mouseEvent.clientX - containerRect.left}px`;
        chartTooltipEl.style.top = `${mouseEvent.clientY - containerRect.top}px`;
      }
    });

    bar.addEventListener("mouseleave", () => {
      if (chartTooltipEl) chartTooltipEl.style.opacity = "0";
    });
  });
}

// ==========================================
// 2. RENDER MULTI-MONTH TRENDS & HISTORY
// ==========================================
function renderMonthHistory() {
  if (!monthlyAnalytics) return;
  const months = monthlyAnalytics.months;
  historyMonthsCount.innerText = `${months.length} tracked months`;

  if (months.length === 0) {
    monthHistoryTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No historical monthly data recorded yet.</td></tr>`;
    multiMonthSvg.innerHTML = "";
    return;
  }

  // 1. Draw Multi-Month Comparative SVG Chart
  const svgW = 500;
  const svgH = 150;
  const padL = 45;
  const padR = 15;
  const padT = 15;
  const padB = 25;
  const chW = svgW - padL - padR;
  const chH = svgH - padT - padB;

  const maxSpent = Math.max(...months.map(m => m.total_expense), 100);
  let chartSvgHtml = `
    <defs>
      <linearGradient id="hist-bar-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent-secondary)"/>
        <stop offset="100%" stop-color="var(--accent-primary)"/>
      </linearGradient>
    </defs>
  `;

  // Grid lines
  for (let i = 0; i <= 3; i++) {
    const ratio = i / 3;
    const y = padT + chH - ratio * chH;
    const val = ratio * maxSpent;
    chartSvgHtml += `<line class="chart-gridline" x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}"/>`;
    const label = val >= 1000 ? `₹${(val / 1000).toFixed(1)}k` : `₹${val.toFixed(0)}`;
    chartSvgHtml += `<text class="chart-axis-label" x="${padL - 6}" y="${y + 3}" text-anchor="end">${label}</text>`;
  }

  const slotW = chW / months.length;
  const barW = Math.min(40, slotW * 0.55);

  months.forEach((m, idx) => {
    const barH = (m.total_expense / maxSpent) * chH;
    const x = padL + idx * slotW + (slotW - barW) / 2;
    const y = padT + chH - barH;
    const shortLabel = formatMonthYear(m.year_month).split(" ")[0].slice(0, 3);

    chartSvgHtml += `
      <rect 
        class="chart-bar" 
        x="${x}" 
        y="${y}" 
        width="${barW}" 
        height="${barH}" 
        rx="3" 
        fill="url(#hist-bar-grad)"
        opacity="0.8"
        data-label="${formatMonthYear(m.year_month)}"
        data-value="₹${m.total_expense.toFixed(2)}"
        data-income="₹${m.total_income.toFixed(2)}"
      />
      <text class="chart-axis-label" x="${x + barW / 2}" y="${svgH - padB + 15}" text-anchor="middle">${shortLabel}</text>
    `;
  });

  chartSvgHtml += `
    <line class="chart-axis-line" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chH}"/>
    <line class="chart-axis-line" x1="${padL}" y1="${padT + chH}" x2="${svgW - padR}" y2="${padT + chH}"/>
  `;

  multiMonthSvg.innerHTML = chartSvgHtml;

  // Bind tooltip to multi-month bars
  multiMonthSvg.querySelectorAll(".chart-bar").forEach(bar => {
    bar.addEventListener("mouseenter", (e) => {
      const target = e.currentTarget as SVGElement;
      const label = target.getAttribute("data-label");
      const val = target.getAttribute("data-value");
      const inc = target.getAttribute("data-income");
      if (chartTooltipEl && label && val) {
        chartTooltipEl.innerHTML = `
          <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 2px;">${label}</div>
          <div style="font-size: 0.85rem; color: #ffffff; font-weight: 700;">Spent: ${val}</div>
          <div style="font-size: 0.7rem; color: var(--accent-success);">Income: ${inc}</div>
        `;
        chartTooltipEl.style.opacity = "1";
      }
    });

    bar.addEventListener("mousemove", (e) => {
      const mouseEvent = e as MouseEvent;
      const containerRect = multiMonthSvg.parentElement?.getBoundingClientRect();
      if (chartTooltipEl && containerRect) {
        chartTooltipEl.style.left = `${mouseEvent.clientX - containerRect.left}px`;
        chartTooltipEl.style.top = `${mouseEvent.clientY - containerRect.top}px`;
      }
    });

    bar.addEventListener("mouseleave", () => {
      if (chartTooltipEl) chartTooltipEl.style.opacity = "0";
    });
  });

  // 2. Render Historical Table
  const tableMonths = [...months].reverse();
  monthHistoryTbody.innerHTML = tableMonths.map(m => {
    let diffBadge = `<span class="trend-neutral">• Even</span>`;
    if (m.mom_diff > 0) {
      diffBadge = `<span class="text-danger" style="font-weight: 600;">+₹${m.mom_diff.toFixed(0)} (+${m.mom_pct.toFixed(0)}%)</span>`;
    } else if (m.mom_diff < 0) {
      diffBadge = `<span class="text-success" style="font-weight: 600;">-₹${Math.abs(m.mom_diff).toFixed(0)} (-${Math.abs(m.mom_pct).toFixed(0)}%)</span>`;
    }

    const tagClass = `tag-${m.top_category.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const netClass = m.net_savings < 0 ? "text-danger" : "text-success";

    return `
      <tr>
        <td style="font-weight: 600;">${formatMonthYear(m.year_month)}</td>
        <td class="text-danger" style="font-weight: 700;">₹${m.total_expense.toFixed(2)}</td>
        <td>${diffBadge}</td>
        <td class="text-success">₹${m.total_income.toFixed(2)}</td>
        <td class="${netClass}" style="font-weight: 600;">₹${m.net_savings.toFixed(2)}</td>
        <td><span class="savings-rate-badge">${m.savings_rate.toFixed(1)}%</span></td>
        <td><span class="tag ${tagClass}">${m.top_category}</span></td>
        <td>
          <button type="button" class="btn-inspect-month" data-ym="${m.year_month}">Deep Dive ➔</button>
        </td>
      </tr>
    `;
  }).join("");

  // Inspect button click handlers
  monthHistoryTbody.querySelectorAll(".btn-inspect-month").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const ym = target.getAttribute("data-ym");
      if (ym) {
        selectedYearMonth = ym;
        activeAnalyticsTab = "month";
        btnChartMonthly.classList.add("active");
        btnChartHistory.classList.remove("active");
        btnChartWeekly.classList.remove("active");
        await fetchMonthlyAnalytics(ym);
        updateUI();
      }
    });
  });
}

// ==========================================
// 3. RENDER WEEKLY SPENDING CHART
// ==========================================
function renderWeeklySpendingChart() {
  if (!spendingChartSvg) return;
  const expenses = transactions.filter(t => t.type === "expense");

  let labels: string[] = [];
  let values: number[] = [];
  let tooltipLabels: string[] = [];
  let totalSpent = 0;
  let prevValues: number[] = [];
  let prevTotalSpent = 0;

  const today = new Date();
  if (chartSummaryLabel) chartSummaryLabel.innerText = "Total Spent (Last 7 Days)";

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // 1. Current Week (days 0-6 ago)
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const dayLabel = dayNames[d.getDay()];

    labels.push(`${dayLabel} ${d.getDate()}`);
    tooltipLabels.push(d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }));

    const dailySum = expenses
      .filter(t => t.date === dateStr)
      .reduce((sum, t) => sum + t.amount, 0);

    values.push(dailySum);
    totalSpent += dailySum;
  }

  // 2. Previous Week (days 7-13 ago)
  for (let i = 13; i >= 7; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    const dailySum = expenses
      .filter(t => t.date === dateStr)
      .reduce((sum, t) => sum + t.amount, 0);

    prevValues.push(dailySum);
    prevTotalSpent += dailySum;
  }

  // Comparison Badge
  const diff = totalSpent - prevTotalSpent;
  let badgeClass = "trend-neutral";
  let trendIcon = "•";
  let trendText = "";

  if (diff > 0) {
    const pct = prevTotalSpent > 0 ? (diff / prevTotalSpent) * 100 : 100;
    trendText = `+₹${diff.toFixed(0)} (+${pct.toFixed(0)}%) vs last week`;
    badgeClass = "trend-up";
    trendIcon = "▲";
  } else if (diff < 0) {
    const absDiff = Math.abs(diff);
    const pct = prevTotalSpent > 0 ? (absDiff / prevTotalSpent) * 100 : 100;
    trendText = `-₹${absDiff.toFixed(0)} (-${pct.toFixed(0)}%) vs last week`;
    badgeClass = "trend-down";
    trendIcon = "▼";
  } else {
    trendText = "Even vs last week";
    badgeClass = "trend-neutral";
    trendIcon = "•";
  }

  if (chartComparisonBadge && comparisonTrendIcon && comparisonTrendText) {
    chartComparisonBadge.className = `chart-comparison-badge ${badgeClass}`;
    comparisonTrendIcon.innerText = trendIcon;
    comparisonTrendText.innerText = trendText;
  }

  if (chartSummaryValue) {
    chartSummaryValue.innerText = `₹${totalSpent.toFixed(2)}`;
  }

  const maxValue = Math.max(...values, 100);
  const svgWidth = 500;
  const svgHeight = 200;
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  let svgContent = `
    <defs>
      <linearGradient id="bar-gradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent-secondary)"/>
        <stop offset="100%" stop-color="var(--accent-primary)"/>
      </linearGradient>
      <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent-secondary)" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
  `;

  // Draw gridlines
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const ratio = i / gridSteps;
    const y = paddingTop + chartHeight - ratio * chartHeight;
    const valueAtGrid = ratio * maxValue;
    svgContent += `<line class="chart-gridline" x1="${paddingLeft}" y1="${y}" x2="${svgWidth - paddingRight}" y2="${y}"/>`;
    const formattedVal = valueAtGrid >= 1000 ? `₹${(valueAtGrid / 1000).toFixed(1)}k` : `₹${valueAtGrid.toFixed(0)}`;
    svgContent += `<text class="chart-axis-label" x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end">${formattedVal}</text>`;
  }

  const numBars = values.length;
  const barSpacingRatio = 0.4;
  const blockWidth = chartWidth / numBars;
  const barWidth = blockWidth * (1 - barSpacingRatio);

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < numBars; i++) {
    const val = values[i];
    const barHeight = (val / maxValue) * chartHeight;
    const cx = paddingLeft + i * blockWidth + blockWidth / 2;
    const cy = paddingTop + chartHeight - barHeight;
    points.push({ x: cx, y: cy });
  }

  if (points.length > 0) {
    let areaPathD = `M ${points[0].x} ${paddingTop + chartHeight}`;
    for (let i = 0; i < points.length; i++) areaPathD += ` L ${points[i].x} ${points[i].y}`;
    areaPathD += ` L ${points[points.length - 1].x} ${paddingTop + chartHeight} Z`;
    svgContent += `<path class="chart-trend-area" d="${areaPathD}"></path>`;
  }

  for (let i = 0; i < numBars; i++) {
    const val = values[i];
    const label = labels[i];
    const barHeight = (val / maxValue) * chartHeight;
    const x = paddingLeft + i * blockWidth + (blockWidth - barWidth) / 2;
    const y = paddingTop + chartHeight - barHeight;
    const labelX = paddingLeft + i * blockWidth + blockWidth / 2;
    const labelY = svgHeight - paddingBottom + 16;

    svgContent += `<text class="chart-axis-label" x="${labelX}" y="${labelY}" text-anchor="middle">${label}</text>`;
    if (val > 0) {
      svgContent += `
        <rect 
          class="chart-bar" 
          x="${x}" 
          y="${y}" 
          width="${barWidth}" 
          height="${barHeight}" 
          rx="4" 
          ry="4"
          data-value="₹${val.toFixed(2)}"
        ></rect>
      `;
    }
  }

  if (points.length > 0) {
    let linePathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) linePathD += ` L ${points[i].x} ${points[i].y}`;
    svgContent += `<path class="chart-trend-line" d="${linePathD}"></path>`;
  }

  for (let i = 0; i < numBars; i++) {
    const pt = points[i];
    const val = values[i];
    const fullDateLabel = tooltipLabels[i];
    const lastWeekVal = prevValues[i] || 0;
    const dayDiff = val - lastWeekVal;

    let compText = "";
    if (dayDiff > 0) {
      const pct = lastWeekVal > 0 ? (dayDiff / lastWeekVal) * 100 : 100;
      compText = `<span style="color: var(--accent-danger); font-weight: 700;">+₹${dayDiff.toFixed(2)} (+${pct.toFixed(0)}%)</span> vs same day last week`;
    } else if (dayDiff < 0) {
      const absDiff = Math.abs(dayDiff);
      const pct = lastWeekVal > 0 ? (absDiff / lastWeekVal) * 100 : 100;
      compText = `<span style="color: var(--accent-success); font-weight: 700;">-₹${absDiff.toFixed(2)} (-${pct.toFixed(0)}%)</span> vs same day last week`;
    } else {
      compText = `<span style="color: var(--text-muted);">No difference</span> vs same day last week`;
    }

    svgContent += `
      <circle 
        class="chart-dot" 
        cx="${pt.x}" 
        cy="${pt.y}" 
        r="4.5"
        data-value="₹${val.toFixed(2)}"
        data-label="${fullDateLabel}"
        data-compare="${encodeURIComponent(compText)}"
      ></circle>
    `;
  }

  svgContent += `
    <line class="chart-axis-line" x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + chartHeight}"></line>
    <line class="chart-axis-line" x1="${paddingLeft}" y1="${paddingTop + chartHeight}" x2="${svgWidth - paddingRight}" y2="${paddingTop + chartHeight}"></line>
  `;

  spendingChartSvg.innerHTML = svgContent;

  spendingChartSvg.querySelectorAll(".chart-bar, .chart-dot").forEach(el => {
    el.addEventListener("mouseenter", (e) => {
      const target = e.currentTarget as SVGElement;
      const value = target.getAttribute("data-value");
      let dateLabel = target.getAttribute("data-label");
      let compareEncoded = target.getAttribute("data-compare");

      if (!compareEncoded && target.classList.contains("chart-bar")) {
        const barX = parseFloat(target.getAttribute("x") || "0");
        const barW = parseFloat(target.getAttribute("width") || "0");
        const centerX = barX + barW / 2;
        const matchingDot = spendingChartSvg.querySelector(`.chart-dot[cx="${centerX}"]`) ||
          Array.from(spendingChartSvg.querySelectorAll(".chart-dot"))
            .find(d => Math.abs(parseFloat(d.getAttribute("cx") || "0") - centerX) < 2);

        if (matchingDot) {
          dateLabel = matchingDot.getAttribute("data-label");
          compareEncoded = matchingDot.getAttribute("data-compare");
        }
      }

      if (chartTooltipEl && value && dateLabel) {
        const compareHtml = compareEncoded ? decodeURIComponent(compareEncoded) : "";
        chartTooltipEl.innerHTML = `
          <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 2px;">${dateLabel}</div>
          <div style="font-size: 0.85rem; color: #ffffff; font-weight: 700; margin-bottom: 4px;">Spent: ${value}</div>
          <div style="font-size: 0.7rem; font-weight: 500;">${compareHtml}</div>
        `;
        chartTooltipEl.style.opacity = "1";
      }
    });

    el.addEventListener("mousemove", (e) => {
      const mouseEvent = e as MouseEvent;
      const containerRect = spendingChartSvg.parentElement?.getBoundingClientRect();
      if (chartTooltipEl && containerRect) {
        chartTooltipEl.style.left = `${mouseEvent.clientX - containerRect.left}px`;
        chartTooltipEl.style.top = `${mouseEvent.clientY - containerRect.top}px`;
      }
    });

    el.addEventListener("mouseleave", () => {
      if (chartTooltipEl) chartTooltipEl.style.opacity = "0";
    });
  });
}

// ==========================================
// RENDER ACTIVE ANALYTICS SUBVIEW
// ==========================================
function renderActiveAnalytics() {
  if (activeAnalyticsTab === "month") {
    viewMonthDetail.style.display = "flex";
    viewMonthHistory.style.display = "none";
    viewWeeklyChart.style.display = "none";
    monthNavigator.style.display = "flex";
    renderMonthBreakdown();
  } else if (activeAnalyticsTab === "history") {
    viewMonthDetail.style.display = "none";
    viewMonthHistory.style.display = "flex";
    viewWeeklyChart.style.display = "none";
    monthNavigator.style.display = "none";
    renderMonthHistory();
  } else {
    viewMonthDetail.style.display = "none";
    viewMonthHistory.style.display = "none";
    viewWeeklyChart.style.display = "flex";
    monthNavigator.style.display = "none";
    renderWeeklySpendingChart();
  }
}

// ==========================================
// DOM UI UPDATING
// ==========================================
function updateUI() {
  // Render active analytics tab
  renderActiveAnalytics();

  // 1. Calculate overall metrics
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

  // 2. Filter transactions if ledger filter is set
  let displayedTransactions = transactions;
  if (filteredMonth) {
    displayedTransactions = displayedTransactions.filter(t => t.date && t.date.startsWith(filteredMonth!));
  }
  if (filteredCategory) {
    displayedTransactions = displayedTransactions.filter(t => t.category === filteredCategory);
  }

  // Update Ledger Filter Indicator
  if (filteredMonth || filteredCategory) {
    ledgerFilterBadge.style.display = "inline-flex";
    let filterText = "Filtered: ";
    if (filteredMonth) filterText += formatMonthYear(filteredMonth);
    if (filteredCategory) filterText += `${filteredMonth ? " • " : ""}${filteredCategory}`;
    ledgerFilterBadge.innerText = filterText;
    btnClearFilters.style.display = "inline-block";
  } else {
    ledgerFilterBadge.style.display = "none";
    btnClearFilters.style.display = "none";
  }

  // 3. Render Ledger with pagination
  const totalPages = Math.ceil(displayedTransactions.length / itemsPerPage) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  if (btnPrevPage && btnNextPage && pageIndicatorEl) {
    btnPrevPage.disabled = currentPage === 1;
    btnNextPage.disabled = currentPage === totalPages;
    pageIndicatorEl.innerText = `Page ${currentPage} of ${totalPages}`;

    const paginationContainer = document.getElementById("ledger-pagination");
    if (paginationContainer) {
      paginationContainer.style.display = displayedTransactions.length === 0 ? "none" : "flex";
    }
  }

  if (displayedTransactions.length === 0) {
    ledgerListEl.innerHTML = `
      <div class="ledger-empty">
        <p>${filteredMonth || filteredCategory ? "No transactions found matching the selected filter." : "No transactions logged yet. Add one above to get started!"}</p>
      </div>
    `;
    return;
  }

  const startIndex = (currentPage - 1) * itemsPerPage;
  const pageTransactions = displayedTransactions.slice(startIndex, startIndex + itemsPerPage);

  ledgerListEl.innerHTML = pageTransactions.map(t => {
    const amountClass = t.type === "income" ? "text-success" : "text-danger";
    const amountPrefix = t.type === "income" ? "+" : "-";
    const tagClass = `tag-${t.category.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const formattedDateStr = formatDate(t.date);

    return `
      <div class="ledger-row" data-id="${t.id}">
        <span class="tx-desc-cell">${t.description}</span>
        <span><span class="tag ${tagClass}">${t.category}</span></span>
        <span class="tx-date-cell">${formattedDateStr}</span>
        <span class="tx-amount-cell ${amountClass} text-right">${amountPrefix}₹${t.amount.toFixed(2)}</span>
        <span>
          <button type="button" class="btn-delete" data-id="${t.id}" title="Delete transaction">×</button>
        </span>
      </div>
    `;
  }).join("");

  ledgerListEl.querySelectorAll(".btn-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const id = parseInt(target.getAttribute("data-id") || "0", 10);
      if (id) removeTransaction(id);
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
  toast.offsetHeight;

  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==========================================
// EVENT LISTENERS SETUP
// ==========================================
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

// Tab Switching
btnChartMonthly.addEventListener("click", () => {
  if (activeAnalyticsTab === "month") return;
  activeAnalyticsTab = "month";
  btnChartMonthly.classList.add("active");
  btnChartHistory.classList.remove("active");
  btnChartWeekly.classList.remove("active");
  renderActiveAnalytics();
});

btnChartHistory.addEventListener("click", () => {
  if (activeAnalyticsTab === "history") return;
  activeAnalyticsTab = "history";
  btnChartHistory.classList.add("active");
  btnChartMonthly.classList.remove("active");
  btnChartWeekly.classList.remove("active");
  renderActiveAnalytics();
});

btnChartWeekly.addEventListener("click", () => {
  if (activeAnalyticsTab === "weekly") return;
  activeAnalyticsTab = "weekly";
  btnChartWeekly.classList.add("active");
  btnChartMonthly.classList.remove("active");
  btnChartHistory.classList.remove("active");
  renderActiveAnalytics();
});

// Month Navigator Event Handlers
monthSelect.addEventListener("change", async () => {
  selectedYearMonth = monthSelect.value;
  await fetchMonthlyAnalytics(selectedYearMonth);
  updateUI();
});

btnMonthPrev.addEventListener("click", async () => {
  const options = Array.from(monthSelect.options);
  const currentIdx = options.findIndex(opt => opt.value === selectedYearMonth);
  if (currentIdx < options.length - 1) {
    selectedYearMonth = options[currentIdx + 1].value;
    await fetchMonthlyAnalytics(selectedYearMonth);
    updateUI();
  }
});

btnMonthNext.addEventListener("click", async () => {
  const options = Array.from(monthSelect.options);
  const currentIdx = options.findIndex(opt => opt.value === selectedYearMonth);
  if (currentIdx > 0) {
    selectedYearMonth = options[currentIdx - 1].value;
    await fetchMonthlyAnalytics(selectedYearMonth);
    updateUI();
  }
});

btnMonthNow.addEventListener("click", async () => {
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  selectedYearMonth = currentYM;
  await fetchMonthlyAnalytics(currentYM);
  updateUI();
});

// Filter Ledger to Current Month Button
btnFilterLedgerMonth.addEventListener("click", () => {
  filteredMonth = selectedYearMonth;
  filteredCategory = null;
  currentPage = 1;
  updateUI();
  showNotification(`Ledger filtered to ${formatMonthYear(selectedYearMonth)}`, "success");
  document.querySelector(".history-card")?.scrollIntoView({ behavior: "smooth" });
});

// Clear Filters Button
btnClearFilters.addEventListener("click", () => {
  filteredMonth = null;
  filteredCategory = null;
  currentPage = 1;
  updateUI();
  showNotification("Filters cleared. Showing all transactions.", "success");
});

// AI Coach Month Analysis Button
btnAnalyzeMonthAi.addEventListener("click", () => {
  if (!monthlyAnalytics || !monthlyAnalytics.selected_month_detail) return;
  const detail = monthlyAnalytics.selected_month_detail;
  const monthName = formatMonthYear(detail.year_month);
  const topCat = detail.category_breakdown.length > 0 ? detail.category_breakdown[0].category : "None";
  const prompt = `Can you provide a comprehensive budget analysis of my spending in ${monthName}? I spent a total of ₹${detail.total_expense.toFixed(2)} with top spending in ${topCat} (₹${detail.category_breakdown[0]?.amount.toFixed(2) || 0}), and my net savings were ₹${detail.net_savings.toFixed(2)}. What actionable tips do you have to optimize my spending?`;

  document.querySelector(".ai-coach-card")?.scrollIntoView({ behavior: "smooth" });
  askCoach(prompt);
});

// Dynamic category logic when transaction type changes
txTypeSelect.addEventListener("change", () => {
  const type = txTypeSelect.value;
  const categories = txCategorySelect.options;

  if (type === "income") {
    txCategorySelect.value = "Salary";
    for (let i = 0; i < categories.length; i++) {
      const opt = categories[i];
      opt.style.display = (opt.value !== "Salary" && opt.value !== "Other") ? "none" : "block";
    }
  } else {
    txCategorySelect.value = "Food";
    for (let i = 0; i < categories.length; i++) {
      const opt = categories[i];
      opt.style.display = opt.value === "Salary" ? "none" : "block";
    }
  }
});

if (btnPrevPage && btnNextPage) {
  btnPrevPage.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      updateUI();
    }
  });

  btnNextPage.addEventListener("click", () => {
    const displayedCount = transactions.filter(t => {
      if (filteredMonth && (!t.date || !t.date.startsWith(filteredMonth))) return false;
      if (filteredCategory && t.category !== filteredCategory) return false;
      return true;
    }).length;
    const totalPages = Math.ceil(displayedCount / itemsPerPage) || 1;
    if (currentPage < totalPages) {
      currentPage++;
      updateUI();
    }
  });
}

// Startup initialization
async function init() {
  setDefaultDate();

  const isOnline = await checkApiStatus();
  if (isOnline) {
    await loadTransactions();
  } else {
    await fetchMonthlyAnalytics();
    updateUI();
  }

  setInterval(checkApiStatus, 10000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadTransactions();
  });
  window.addEventListener("focus", () => loadTransactions());

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then((reg) => console.log("Service Worker registered successfully:", reg))
      .catch((err) => console.error("Service Worker registration failed:", err));
  }
}

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("load", () => {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  }
});

