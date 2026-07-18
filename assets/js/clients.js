// assets/js/clients.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { loadSheetJS, downloadBlankTemplate, exportClientsWorkbook, parseClientWorkbook, validateRow, loadFlatpickr } from "./excel-utils.js";
import { renderWorkOrdersTable, openWorkOrderModal } from "./work-orders.js";
import { isFirmAdmin } from "./permissions.js";

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

// FYE is stored as ISO (yyyy-mm-dd) in the database but always shown/typed as DD/MM/YYYY.
function isoToDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function dmyToISO(text) {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined; // signals "could not parse"
  const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

let allClients = [];
let activeFilters = { search: "", status: "", branch: "", fye: "" };

export async function renderClients(el) {
  el.innerHTML = `
    <div class="page-header"><h1>Client List</h1></div>
    <div class="import-card">
      <div class="client-toolbar">
        <input type="text" id="client-search" class="search-input" placeholder="Search clients..." />
        <div class="page-actions">
          <select id="filter-status" class="filter-select">
            <option value="">All Statuses</option>
            <option value="WIP">WIP</option>
            <option value="Completed">Completed</option>
            <option value="Quotation">Quotation</option>
          </select>
          <select id="filter-branch" class="filter-select">
            <option value="">All Branches</option>
          </select>
          <select id="filter-fye" class="filter-select">
            <option value="">All Year Ends</option>
          </select>
          <button id="download-template-btn" class="btn-secondary">Download Template</button>
          <button id="export-clients-btn" class="btn-secondary">Export</button>
          <button id="import-clients-btn" class="btn-secondary">Import</button>
          <button id="add-client-btn" class="btn-dark">+ Add Client</button>
          <input type="file" id="import-file-input" accept=".xlsx,.xls" class="hidden" />
        </div>
      </div>
      <div id="clients-table-wrap">Loading...</div>
    </div>
    <div id="import-section"></div>
  `;

  document.getElementById("download-template-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Preparing...";
    try {
      await downloadBlankTemplate();
    } catch (err) {
      alert(err.message);
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Download Template";
    }
  });

  document.getElementById("export-clients-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Preparing...";
    try {
      const contactsByClientId = await fetchContactsMap(allClients.map((c) => c.id));
      await exportClientsWorkbook(allClients, contactsByClientId);
    } catch (err) {
      alert(err.message);
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Export";
    }
  });

  document.getElementById("add-client-btn").addEventListener("click", () => openClientModal(null));

  const fileInput = document.getElementById("import-file-input");
  document.getElementById("import-clients-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await handleImportFile(file);
    fileInput.value = "";
  });

  document.getElementById("client-search").addEventListener("input", (e) => {
    activeFilters.search = e.target.value;
    renderTableRows(applyFilters());
  });
  document.getElementById("filter-status").addEventListener("change", (e) => {
    activeFilters.status = e.target.value;
    renderTableRows(applyFilters());
  });
  document.getElementById("filter-branch").addEventListener("change", (e) => {
    activeFilters.branch = e.target.value;
    renderTableRows(applyFilters());
  });
  document.getElementById("filter-fye").addEventListener("change", (e) => {
    activeFilters.fye = e.target.value;
    renderTableRows(applyFilters());
  });

  await loadAndRenderTable();
}

async function fetchContactsMap(clientIds) {
  if (!clientIds.length) return {};
  const { data } = await supabase
    .from("client_contacts")
    .select("client_id, name, email, phone")
    .in("client_id", clientIds)
    .eq("is_primary", true);
  const map = {};
  (data || []).forEach((c) => { map[c.client_id] = c; });
  return map;
}

function applyFilters() {
  const q = (activeFilters.search || "").trim().toLowerCase();
  return allClients.filter((c) => {
    if (q && !c.legal_name.toLowerCase().includes(q) && !(c.branch || "").toLowerCase().includes(q)) return false;
    if (activeFilters.status && c.workflow_status !== activeFilters.status) return false;
    if (activeFilters.branch && c.branch !== activeFilters.branch) return false;
    if (activeFilters.fye && c.financial_year_end !== activeFilters.fye) return false;
    return true;
  });
}

