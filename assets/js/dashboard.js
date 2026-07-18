// assets/js/dashboard.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { ORDER_TYPE_LABELS, STATUS_LABELS, renderWorkOrdersTable } from "./work-orders.js";

const STATUS_COLORS = { not_started: "#9aa3b2", in_progress: "#f59e0b", completed: "#16a34a" };
const TYPE_COLORS = { audit: "#2563eb", tax: "#059669", accounting: "#7c3aed", adhoc: "#ca8a04", invoice_request: "#db2777" };
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let dashOrgMembersCache = [];
let dashWorkOrdersCache = [];
let dashDeadlinesCache = [];
let selectedStaffId = "";

export async function renderDashboard(el) {
  el.innerHTML = `
    <div class="page-header"><h1>Dashboard</h1></div>
    <div class="import-card">
      <label style="font-size:13px;font-weight:600;color:var(--gray-600);display:flex;align-items:center;gap:8px;">
        Filter by Staff:
        <select id="dash-staff-filter" class="filter-select">
          <option value="">All Staff</option>
        </select>
      </label>
    </div>
    <div class="kpi-grid" id="kpi-grid">
      <div class="kpi-card skeleton"></div>
      <div class="kpi-card skeleton"></div>
      <div class="kpi-card skeleton"></div>
      <div class="kpi-card skeleton"></div>
    </div>
    <div class="wo-summary-grid" id="wo-summary-grid"></div>
    <div class="import-card">
      <h3 style="margin-top:0;">Work Orders by Staff</h3>
      <p class="hint">Click a staff member to see their work orders below.</p>
      <div id="wo-by-staff-table">Loading...</div>
    </div>
    <div class="import-card">
      <h3 style="margin-top:0;">Budget Fee by Staff — ${new Date().getFullYear()}</h3>
      <p class="hint">Total budget fee per staff member, by month (Audit/Tax/Accounting/Adhoc work orders — Request for Invoice isn't included here since it tracks Professional Fee/OPE separately). Grouped by each work order's deadline month.</p>
      <div id="budget-fee-table">Loading...</div>
    </div>
    <div class="import-card">
      <h3 style="margin-top:0;">Outstanding Work Orders by Month</h3>
      <p class="hint">Click a bar to see which work orders fall in that month.</p>
      <div id="wo-by-month-chart"></div>
    </div>
    <div class="import-card hidden" id="wo-details-card">
      <h3 id="wo-details-title" style="margin-top:0;">Details</h3>
      <div id="wo-details-table"></div>
    </div>
  `;

  const identity = getIdentity();
  const orgId = identity?.organisationId;
  if (!orgId) return;

  const [{ data: deadlines }, { data: members }, { data: allWO }] =
    await Promise.all([
      supabase.from("client_deadlines").select("id, deadline_type, deadline_date, status, client_id, clients(legal_name)").eq("organisation_id", orgId),
      supabase.from("organisation_members").select("user_id, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active"),
      supabase
        .from("work_orders")
        .select("id, order_type, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, clients(legal_name), profiles!assigned_user_id(display_name, email)")
        .eq("organisation_id", orgId),
    ]);

  dashDeadlinesCache = deadlines || [];
  dashOrgMembersCache = members || [];
  dashWorkOrdersCache = allWO || [];

  const staffSelect = document.getElementById("dash-staff-filter");
  staffSelect.innerHTML = `<option value="">All Staff</option>${dashOrgMembersCache.map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}`;
  staffSelect.addEventListener("change", (e) => {
    selectedStaffId = e.target.value;
    renderKpis();
    renderStatusTypeCharts();
    renderMonthChart();
    renderBudgetFeeByStaff();
    document.getElementById("wo-details-card").classList.add("hidden");
  });

  renderKpis();
  renderStatusTypeCharts();
  renderStaffSummary();
  renderBudgetFeeByStaff();
  renderMonthChart();
}

function filteredOrders() {
  if (!selectedStaffId) return dashWorkOrdersCache;
  return dashWorkOrdersCache.filter((wo) => wo.assigned_user_id === selectedStaffId);
}

