// assets/js/users.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
const KEY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>`;

const inputStyle = "width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;";
const labelStyle = "display:block;margin-bottom:14px;";

// supabase-js's functions.invoke() gives a generic "non-2xx status code"
// message on failure by default — the actual error text our function sent
// back is on error.context (the raw Response), and has to be read separately.
async function extractFunctionError(error, fallbackData) {
  if (fallbackData?.error) return fallbackData.error;
  if (error?.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // context wasn't JSON — fall through to the generic message
    }
  }
  return error?.message || "Unknown error";
}

export async function renderUsers(el) {
  el.innerHTML = `
    <div class="page-header">
      <h1>User Management</h1>
      <div class="page-actions">
        <button id="add-user-btn" class="btn-dark">+ Add User</button>
      </div>
    </div>
    <div id="users-table-wrap" class="import-card">Loading...</div>
  `;

  document.getElementById("add-user-btn").addEventListener("click", () => openAddUserModal());

  await loadAndRenderUsers();
}

async function loadAndRenderUsers() {
  const orgId = getIdentity()?.organisationId;
  const wrap = document.getElementById("users-table-wrap");

  const { data, error } = await supabase
    .from("organisation_members")
    .select("user_id, role, status, is_working_staff, profiles(display_name, email, designation)")
    .eq("organisation_id", orgId)
    .order("role");

  if (error) {
    wrap.innerHTML = `<div class="empty-state">Could not load users.</div>`;
    return;
  }
  if (!data.length) {
    wrap.innerHTML = `<div class="empty-state">No users yet.</div>`;
    return;
  }

  const selfId = getIdentity()?.user?.id;

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Name</th><th>Email</th><th>Designation</th><th>Role</th><th>Working Staff</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${data
          .map((m) => {
            const isSelf = m.user_id === selfId;
            return `<tr>
              <td><strong>${m.profiles?.display_name || "-"}</strong>${isSelf ? ' <span class="hint">(you)</span>' : ""}</td>
              <td>${m.profiles?.email || "-"}</td>
              <td>${m.profiles?.designation || "-"}</td>
              <td><span class="status-badge ${m.role === "firm_admin" ? "status-completed" : "status-quotation"}">${m.role === "firm_admin" ? "Firm Admin" : "Staff"}</span></td>
              <td>${m.is_working_staff ? `<span class="status-badge status-completed">Yes</span>` : `<span class="status-badge status-wip">No</span>`}</td>
              <td><span class="status-badge ${m.status === "active" ? "status-completed" : "status-rejected"}">${m.status === "active" ? "Active" : "Inactive"}</span></td>
              <td class="row-actions">
                <button class="icon-btn icon-btn-edit" data-edit="${m.user_id}" title="Edit">${EDIT_ICON}</button>
                <button class="icon-btn icon-btn-edit" data-reset="${m.user_id}" title="Reset Password">${KEY_ICON}</button>
                ${isSelf ? "" : `<button class="icon-btn icon-btn-delete" data-delete="${m.user_id}" data-name="${m.profiles?.display_name || m.profiles?.email}" title="Delete">${DELETE_ICON}</button>`}
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;

  const byId = Object.fromEntries(data.map((m) => [m.user_id, m]));

  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditUserModal(byId[btn.dataset.edit]));
  });
  wrap.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => openResetPasswordModal(byId[btn.dataset.reset]));
  });
  wrap.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => confirmDeleteUser(btn.dataset.delete, btn.dataset.name));
  });
}

function buildModal({ title, subtitle, bodyHtml, submitLabel }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${title}</h2>
          <p class="modal-subtitle">${subtitle}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="modal-form">
        ${bodyHtml}
        <p id="modal-error" class="form-error hidden"></p>
        <div class="modal-actions">
          <button type="button" id="modal-cancel-btn" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">${submitLabel}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#modal-cancel-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  return { backdrop, close };
}