function populateBranchFilter() {
  const select = document.getElementById("filter-branch");
  if (!select) return;
  const branches = [...new Set(allClients.map((c) => c.branch).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML = `<option value="">All Branches</option>${branches.map((b) => `<option value="${b}">${b}</option>`).join("")}`;
  select.value = branches.includes(current) ? current : "";
}

function populateFyeFilter() {
  const select = document.getElementById("filter-fye");
  if (!select) return;
  const dates = [...new Set(allClients.map((c) => c.financial_year_end).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML = `<option value="">All Year Ends</option>${dates.map((d) => `<option value="${d}">${isoToDMY(d)}</option>`).join("")}`;
  select.value = dates.includes(current) ? current : "";
}

function resetFilters() {
  activeFilters = { search: "", status: "", branch: "", fye: "" };
  const searchEl = document.getElementById("client-search");
  const statusEl = document.getElementById("filter-status");
  const branchEl = document.getElementById("filter-branch");
  const fyeEl = document.getElementById("filter-fye");
  if (searchEl) searchEl.value = "";
  if (statusEl) statusEl.value = "";
  if (branchEl) branchEl.value = "";
  if (fyeEl) fyeEl.value = "";
}

async function loadAndRenderTable() {
  const orgId = getIdentity()?.organisationId;
  const [{ data, error }, { data: openWOs }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, legal_name, registration_number, financial_year_end, audit_fee, branch, invoice_to_date, workflow_status, industry, company_address, directors")
      .eq("organisation_id", orgId)
      .order("legal_name"),
    supabase.from("work_orders").select("client_id").eq("organisation_id", orgId).neq("status", "completed"),
  ]);

  if (error) {
    document.getElementById("clients-table-wrap").innerHTML = `<div class="empty-state">Could not load clients.</div>`;
    return;
  }

  const outstandingByClient = {};
  (openWOs || []).forEach((wo) => { outstandingByClient[wo.client_id] = (outstandingByClient[wo.client_id] || 0) + 1; });

  allClients = (data || []).map((c) => ({ ...c, outstanding_work_orders: outstandingByClient[c.id] || 0 }));
  populateBranchFilter();
  populateFyeFilter();
  renderTableRows(applyFilters());
}

function money(v) {
  return v != null ? `$${Number(v).toLocaleString()}` : "-";
}

function statusBadgeClass(status) {
  if (status === "Completed") return "status-completed";
  if (status === "Quotation") return "status-quotation";
  return "status-wip";
}

function renderTableRows(rows) {
  const wrap = document.getElementById("clients-table-wrap");
  if (!wrap) return;

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><p>No clients match.</p><p class="hint">Add one manually, export a template to fill in, or import a filled one back.</p></div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Company Name</th><th>Financial Year End</th><th>Annual Fee</th>
        <th>Invoice to Date</th><th>Branch</th>
        <th>Outstanding Work Orders</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (c) => `<tr class="clickable-row" data-row-client="${c.id}">
              <td><strong>${c.legal_name}</strong></td>
              <td>${isoToDMY(c.financial_year_end) || "-"}</td>
              <td>${money(c.audit_fee)}</td>
              <td>${money(c.invoice_to_date)}</td>
              <td>${c.branch || "-"}</td>
              <td>${c.outstanding_work_orders > 0 ? `<span class="status-badge status-wip">${c.outstanding_work_orders} outstanding</span>` : `<span class="status-badge status-completed">None</span>`}</td>
              <td class="row-actions">
                <button class="icon-btn icon-btn-edit" data-edit="${c.id}" title="Edit">${EDIT_ICON}</button>
                <button class="icon-btn icon-btn-delete" data-delete="${c.id}" data-name="${c.legal_name}" title="Delete">${DELETE_ICON}</button>
              </td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("tr[data-row-client]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".row-actions")) return;
      const row = allClients.find((c) => c.id === tr.dataset.rowClient);
      if (row) openClientDetailsModal(row);
    });
  });

  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = allClients.find((c) => c.id === btn.dataset.edit);
      openClientModal(row);
    });
  });

  wrap.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete ${btn.dataset.name}? This also removes their contacts, assignments, and deadlines. This cannot be undone.`)) return;
      const { error: delError } = await supabase.from("clients").delete().eq("id", btn.dataset.delete);
      if (delError) { alert("Could not delete: " + delError.message); return; }
      await loadAndRenderTable();
    });
  });
}