function renderKpis() {
  const openDeadlines = dashDeadlinesCache.filter((d) => d.status !== "completed");
  const overdueDeadlines = dashDeadlinesCache.filter((d) => d.status === "overdue");
  const completedDeadlines = dashDeadlinesCache.filter((d) => d.status === "completed");
  const openWO = filteredOrders().filter((wo) => wo.status !== "completed");

  document.getElementById("kpi-grid").innerHTML = `
    ${kpiCard("Total Open Deadlines", openDeadlines.length, "open-deadlines")}
    ${kpiCard("Overdue", overdueDeadlines.length, "overdue-deadlines")}
    ${kpiCard("Completed", completedDeadlines.length, "completed-deadlines")}
    ${kpiCard("Open Work Orders", openWO.length, "open-work-orders")}
  `;

  document.getElementById("kpi-card-open-deadlines").addEventListener("click", () => showDeadlineDetails("Total Open Deadlines", openDeadlines));
  document.getElementById("kpi-card-overdue-deadlines").addEventListener("click", () => showDeadlineDetails("Overdue Deadlines", overdueDeadlines));
  document.getElementById("kpi-card-completed-deadlines").addEventListener("click", () => showDeadlineDetails("Completed Deadlines", completedDeadlines));
  document.getElementById("kpi-card-open-work-orders").addEventListener("click", () => showDetails("Open Work Orders", openWO));
}

function kpiCard(label, value, key) {
  return `<div class="kpi-card kpi-card-clickable" id="kpi-card-${key}"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`;
}

function renderStatusTypeCharts() {
  const statusCounts = { not_started: 0, in_progress: 0, completed: 0 };
  const typeCounts = { audit: 0, tax: 0, accounting: 0, adhoc: 0, invoice_request: 0 };
  filteredOrders().forEach((wo) => {
    if (wo.status in statusCounts) statusCounts[wo.status]++;
    if (wo.order_type in typeCounts) typeCounts[wo.order_type]++;
  });

  document.getElementById("wo-summary-grid").innerHTML = `
    ${barChartCard("Work Orders by Status", statusCounts, STATUS_LABELS, STATUS_COLORS, "chart-by-status")}
    ${barChartCard("Work Orders by Type", typeCounts, ORDER_TYPE_LABELS, TYPE_COLORS, "chart-by-type")}
  `;

  document.querySelectorAll("#chart-by-status [data-bar-key]").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row.dataset.barKey;
      showDetails(`Work Orders — ${STATUS_LABELS[key]}`, filteredOrders().filter((wo) => wo.status === key));
    });
  });
  document.querySelectorAll("#chart-by-type [data-bar-key]").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row.dataset.barKey;
      showDetails(`Work Orders — ${ORDER_TYPE_LABELS[key]}`, filteredOrders().filter((wo) => wo.order_type === key));
    });
  });
}

