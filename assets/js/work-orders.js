// assets/js/work-orders.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isFirmAdmin } from "./permissions.js";
import { loadFlatpickr } from "./excel-utils.js";

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

export const ORDER_TYPE_LABELS = {
  audit: "Audit",
  tax: "Tax",
  accounting: "Accounting",
  adhoc: "Adhoc",
  invoice_request: "Request for Invoice",
};
export const STATUS_LABELS = { not_started: "Not Started", in_progress: "In Progress", completed: "Completed" };

function isoToDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function dmyToISO(text) {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

let allWorkOrdersCache = [];
let allClientsForFilter = [];
let allStaffForAssign = [];
let woFilters = { client: "", type: "", status: "" };

// ---------- main page ----------
export async function renderWorkOrders(el) {
  const orgId = getIdentity()?.organisationId;

  const [{ data: clients }, { data: members }] = await Promise.all([
    supabase.from("clients").select("id, legal_name").eq("organisation_id", orgId).order("legal_name"),
    supabase.from("organisation_members").select("user_id, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active"),
  ]);
  allClientsForFilter = clients || [];
  allStaffForAssign = members || [];

  el.innerHTML = `
    <div class="page-header">
      <h1>Work Orders</h1>
      <div class="page-actions">
        <select id="wo-filter-client" class="filter-select">
          <option value="">All Clients</option>
          ${allClientsForFilter.map((c) => `<option value="${c.id}">${c.legal_name}</option>`).join("")}
        </select>
        <select id="wo-filter-type" class="filter-select">
          <option value="">All Types</option>
          ${Object.entries(ORDER_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        <select id="wo-filter-status" class="filter-select">
          <option value="">All Statuses</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        ${isFirmAdmin() ? `<button id="add-wo-btn" class="btn-dark">+ Add Work Order</button>` : ""}
      </div>
    </div>
    <div id="wo-table-wrap" class="import-card">Loading...</div>
  `;

  document.getElementById("wo-filter-client").addEventListener("change", (e) => { woFilters.client = e.target.value; renderFilteredTable(); });
  document.getElementById("wo-filter-type").addEventListener("change", (e) => { woFilters.type = e.target.value; renderFilteredTable(); });
  document.getElementById("wo-filter-status").addEventListener("change", (e) => { woFilters.status = e.target.value; renderFilteredTable(); });

  const addBtn = document.getElementById("add-wo-btn");
  if (addBtn) addBtn.addEventListener("click", () => openWorkOrderModal({ onSaved: loadAndRenderAll }));

  await loadAndRenderAll();
}

async function loadAndRenderAll() {
  const orgId = getIdentity()?.organisationId;
  const { data, error } = await supabase
    .from("work_orders")
    .select("id, order_type, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, clients(legal_name), profiles!assigned_user_id(display_name, email)")
    .eq("organisation_id", orgId)
    .order("deadline_date", { ascending: true, nullsFirst: false });

  if (error) {
    const wrap = document.getElementById("wo-table-wrap");
    if (wrap) wrap.innerHTML = `<div class="empty-state">Could not load work orders.</div>`;
    return;
  }
  allWorkOrdersCache = data || [];
  renderFilteredTable();
}

function renderFilteredTable() {
  const filtered = allWorkOrdersCache.filter((wo) => {
    if (woFilters.client && wo.client_id !== woFilters.client) return false;
    if (woFilters.type && wo.order_type !== woFilters.type) return false;
    if (woFilters.status && wo.status !== woFilters.status) return false;
    return true;
  });
  const wrap = document.getElementById("wo-table-wrap");
  if (wrap) renderWorkOrdersTable(wrap, filtered, { showClient: true, onChanged: loadAndRenderAll });
}

// ---------- shared table renderer (used here and from Client Details) ----------
export function renderWorkOrdersTable(container, orders, { showClient = false, onChanged } = {}) {
  if (!orders.length) {
    container.innerHTML = `<div class="empty-state"><p>No work orders yet.</p></div>`;
    return;
  }

  const selfId = getIdentity()?.user?.id;
  const admin = isFirmAdmin();

  container.innerHTML = `
    <table class="data-table">
      <thead><tr>
        ${showClient ? "<th>Client</th>" : ""}
        <th>Type</th><th>Financial Year</th><th>Assigned Staff</th><th>Deadline</th><th>Budget Fee</th><th>Status</th><th>Remark</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${orders
          .map((wo) => {
            const canUpdateStatus = admin || wo.assigned_user_id === selfId;
            return `<tr>
              ${showClient ? `<td>${wo.clients?.legal_name || "-"}</td>` : ""}
              <td>${ORDER_TYPE_LABELS[wo.order_type] || wo.order_type}</td>
              <td>${isoToDMY(wo.financial_year_end) || "-"}</td>
              <td>${wo.profiles?.display_name || wo.profiles?.email || "-"}</td>
              <td>${isoToDMY(wo.deadline_date) || "-"}</td>
              <td>${wo.budget_fee != null ? `$${Number(wo.budget_fee).toLocaleString()}` : "-"}</td>
              <td>
                ${canUpdateStatus
                  ? `<select class="filter-select wo-status-select" data-wo="${wo.id}">
                      ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${wo.status === k ? "selected" : ""}>${v}</option>`).join("")}
                    </select>`
                  : `<span class="status-badge ${wo.status === "completed" ? "status-completed" : wo.status === "in_progress" ? "status-quotation" : "status-wip"}">${STATUS_LABELS[wo.status]}</span>`
                }
              </td>
              <td class="wo-remark-cell" title="${(wo.description || "").replace(/"/g, "&quot;")}">${wo.description || "-"}</td>
              <td class="row-actions">
                ${admin ? `<button class="icon-btn icon-btn-edit" data-edit="${wo.id}" title="Edit">${EDIT_ICON}</button>` : ""}
                ${admin ? `<button class="icon-btn icon-btn-delete" data-delete="${wo.id}" title="Delete">${DELETE_ICON}</button>` : ""}
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;

  container.querySelectorAll(".wo-status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const { error } = await supabase.rpc("update_work_order_status", { work_order_uuid: sel.dataset.wo, new_status: sel.value });
      if (error) { alert("Could not update status: " + error.message); return; }
      if (onChanged) await onChanged();
    });
  });

  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wo = orders.find((o) => o.id === btn.dataset.edit);
      openWorkOrderModal({ clientId: wo.client_id, existing: wo, onSaved: onChanged });
    });
  });

  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this work order? This cannot be undone.")) return;
      const { error } = await supabase.from("work_orders").delete().eq("id", btn.dataset.delete);
      if (error) { alert("Could not delete: " + error.message); return; }
      if (onChanged) await onChanged();
    });
  });
}

// ---------- add/edit modal (shared) ----------
export async function openWorkOrderModal({ clientId, existing, onSaved } = {}) {
  const isEdit = !!existing;
  const orgId = getIdentity()?.organisationId;

  // Ensure staff list is available even if this modal is opened before the main page loads it
  if (!allStaffForAssign.length) {
    const { data: members } = await supabase.from("organisation_members").select("user_id, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active");
    allStaffForAssign = members || [];
  }
  let clientOptionsHtml = "";
  if (!clientId) {
    if (!allClientsForFilter.length) {
      const { data: clients } = await supabase.from("clients").select("id, legal_name").eq("organisation_id", orgId).order("legal_name");
      allClientsForFilter = clients || [];
    }
    clientOptionsHtml = `
      <label style="display:block;margin-bottom:14px;">Client
        <select id="wo-client" required style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
          <option value="">Select a client...</option>
          ${allClientsForFilter.map((c) => `<option value="${c.id}" ${existing?.client_id === c.id ? "selected" : ""}>${c.legal_name}</option>`).join("")}
        </select>
      </label>`;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${isEdit ? "Edit Work Order" : "Add Work Order"}</h2>
          <p class="modal-subtitle">${isEdit ? "Update this engagement's details." : "Create a new engagement for this client."}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="wo-form">
        ${clientOptionsHtml}
        <label style="display:block;margin-bottom:14px;">Type
          <select id="wo-type" required style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
            ${Object.entries(ORDER_TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${existing?.order_type === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label style="display:block;margin-bottom:14px;">Financial Year
          <input type="text" id="wo-fye" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.financial_year_end)}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>
        <div id="wo-staff-deadline-fields">
          <label style="display:block;margin-bottom:14px;">Staff Assigned
            <select id="wo-assigned" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
              <option value="">Unassigned</option>
              ${allStaffForAssign.map((m) => `<option value="${m.user_id}" ${existing?.assigned_user_id === m.user_id ? "selected" : ""}>${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}
            </select>
          </label>
          <label style="display:block;margin-bottom:14px;">Deadline
            <input type="text" id="wo-deadline" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.deadline_date)}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
          <label style="display:block;margin-bottom:14px;">Budget Fee ($)
            <input type="number" step="0.01" id="wo-budget-fee" value="${existing?.budget_fee ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
        </div>
        <div id="wo-invoice-fields">
          <label style="display:block;margin-bottom:14px;">Professional Fee ($)
            <input type="number" step="0.01" id="wo-professional-fee" value="${existing?.professional_fee ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
          <label style="display:block;margin-bottom:14px;">OPE ($)
            <input type="number" step="0.01" id="wo-ope" value="${existing?.ope ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
        </div>
        <label style="display:block;margin-bottom:14px;">Status
          <select id="wo-status" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
            ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${(existing?.status || "not_started") === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label style="display:block;margin-bottom:4px;">Description (optional)
          <textarea id="wo-description" rows="3" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;">${existing?.description ?? ""}</textarea>
        </label>
        <p id="wo-error" class="form-error hidden"></p>
        <div class="modal-actions">
          <button type="button" id="wo-cancel" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">${isEdit ? "Save Changes" : "Add Work Order"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  try {
    await loadFlatpickr();
    window.flatpickr("#wo-fye", { dateFormat: "d/m/Y", allowInput: true });
    window.flatpickr("#wo-deadline", { dateFormat: "d/m/Y", allowInput: true });
  } catch (err) {
    console.warn(err.message);
  }

  function updateFieldsForType() {
    const isInvoice = document.getElementById("wo-type").value === "invoice_request";
    document.getElementById("wo-staff-deadline-fields").classList.toggle("hidden", isInvoice);
    document.getElementById("wo-invoice-fields").classList.toggle("hidden", !isInvoice);
  }
  document.getElementById("wo-type").addEventListener("change", updateFieldsForType);
  updateFieldsForType();

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  document.getElementById("wo-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  document.getElementById("wo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("wo-error");
    const identity = getIdentity();

    const finalClientId = clientId || document.getElementById("wo-client").value;
    if (!finalClientId) {
      errorEl.textContent = "Please select a client.";
      errorEl.classList.remove("hidden");
      return;
    }

    const fyeText = document.getElementById("wo-fye").value.trim();
    const fyeISO = fyeText ? dmyToISO(fyeText) : null;
    if (fyeText && fyeISO === undefined) {
      errorEl.textContent = `Could not understand the Financial Year date "${fyeText}". Use DD/MM/YYYY.`;
      errorEl.classList.remove("hidden");
      return;
    }
    const isInvoice = document.getElementById("wo-type").value === "invoice_request";

    const deadlineText = isInvoice ? "" : document.getElementById("wo-deadline").value.trim();
    const deadlineISO = deadlineText ? dmyToISO(deadlineText) : null;
    if (deadlineText && deadlineISO === undefined) {
      errorEl.textContent = `Could not understand the Deadline date "${deadlineText}". Use DD/MM/YYYY.`;
      errorEl.classList.remove("hidden");
      return;
    }

    const payload = {
      organisation_id: orgId,
      client_id: finalClientId,
      order_type: document.getElementById("wo-type").value,
      financial_year_end: fyeISO || null,
      assigned_user_id: isInvoice ? null : (document.getElementById("wo-assigned").value || null),
      deadline_date: isInvoice ? null : (deadlineISO || null),
      budget_fee: isInvoice ? null : (document.getElementById("wo-budget-fee").value || null),
      professional_fee: isInvoice ? (document.getElementById("wo-professional-fee").value || null) : null,
      ope: isInvoice ? (document.getElementById("wo-ope").value || null) : null,
      status: document.getElementById("wo-status").value,
      description: document.getElementById("wo-description").value.trim() || null,
    };

    let result;
    if (isEdit) {
      result = await supabase.from("work_orders").update(payload).eq("id", existing.id);
    } else {
      payload.created_by = identity.user.id;
      result = await supabase.from("work_orders").insert(payload);
    }

    if (result.error) {
      errorEl.textContent = "Could not save: " + result.error.message;
      errorEl.classList.remove("hidden");
      return;
    }

    close();
    if (onSaved) await onSaved();
  });
}
