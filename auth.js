// assets/js/settings.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";

export async function renderSettings(el) {
  el.innerHTML = `
    <div class="page-header"><h1>Firm Settings</h1></div>
    <div class="import-card">
      <h3>Firm Profile</h3>
      <p class="hint">Your firm name and logo appear on the workspace spotlight board that everyone sees.</p>
      <label style="display:block;max-width:360px;margin-bottom:16px;">Firm Name
        <input type="text" id="firm-name-input" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
      </label>
      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        <div>
          <p class="option-label">Firm Logo</p>
          <div id="logo-preview" class="asset-preview"></div>
          <input type="file" id="logo-file-input" accept="image/*" class="hidden" />
          <button id="logo-upload-btn" class="btn-secondary" style="margin-top:8px;">Upload Logo</button>
        </div>
      </div>
      <button id="save-firm-name-btn" class="btn-dark" style="margin-top:16px;">Save Firm Name</button>
      <p id="firm-profile-error" class="form-error hidden"></p>
    </div>

    <div class="import-card">
      <h3>Virtual Workspace Background</h3>
      <p class="hint">Upload a photo of your actual office (or any background you like) to use in the Virtual Workspace instead of the default layout. Avatars and the AI Assistant will appear on top of it.</p>
      <div id="bg-preview" class="asset-preview" style="width:100%;max-width:480px;height:160px;"></div>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <input type="file" id="bg-file-input" accept="image/*" class="hidden" />
        <button id="bg-upload-btn" class="btn-secondary">Upload Background</button>
        <button id="bg-reset-btn" class="btn-secondary">Reset to Default</button>
      </div>
      <p id="bg-error" class="form-error hidden"></p>
    </div>

    <div class="import-card">
      <h3>Announcement Banner</h3>
      <p class="hint">Shown at the top of the app for everyone in your firm. Leave blank to hide it.</p>
      <input type="text" id="announcement-input" placeholder="e.g. Office closed for Hari Raya on 31 Mar" style="width:100%;max-width:480px;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
      <div style="display:flex;gap:10px;margin-top:10px;">
        <button id="announcement-save-btn" class="btn-dark">Save Announcement</button>
        <button id="announcement-clear-btn" class="btn-secondary">Clear</button>
      </div>
      <p id="announcement-error" class="form-error hidden"></p>
    </div>

    <div class="import-card">
      <h3>Independence Declaration Template</h3>
      <p class="hint">Upload a PDF with fillable form fields named <code>staff_name</code>, <code>designation</code>, <code>year</code>, and <code>date</code> — ISQM uses this to generate a prefilled copy per staff member each year. Any field it doesn't find is simply left blank.</p>
      <p id="template-status" class="hint"></p>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <input type="file" id="template-file-input" accept="application/pdf" class="hidden" />
        <button id="template-upload-btn" class="btn-secondary">Upload Template</button>
      </div>
      <p id="template-error" class="form-error hidden"></p>
    </div>
  `;

  const identity = getIdentity();
  const orgId = identity.organisationId;

  const [{ data: org }, { data: orgSettings }] = await Promise.all([
    supabase.from("organisations").select("id, name").eq("id", orgId).single(),
    supabase.from("organisation_settings").select("logo_url, workspace_background_url, independence_template_url, announcement_text").eq("organisation_id", orgId).maybeSingle(),
  ]);

  document.getElementById("firm-name-input").value = org?.name || "";
  renderAssetPreview("logo-preview", orgSettings?.logo_url, "Logo");
  renderAssetPreview("bg-preview", orgSettings?.workspace_background_url, "Background");
  document.getElementById("announcement-input").value = orgSettings?.announcement_text || "";
  document.getElementById("template-status").textContent = orgSettings?.independence_template_url
    ? "A template is currently uploaded."
    : "No template uploaded yet.";

  document.getElementById("save-firm-name-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("firm-profile-error");
    const { error } = await supabase.from("organisations").update({ name: document.getElementById("firm-name-input").value.trim() }).eq("id", orgId);
    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
  });

  document.getElementById("announcement-save-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("announcement-error");
    const text = document.getElementById("announcement-input").value.trim();
    const { error } = await supabase.from("organisation_settings").update({ announcement_text: text || null }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
    updateLiveBanner(text);
  });

  document.getElementById("announcement-clear-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("announcement-error");
    document.getElementById("announcement-input").value = "";
    const { error } = await supabase.from("organisation_settings").update({ announcement_text: null }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not clear: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
    updateLiveBanner("");
  });

  const logoInput = document.getElementById("logo-file-input");
  document.getElementById("logo-upload-btn").addEventListener("click", () => logoInput.click());
  logoInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadFirmAsset(file, "logo", "logo_url", "logo-preview", "firm-profile-error");
    logoInput.value = "";
  });

  const bgInput = document.getElementById("bg-file-input");
  document.getElementById("bg-upload-btn").addEventListener("click", () => bgInput.click());
  bgInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadFirmAsset(file, "workspace-bg", "workspace_background_url", "bg-preview", "bg-error");
    bgInput.value = "";
  });

  document.getElementById("bg-reset-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("bg-error");
    const { error } = await supabase.from("organisation_settings").update({ workspace_background_url: null }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not reset: " + error.message; errorEl.classList.remove("hidden"); return; }
    renderAssetPreview("bg-preview", null, "Background");
    errorEl.classList.add("hidden");
  });

  const templateInput = document.getElementById("template-file-input");
  document.getElementById("template-upload-btn").addEventListener("click", () => templateInput.click());
  templateInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const errorEl = document.getElementById("template-error");
    errorEl.classList.add("hidden");

    const path = `${orgId}/independence-template.pdf`;
    const { error: uploadError } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
    if (uploadError) {
      errorEl.textContent = "Could not upload: " + uploadError.message;
      errorEl.classList.remove("hidden");
      return;
    }

    const { data: urlData } = supabase.storage.from("firm-assets").getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const { error: dbError } = await supabase.from("organisation_settings").update({ independence_template_url: publicUrl }).eq("organisation_id", orgId);
    if (dbError) {
      errorEl.textContent = "Uploaded, but could not save reference: " + dbError.message;
      errorEl.classList.remove("hidden");
      return;
    }

    document.getElementById("template-status").textContent = "A template is currently uploaded.";
    templateInput.value = "";
  });
}