function openAddUserModal() {
  const { close } = buildModal({
    title: "Add User",
    subtitle: "Set an initial password — they'll be asked to change it on first login.",
    submitLabel: "Add User",
    bodyHtml: `
      <label style="${labelStyle}">Name
        <input type="text" id="au-name" required style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Email
        <input type="email" id="au-email" required style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Designation
        <input type="text" id="au-designation" placeholder="e.g. Audit Senior" style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Role
        <select id="au-role" style="${inputStyle}">
          <option value="staff">Staff</option>
          <option value="firm_admin">Firm Admin</option>
        </select>
      </label>
      <label style="${labelStyle}">Password
        <input type="text" id="au-password" required minlength="8" placeholder="At least 8 characters" style="${inputStyle}" />
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:4px;">
        <input type="checkbox" id="au-working-staff" checked style="width:auto;" /> Working Staff
      </label>
      <p class="hint" style="margin-top:0;">Uncheck this for admin-only accounts that don't do client work — they'll be left out of staff reports (Work Orders by Staff, Budget Fee by Staff, ISQM staff list, etc).</p>
    `,
  });

  document.getElementById("modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const orgId = getIdentity()?.organisationId;
    const errorEl = document.getElementById("modal-error");
    const submitBtn = e.target.querySelector("button[type=submit]");

    const payload = {
      email: document.getElementById("au-email").value.trim(),
      display_name: document.getElementById("au-name").value.trim(),
      designation: document.getElementById("au-designation").value.trim(),
      role: document.getElementById("au-role").value,
      password: document.getElementById("au-password").value,
      organisation_id: orgId,
      is_working_staff: document.getElementById("au-working-staff").checked,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Adding...";

    const { data, error } = await supabase.functions.invoke("create-user", { body: payload });

    if (error || data?.error) {
      errorEl.textContent = "Could not add user: " + (await extractFunctionError(error, data));
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Add User";
      return;
    }

    close();
    await loadAndRenderUsers();
  });
}

function openEditUserModal(member) {
  const { close } = buildModal({
    title: "Edit User",
    subtitle: `Update ${member.profiles?.display_name || member.profiles?.email}'s details.`,
    submitLabel: "Save Changes",
    bodyHtml: `
      <label style="${labelStyle}">Name
        <input type="text" id="eu-name" required value="${member.profiles?.display_name ?? ""}" style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Designation
        <input type="text" id="eu-designation" value="${member.profiles?.designation ?? ""}" style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Role
        <select id="eu-role" style="${inputStyle}">
          <option value="staff" ${member.role === "staff" ? "selected" : ""}>Staff</option>
          <option value="firm_admin" ${member.role === "firm_admin" ? "selected" : ""}>Firm Admin</option>
        </select>
      </label>
      <label style="${labelStyle}">Status
        <select id="eu-status" style="${inputStyle}">
          <option value="active" ${member.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${member.status === "inactive" ? "selected" : ""}>Inactive</option>
        </select>
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:4px;">
        <input type="checkbox" id="eu-working-staff" ${member.is_working_staff ? "checked" : ""} style="width:auto;" /> Working Staff
      </label>
      <p class="hint" style="margin-top:0;">Uncheck this for admin-only accounts that don't do client work — they'll be left out of staff reports (Work Orders by Staff, Budget Fee by Staff, ISQM staff list, etc).</p>
    `,
  });

  document.getElementById("modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const orgId = getIdentity()?.organisationId;
    const errorEl = document.getElementById("modal-error");

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        display_name: document.getElementById("eu-name").value.trim(),
        designation: document.getElementById("eu-designation").value.trim() || null,
      })
      .eq("id", member.user_id);

    const { error: memberError } = await supabase
      .from("organisation_members")
      .update({
        role: document.getElementById("eu-role").value,
        status: document.getElementById("eu-status").value,
        is_working_staff: document.getElementById("eu-working-staff").checked,
      })
      .eq("user_id", member.user_id)
      .eq("organisation_id", orgId);

    if (profileError || memberError) {
      errorEl.textContent = "Could not save: " + (profileError?.message || memberError?.message);
      errorEl.classList.remove("hidden");
      return;
    }

    close();
    await loadAndRenderUsers();
  });
}

function openResetPasswordModal(member) {
  const { close } = buildModal({
    title: "Reset Password",
    subtitle: `Set a new temporary password for ${member.profiles?.display_name || member.profiles?.email}. They'll be asked to change it on next login.`,
    submitLabel: "Reset Password",
    bodyHtml: `
      <label style="${labelStyle}">New Password
        <input type="text" id="rp-password" required minlength="8" placeholder="At least 8 characters" style="${inputStyle}" />
      </label>
    `,
  });

  document.getElementById("modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const orgId = getIdentity()?.organisationId;
    const errorEl = document.getElementById("modal-error");
    const submitBtn = e.target.querySelector("button[type=submit]");

    submitBtn.disabled = true;
    submitBtn.textContent = "Resetting...";

    const { data, error } = await supabase.functions.invoke("reset-user-password", {
      body: { organisation_id: orgId, user_id: member.user_id, new_password: document.getElementById("rp-password").value },
    });

    if (error || data?.error) {
      errorEl.textContent = "Could not reset password: " + (await extractFunctionError(error, data));
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Reset Password";
      return;
    }

    close();
  });
}

async function confirmDeleteUser(userId, name) {
  if (!confirm(`Delete ${name}? This permanently removes their account and cannot be undone.`)) return;

  const orgId = getIdentity()?.organisationId;
  const { data, error } = await supabase.functions.invoke("delete-user", {
    body: { organisation_id: orgId, user_id: userId },
  });

  if (error || data?.error) {
    alert("Could not delete user: " + (await extractFunctionError(error, data)));
    return;
  }

  await loadAndRenderUsers();
}