async function openClientDetailsModal(client) {
  const orgId = getIdentity()?.organisationId;

  const [{ data: contact }, { data: workOrders }] = await Promise.all([
    supabase.from("client_contacts").select("name, email, phone").eq("client_id", client.id).eq("is_primary", true).maybeSingle(),
    supabase
      .from("work_orders")
      .select("id, order_type, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, profiles!assigned_user_id(display_name, email)")
      .eq("client_id", client.id)
      .order("deadline_date", { ascending: true, nullsFirst: false }),
  ]);

  const directors = client.directors || [];

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:720px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Client Details</h2>
          <p class="modal-subtitle">Comprehensive information about the client</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>

      <div class="modal-grid">
        <div><label class="option-label">Company Name</label><div>${client.legal_name}</div></div>
        <div><label class="option-label">Registration Number</label><div>${client.registration_number || "-"}</div></div>
        <div class="full-width"><label class="option-label">Company Address</label><div>${client.company_address || "-"}</div></div>
        <div><label class="option-label">Contact Person</label><div>${contact?.name || "-"}</div></div>
        <div><label class="option-label">Email</label><div>${contact?.email || "-"}</div></div>
        <div><label class="option-label">Phone</label><div>${contact?.phone || "-"}</div></div>
        <div><label class="option-label">Financial Year End</label><div>${isoToDMY(client.financial_year_end) || "-"}</div></div>
        <div><label class="option-label">Outstanding Work Orders</label><div>${client.outstanding_work_orders > 0 ? `<span class="status-badge status-wip">${client.outstanding_work_orders} outstanding</span>` : `<span class="status-badge status-completed">None</span>`}</div></div>
        <div><label class="option-label">Annual Fee</label><div>${money(client.audit_fee)}</div></div>
        <div><label class="option-label">Branch</label><div>${client.branch || "-"}</div></div>
        <div><label class="option-label">Industry</label><div>${client.industry || "-"}</div></div>
      </div>

      ${directors.length ? `
        <h3 style="margin-top:20px;">Directors</h3>
        <ul style="margin:8px 0 0;padding-left:20px;">
          ${directors.map((d) => `<li>${d}</li>`).join("")}
        </ul>` : ""}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;">
        <h3 style="margin:0;">Work Orders</h3>
        ${isFirmAdmin() ? `<button id="add-wo-from-client-btn" class="btn-dark" style="width:auto;">+ Add Work Order</button>` : ""}
      </div>
      <div id="client-wo-table-wrap" style="margin-top:12px;"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  async function refreshClientWorkOrders() {
    const { data: refreshed } = await supabase
      .from("work_orders")
      .select("id, order_type, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, profiles!assigned_user_id(display_name, email)")
      .eq("client_id", client.id)
      .order("deadline_date", { ascending: true, nullsFirst: false });
    renderWorkOrdersTable(document.getElementById("client-wo-table-wrap"), refreshed || [], { showClient: false, onChanged: refreshClientWorkOrders });
  }

  renderWorkOrdersTable(document.getElementById("client-wo-table-wrap"), workOrders || [], {
    showClient: false,
    onChanged: refreshClientWorkOrders,
  });

  const addWoBtn = document.getElementById("add-wo-from-client-btn");
  if (addWoBtn) {
    addWoBtn.addEventListener("click", () => {
      openWorkOrderModal({ clientId: client.id, onSaved: refreshClientWorkOrders });
    });
  }

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
}