function renderAssetPreview(elementId, url, label) {
  const el = document.getElementById(elementId);
  el.innerHTML = url ? `<img src="${url}" alt="${label}" />` : `<span class="hint">No ${label.toLowerCase()} set</span>`;
}

async function uploadFirmAsset(file, filenamePrefix, dbColumn, previewElId, errorElId) {
  const identity = getIdentity();
  const orgId = identity.organisationId;
  const errorEl = document.getElementById(errorElId);
  errorEl.classList.add("hidden");

  const ext = file.name.split(".").pop();
  const path = `${orgId}/${filenamePrefix}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
  if (uploadError) {
    errorEl.textContent = "Could not upload: " + uploadError.message;
    errorEl.classList.remove("hidden");
    return;
  }

  const { data: urlData } = supabase.storage.from("firm-assets").getPublicUrl(path);
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`; // cache-bust so updates show immediately

  const { error: dbError } = await supabase
    .from("organisation_settings")
    .update({ [dbColumn]: publicUrl })
    .eq("organisation_id", orgId);

  if (dbError) {
    errorEl.textContent = "Uploaded, but could not save reference: " + dbError.message;
    errorEl.classList.remove("hidden");
    return;
  }

  renderAssetPreview(previewElId, publicUrl, filenamePrefix === "logo" ? "Logo" : "Background");
}

function updateLiveBanner(text) {
  const banner = document.getElementById("announcement-banner");
  if (!banner) return;
  if (text) {
    banner.textContent = text;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}
