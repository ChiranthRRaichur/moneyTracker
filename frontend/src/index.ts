import "./styles.css";

declare const process: any;
const BACKEND_URL = typeof process !== "undefined" && process.env && process.env.BACKEND_URL
  ? process.env.BACKEND_URL
  : "http://localhost:8083";

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
let activeChartTab: "weekly" | "monthly" = "weekly";
let currentPage = 1;
const itemsPerPage = 8;

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

// Chart DOM Elements
const btnChartWeekly = document.getElementById("btn-chart-weekly") as HTMLButtonElement;
const btnChartMonthly = document.getElementById("btn-chart-monthly") as HTMLButtonElement;
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
    currentPage = 1; // Reset to first page
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

// Render custom SVG spending chart
function renderSpendingChart() {
  if (!spendingChartSvg) return;

  const expenses = transactions.filter(t => t.type === "expense");

  let labels: string[] = [];
  let values: number[] = [];
  let tooltipLabels: string[] = [];
  let totalSpent = 0;

  // Additional arrays for comparative calculations
  let prevValues: number[] = [];
  let prevTotalSpent = 0;
  let monthMinus6Val = 0; // Month before the 6-month window

  const today = new Date();

  if (activeChartTab === "weekly") {
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

    // 2. Previous Week (days 7-13 ago) for comparison
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

    // Compare Current Week vs Previous Week for the badge
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

  } else {
    if (chartSummaryLabel) chartSummaryLabel.innerText = "Total Spent (Last 6 Months)";

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // 1. Current 6 Months
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const yearVal = d.getFullYear();
      const monthVal = d.getMonth();
      const yearMonthPrefix = `${yearVal}-${String(monthVal + 1).padStart(2, "0")}`;

      labels.push(monthNames[monthVal]);
      tooltipLabels.push(d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

      const monthlySum = expenses
        .filter(t => t.date.startsWith(yearMonthPrefix))
        .reduce((sum, t) => sum + t.amount, 0);

      values.push(monthlySum);
      totalSpent += monthlySum;
    }

    // Calculate month before the 6-month chart window (6 months ago)
    const d6 = new Date(today.getFullYear(), today.getMonth() - 6, 1);
    const prefix6 = `${d6.getFullYear()}-${String(d6.getMonth() + 1).padStart(2, "0")}`;
    monthMinus6Val = expenses
      .filter(t => t.date.startsWith(prefix6))
      .reduce((sum, t) => sum + t.amount, 0);

    // Compare Current Month (index 5) vs Previous Month (index 4) for the badge
    const currentMonthSpent = values[5];
    const prevMonthSpent = values[4];
    const diff = currentMonthSpent - prevMonthSpent;
    let badgeClass = "trend-neutral";
    let trendIcon = "•";
    let trendText = "";

    if (diff > 0) {
      const pct = prevMonthSpent > 0 ? (diff / prevMonthSpent) * 100 : 100;
      trendText = `+₹${diff.toFixed(0)} (+${pct.toFixed(0)}%) vs last month`;
      badgeClass = "trend-up";
      trendIcon = "▲";
    } else if (diff < 0) {
      const absDiff = Math.abs(diff);
      const pct = prevMonthSpent > 0 ? (absDiff / prevMonthSpent) * 100 : 100;
      trendText = `-₹${absDiff.toFixed(0)} (-${pct.toFixed(0)}%) vs last month`;
      badgeClass = "trend-down";
      trendIcon = "▼";
    } else {
      trendText = "Even vs last month";
      badgeClass = "trend-neutral";
      trendIcon = "•";
    }

    if (chartComparisonBadge && comparisonTrendIcon && comparisonTrendText) {
      chartComparisonBadge.className = `chart-comparison-badge ${badgeClass}`;
      comparisonTrendIcon.innerText = trendIcon;
      comparisonTrendText.innerText = trendText;
    }
  }

  if (chartSummaryValue) {
    chartSummaryValue.innerText = `₹${totalSpent.toFixed(2)}`;
  }

  // Find max value for scaling, default to 100 to draw axes if no data
  const maxValue = Math.max(...values, 100);

  const svgWidth = 500;
  const svgHeight = 200;
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  // Insert SVGs linear gradients and filters inside defs
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

  // Draw horizontal grid lines and Y-axis labels
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const ratio = i / gridSteps;
    const y = paddingTop + chartHeight - ratio * chartHeight;
    const valueAtGrid = ratio * maxValue;

    svgContent += `<line class="chart-gridline" x1="${paddingLeft}" y1="${y}" x2="${svgWidth - paddingRight}" y2="${y}"></line>`;

    let formattedVal = "";
    if (valueAtGrid >= 1000) {
      formattedVal = `₹${(valueAtGrid / 1000).toFixed(1)}k`;
    } else {
      formattedVal = `₹${valueAtGrid.toFixed(0)}`;
    }

    svgContent += `
      <text class="chart-axis-label" x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end">${formattedVal}</text>
    `;
  }

  const numBars = values.length;
  const barSpacingRatio = 0.4;
  const blockWidth = chartWidth / numBars;
  const barWidth = blockWidth * (1 - barSpacingRatio);

  // Compute points for the trend line chart
  const points: { x: number, y: number }[] = [];
  for (let i = 0; i < numBars; i++) {
    const val = values[i];
    const barHeight = (val / maxValue) * chartHeight;
    const cx = paddingLeft + i * blockWidth + blockWidth / 2;
    const cy = paddingTop + chartHeight - barHeight;
    points.push({ x: cx, y: cy });
  }

  // Draw the gradient filled area under the line
  if (points.length > 0) {
    let areaPathD = `M ${points[0].x} ${paddingTop + chartHeight}`;
    for (let i = 0; i < points.length; i++) {
      areaPathD += ` L ${points[i].x} ${points[i].y}`;
    }
    areaPathD += ` L ${points[points.length - 1].x} ${paddingTop + chartHeight} Z`;
    svgContent += `<path class="chart-trend-area" d="${areaPathD}"></path>`;
  }

  // Draw comparison background bars
  for (let i = 0; i < numBars; i++) {
    const val = values[i];
    const label = labels[i];

    const barHeight = (val / maxValue) * chartHeight;
    const x = paddingLeft + i * blockWidth + (blockWidth - barWidth) / 2;
    const y = paddingTop + chartHeight - barHeight;

    const labelX = paddingLeft + i * blockWidth + blockWidth / 2;
    const labelY = svgHeight - paddingBottom + 16;

    // Draw X-axis label
    svgContent += `
      <text class="chart-axis-label" x="${labelX}" y="${labelY}" text-anchor="middle">${label}</text>
    `;

    // Render bar background shape
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

  // Draw the sharp glowy trend line on top of the bars
  if (points.length > 0) {
    let linePathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      linePathD += ` L ${points[i].x} ${points[i].y}`;
    }
    svgContent += `<path class="chart-trend-line" d="${linePathD}"></path>`;
  }

  // Draw the comparison dots on top of the line
  for (let i = 0; i < numBars; i++) {
    const pt = points[i];
    const val = values[i];
    const fullDateLabel = tooltipLabels[i];

    // Day-over-day or Month-over-month calculation
    let compText = "";
    if (activeChartTab === "weekly") {
      const lastWeekVal = prevValues[i] || 0;
      const dayDiff = val - lastWeekVal;

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
    } else {
      let prevMonthVal = 0;
      if (i > 0) {
        prevMonthVal = values[i - 1];
      } else {
        prevMonthVal = monthMinus6Val;
      }

      const monthDiff = val - prevMonthVal;
      if (monthDiff > 0) {
        const pct = prevMonthVal > 0 ? (monthDiff / prevMonthVal) * 100 : 100;
        compText = `<span style="color: var(--accent-danger); font-weight: 700;">+₹${monthDiff.toFixed(2)} (+${pct.toFixed(0)}%)</span> vs last month`;
      } else if (monthDiff < 0) {
        const absDiff = Math.abs(monthDiff);
        const pct = prevMonthVal > 0 ? (absDiff / prevMonthVal) * 100 : 100;
        compText = `<span style="color: var(--accent-success); font-weight: 700;">-₹${absDiff.toFixed(2)} (-${pct.toFixed(0)}%)</span> vs last month`;
      } else {
        compText = `<span style="color: var(--text-muted);">No difference</span> vs last month`;
      }
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

  // Draw main grid axes
  svgContent += `
    <line class="chart-axis-line" x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + chartHeight}"></line>
    <line class="chart-axis-line" x1="${paddingLeft}" y1="${paddingTop + chartHeight}" x2="${svgWidth - paddingRight}" y2="${paddingTop + chartHeight}"></line>
  `;

  spendingChartSvg.innerHTML = svgContent;

  // Bind mouse interactive events for tooltips
  const hoverElements = spendingChartSvg.querySelectorAll(".chart-bar, .chart-dot");
  hoverElements.forEach(el => {
    el.addEventListener("mouseenter", (e) => {
      const target = e.currentTarget as SVGElement;
      const value = target.getAttribute("data-value");

      // If we hover over a bar, get matching dot's values
      let dateLabel = target.getAttribute("data-label");
      let compareEncoded = target.getAttribute("data-compare");

      if (!compareEncoded && target.classList.contains("chart-bar")) {
        // Find matching dot index by comparing coordinates
        const barX = parseFloat(target.getAttribute("x") || "0");
        const barW = parseFloat(target.getAttribute("width") || "0");
        const centerX = barX + barW / 2;

        // Find dot closest to centerX
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
        const x = mouseEvent.clientX - containerRect.left;
        const y = mouseEvent.clientY - containerRect.top;

        chartTooltipEl.style.left = `${x}px`;
        chartTooltipEl.style.top = `${y}px`;
      }
    });

    el.addEventListener("mouseleave", () => {
      if (chartTooltipEl) {
        chartTooltipEl.style.opacity = "0";
      }
    });
  });
}

// DOM UI updating
function updateUI() {
  // Update spending chart
  renderSpendingChart();

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
  const totalPages = Math.ceil(transactions.length / itemsPerPage) || 1;
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  if (btnPrevPage && btnNextPage && pageIndicatorEl) {
    btnPrevPage.disabled = currentPage === 1;
    btnNextPage.disabled = currentPage === totalPages;
    pageIndicatorEl.innerText = `Page ${currentPage} of ${totalPages}`;

    const paginationContainer = document.getElementById("ledger-pagination");
    if (paginationContainer) {
      paginationContainer.style.display = transactions.length === 0 ? "none" : "flex";
    }
  }

  if (transactions.length === 0) {
    ledgerListEl.innerHTML = `
      <div class="ledger-empty">
        <p>No transactions logged yet. Add one above to get started!</p>
      </div>
    `;
    return;
  }

  const startIndex = (currentPage - 1) * itemsPerPage;
  const pageTransactions = transactions.slice(startIndex, startIndex + itemsPerPage);

  ledgerListEl.innerHTML = pageTransactions.map(t => {
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

if (btnChartWeekly && btnChartMonthly) {
  btnChartWeekly.addEventListener("click", () => {
    if (activeChartTab === "weekly") return;
    activeChartTab = "weekly";
    btnChartWeekly.classList.add("active");
    btnChartMonthly.classList.remove("active");
    renderSpendingChart();
  });

  btnChartMonthly.addEventListener("click", () => {
    if (activeChartTab === "monthly") return;
    activeChartTab = "monthly";
    btnChartMonthly.classList.add("active");
    btnChartWeekly.classList.remove("active");
    renderSpendingChart();
  });
}

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

if (btnPrevPage && btnNextPage) {
  btnPrevPage.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      updateUI();
    }
  });

  btnNextPage.addEventListener("click", () => {
    const totalPages = Math.ceil(transactions.length / itemsPerPage) || 1;
    if (currentPage < totalPages) {
      currentPage++;
      updateUI();
    }
  });
}

// Startup initialization
async function init() {
  setDefaultDate();

  // Initial API check
  const isOnline = await checkApiStatus();
  if (isOnline) {
    await loadTransactions();
  } else {
    // If backend is offline, update metrics UI to default state
    updateUI();
  }

  // Poll API status every 10 seconds
  setInterval(checkApiStatus, 10000);

  // Register PWA Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then((reg) => console.log("Service Worker registered successfully:", reg))
      .catch((err) => console.error("Service Worker registration failed:", err));
  }
}

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("load", () => {
  // If DOMContentLoaded already fired
  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  }
});