function barChartCard(title, dataObj, labelMap, colorMap, chartId) {
  const entries = Object.entries(dataObj);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return `
    <div class="import-card">
      <h3 style="margin-top:0;">${title}</h3>
      <div class="bar-chart" ${chartId ? `id="${chartId}"` : ""}>
        ${entries
          .map(
            ([key, val]) => `
          <div class="bar-row ${chartId ? "bar-row-clickable" : ""}" ${chartId ? `data-bar-key="${key}"` : ""}>
            <span class="bar-label">${labelMap[key] || key}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${(val / max) * 100}%;background:${colorMap[key] || "var(--blue-600)"};"></div></div>
            <span class="bar-value">${val}</span>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function renderBudgetFeeByStaff() {
  const wrap = document.getElementById("budget-fee-table");
  const year = new Date().getFullYear();
  const totals = {}; // { userId: [jan..dec] }

  dashWorkOrdersCache.forEach((wo) => {
    if (wo.order_type === "invoice_request") return;
    if (wo.budget_fee == null || !wo.deadline_date || !wo.assigned_user_id) return;
    const d = new Date(wo.deadline_date + "T00:00:00");
    if (d.getFullYear() !== year) return;
    totals[wo.assigned_user_id] = totals[wo.assigned_user_id] || Array(12).fill(0);
    totals[wo.assigned_user_id][d.getMonth()] += Number(wo.budget_fee);
  });

  const members = selectedStaffId ? dashOrgMembersCache.filter((m) => m.user_id === selectedStaffId) : dashOrgMembersCache;
  const rows = members.map((m) => {
    const months = totals[m.user_id] || Array(12).fill(0);
    return { name: m.profiles?.display_name || m.profiles?.email, months, total: months.reduce((a, b) => a + b, 0) };
  });

  if (!rows.some((r) => r.total > 0)) {
    wrap.innerHTML = `<div class="empty-state">No budget fees recorded for ${year} yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Staff</th>
        ${MONTH_NAMES.map((m) => `<th>${m}</th>`).join("")}
        <th>Total</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td><strong>${r.name}</strong></td>
              ${r.months.map((v) => `<td>${v > 0 ? `$${v.toLocaleString()}` : "-"}</td>`).join("")}
              <td><strong>${r.total > 0 ? `$${r.total.toLocaleString()}` : "-"}</strong></td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderStaffSummary() {
  const wrap = document.getElementById("wo-by-staff-table");
  const rows = dashOrgMembersCache.map((m) => {
    const mine = dashWorkOrdersCache.filter((wo) => wo.assigned_user_id === m.user_id);
    const outstanding = mine.filter((wo) => wo.status !== "completed").length;
    return { userId: m.user_id, name: m.profiles?.display_name || m.profiles?.email, total: mine.length, outstanding, completed: mine.length - outstanding };
  });

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state">No staff yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Staff</th><th>Total Work Orders</th><th>Outstanding</th><th>Completed</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr class="clickable-row" data-staff-row="${r.userId}">
              <td><strong>${r.name}</strong></td>
              <td>${r.total}</td>
              <td>${r.outstanding}</td>
              <td>${r.completed}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-staff-row]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const staff = rows.find((r) => r.userId === tr.dataset.staffRow);
      const orders = dashWorkOrdersCache.filter((wo) => wo.assigned_user_id === tr.dataset.staffRow);
      showDetails(`Work Orders — ${staff.name}`, orders);
    });
  });
}

function renderMonthChart() {
  const wrap = document.getElementById("wo-by-month-chart");
  const outstanding = filteredOrders().filter((wo) => wo.status !== "completed" && wo.deadline_date);

  const byMonth = {};
  outstanding.forEach((wo) => {
    const d = new Date(wo.deadline_date + "T00:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = byMonth[key] || { label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, count: 0 };
    byMonth[key].count++;
  });

  const sortedKeys = Object.keys(byMonth).sort();
  if (!sortedKeys.length) {
    wrap.innerHTML = `<div class="empty-state">No outstanding work orders with a deadline.</div>`;
    return;
  }
  const max = Math.max(1, ...sortedKeys.map((k) => byMonth[k].count));

  wrap.innerHTML = `
    <div class="bar-chart">
      ${sortedKeys
        .map(
          (k) => `
        <div class="bar-row bar-row-clickable" data-month-key="${k}">
          <span class="bar-label">${byMonth[k].label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(byMonth[k].count / max) * 100}%;background:var(--blue-600);"></div></div>
          <span class="bar-value">${byMonth[k].count}</span>
        </div>`
        )
        .join("")}
    </div>
  `;

  wrap.querySelectorAll("[data-month-key]").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row.dataset.monthKey;
      const orders = outstanding.filter((wo) => {
        const d = new Date(wo.deadline_date + "T00:00:00");
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === key;
      });
      showDetails(`Outstanding Work Orders — ${byMonth[key].label}`, orders);
    });
  });
}

function showDetails(title, orders) {
  const card = document.getElementById("wo-details-card");
  document.getElementById("wo-details-title").textContent = title;
  card.classList.remove("hidden");
  renderWorkOrdersTable(document.getElementById("wo-details-table"), orders, { showClient: true });
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function isoToDMYDash(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function showDeadlineDetails(title, deadlines) {
  const card = document.getElementById("wo-details-card");
  document.getElementById("wo-details-title").textContent = title;
  card.classList.remove("hidden");

  const wrap = document.getElementById("wo-details-table");
  if (!deadlines.length) {
    wrap.innerHTML = `<div class="empty-state">No deadlines match.</div>`;
  } else {
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Client</th><th>Deadline Type</th><th>Deadline Date</th><th>Status</th></tr></thead>
        <tbody>
          ${deadlines
            .map(
              (d) => `<tr>
                <td>${d.clients?.legal_name || "-"}</td>
                <td>${d.deadline_type}</td>
                <td>${isoToDMYDash(d.deadline_date) || "-"}</td>
                <td><span class="status-badge ${d.status === "completed" ? "status-completed" : d.status === "overdue" ? "status-rejected" : "status-wip"}">${d.status}</span></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