async function openClientModal(existing) {
  const isEdit = !!existing;
  let primaryContact = { name: "", email: "", phone: "" };

  if (isEdit) {
    const { data } = await supabase
      .from("client_contacts")
      .select("id, name, email, phone")
      .eq("client_id", existing.id)
      .eq("is_primary", true)
      .maybeSingle();
    if (data) primaryContact = data;
  }

  const directors = existing?.directors || [];
  const directorInput = (i) => `<input type="text" id="cf-director-${i}" placeholder="Director ${i + 1} name" value="${directors[i] ?? ""}" />`;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${isEdit ? "Edit Client" : "Add New Client"}</h2>
          <p class="modal-subtitle">${isEdit ? "Update this client's information" : "Enter information for the new client"}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="client-form">
        <div class="modal-grid">
          <label>Company Name
            <input type="text" id="cf-legal-name" required value="${existing?.legal_name ?? ""}" />
          </label>
          <label>Registration Number
            <input type="text" id="cf-reg-number" value="${existing?.registration_number ?? ""}" />
          </label>

          <label>Contact Person
            <input type="text" id="cf-contact-name" value="${primaryContact.name ?? ""}" />
          </label>
          <label>Email
            <input type="email" id="cf-contact-email" value="${primaryContact.email ?? ""}" />
          </label>

          <label>Phone
            <input type="text" id="cf-contact-phone" value="${primaryContact.phone ?? ""}" />
          </label>
          <label>Financial Year End
            <input type="text" id="cf-fye" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.financial_year_end)}" />
          </label>

          <label>Industry
            <input type="text" id="cf-industry" value="${existing?.industry ?? ""}" />
          </label>
          <label>Annum Fee ($)
            <input type="number" step="0.01" id="cf-audit-fee" value="${existing?.audit_fee ?? ""}" />
          </label>

          <label class="full-width">Branch
            <input type="text" id="cf-branch" value="${existing?.branch ?? ""}" />
          </label>

          <label class="full-width">Company Address
            <input type="text" id="cf-address" value="${existing?.company_address ?? ""}" />
          </label>

          <div class="full-width">
            <p class="directors-label">Directors (up to 5)</p>
            <div class="modal-grid" style="margin-top:6px;">
              ${directorInput(0)}${directorInput(1)}${directorInput(2)}${directorInput(3)}
              <div>${directorInput(4)}</div>
            </div>
          </div>
        </div>

        <p id="cf-error" class="form-error hidden"></p>

        <div class="modal-actions">
          <button type="button" id="cf-cancel" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">${isEdit ? "Save Changes" : "Add Client"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  try {
    await loadFlatpickr();
    window.flatpickr("#cf-fye", { dateFormat: "d/m/Y", allowInput: true });
  } catch (err) {
    console.warn(err.message);
  }

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  document.getElementById("cf-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  document.getElementById("client-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const orgId = getIdentity()?.organisationId;
    const errorEl = document.getElementById("cf-error");

    const fyeText = document.getElementById("cf-fye").value.trim();
    const parsedFye = fyeText ? dmyToISO(fyeText) : null;
    if (fyeText && parsedFye === undefined) {
      errorEl.textContent = `Could not understand the date "${fyeText}". Use DD/MM/YYYY, e.g. 31/12/2025.`;
      errorEl.classList.remove("hidden");
      return;
    }

    const directorsList = [0, 1, 2, 3, 4]
      .map((i) => document.getElementById(`cf-director-${i}`).value.trim())
      .filter(Boolean);

    const payload = {
      organisation_id: orgId,
      legal_name: document.getElementById("cf-legal-name").value.trim(),
      registration_number: document.getElementById("cf-reg-number").value.trim() || null,
      financial_year_end: parsedFye || null,
      audit_fee: document.getElementById("cf-audit-fee").value || null,
      branch: document.getElementById("cf-branch").value.trim() || null,
      industry: document.getElementById("cf-industry").value.trim() || null,
      company_address: document.getElementById("cf-address").value.trim() || null,
      directors: directorsList.length ? directorsList : null,
    };

    let clientId = existing?.id;
    if (isEdit) {
      const { error } = await supabase.from("clients").update(payload).eq("id", clientId);
      if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    } else {
      const { data, error } = await supabase.from("clients").insert(payload).select().single();
      if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
      clientId = data.id;
    }

    const contactName = document.getElementById("cf-contact-name").value.trim();
    const contactEmail = document.getElementById("cf-contact-email").value.trim();
    const contactPhone = document.getElementById("cf-contact-phone").value.trim();
    if (contactName || contactEmail || contactPhone) {
      if (primaryContact.id) {
        await supabase.from("client_contacts").update({ name: contactName || null, email: contactEmail || null, phone: contactPhone || null }).eq("id", primaryContact.id);
      } else {
        await supabase.from("client_contacts").insert({ organisation_id: orgId, client_id: clientId, name: contactName || null, email: contactEmail || null, phone: contactPhone || null, is_primary: true });
      }
    }

    close();
    resetFilters();
    await loadAndRenderTable();
  });
}

async function handleImportFile(file) {
  const orgId = getIdentity()?.organisationId;
  const importSection = document.getElementById("import-section");
  importSection.innerHTML = `<div class="import-card"><p class="hint">Loading spreadsheet library...</p></div>`;

  try {
    await loadSheetJS();
  } catch (err) {
    importSection.innerHTML = `<div class="import-card"><p class="form-error">${err.message}</p></div>`;
    return;
  }

  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true });
  const { rows, error, sheetName } = parseClientWorkbook(workbook);

  if (error) {
    importSection.innerHTML = `<div class="import-card"><p class="form-error">${error}</p></div>`;
    return;
  }

  const { data: existingClients } = await supabase.from("clients").select("legal_name").eq("organisation_id", orgId);
  const existingNormalizedNames = new Set((existingClients || []).map((c) => c.legal_name.trim().toLowerCase()));

  const validatedRows = rows.map((r) => validateRow(r, existingNormalizedNames));
  const counts = validatedRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const importableCount = (counts.valid || 0) + (counts.warning || 0);

  importSection.innerHTML = `
    <div class="import-card">
      <h3>Import Review — "${sheetName}" sheet</h3>
      <div class="kpi-grid" style="margin-bottom:16px;">
        <div class="kpi-card"><div class="kpi-value">${validatedRows.length}</div><div class="kpi-label">Total rows</div></div>
        <div class="kpi-card"><div class="kpi-value">${counts.valid || 0}</div><div class="kpi-label">Valid</div></div>
        <div class="kpi-card"><div class="kpi-value">${counts.warning || 0}</div><div class="kpi-label">Warnings</div></div>
        <div class="kpi-card"><div class="kpi-value">${counts.rejected || 0}</div><div class="kpi-label">Rejected</div></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Row</th><th>Company</th><th>FYE</th><th>Branch</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${validatedRows
            .map(
              (r) => `<tr>
                <td>${r.source_row}</td><td>${r.company_name}</td><td>${r.fye || "-"}</td>
                <td>${r.branch || "-"}</td>
                <td><span class="status-badge status-${r.status}">${r.status}</span></td>
                <td>${r.issues.join("; ") || "-"}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <button id="confirm-import-btn" class="btn-primary" style="width:auto;" ${importableCount === 0 ? "disabled" : ""}>
          Confirm Import (${importableCount} row${importableCount === 1 ? "" : "s"})
        </button>
        <button id="cancel-import-btn" class="btn-link">Cancel</button>
      </div>
      <p id="import-result" class="hint"></p>
    </div>
  `;

  document.getElementById("cancel-import-btn").addEventListener("click", () => { importSection.innerHTML = ""; });

  const confirmBtn = document.getElementById("confirm-import-btn");
  confirmBtn?.addEventListener("click", async () => {
    const resultEl = document.getElementById("import-result");
    const rowsToImport = validatedRows.filter((r) => r.status !== "rejected");
    if (!rowsToImport.length) { resultEl.textContent = "Nothing to import."; return; }

    confirmBtn.disabled = true;
    resultEl.textContent = "Importing...";

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({ organisation_id: orgId, filename: file.name, imported_by: getIdentity().user.id, status: "pending" })
      .select()
      .single();

    if (batchError) {
      resultEl.textContent = "Could not start import: " + batchError.message;
      confirmBtn.disabled = false;
      return;
    }

    const { data, error: importError } = await supabase.rpc("import_completed_rows", {
      import_batch_uuid: batch.id,
      rows_jsonb: rowsToImport,
    });

    if (importError) {
      resultEl.textContent = "Import failed: " + importError.message;
      confirmBtn.disabled = false;
      return;
    }
    resultEl.textContent = `Done — ${data.inserted} row(s) imported, ${data.skipped} skipped.`;
    resetFilters();
    await loadAndRenderTable();
  });
}
