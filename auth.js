/* ============================================
   auth.js — Client-side validation + Azure MSAL stubs
   Azure AD B2C connection goes in the CONFIG block below
   ============================================ */

// ─────────────────────────────────────────────
// AZURE AD B2C CONFIG (fill in after Azure setup)
// ─────────────────────────────────────────────
const AZURE_CONFIG = {
  clientId:    "YOUR_CLIENT_ID",          // Azure App Registration → Application (client) ID
  tenantName:  "YOUR_TENANT_NAME",        // e.g. "myapp" from myapp.onmicrosoft.com
  policySignIn:    "B2C_1_SignInSignUp",  // User flow name in Azure
  policySignUp:    "B2C_1_SignInSignUp",
  redirectUri: window.location.origin + "/success.html",
};

// ─────────────────────────────────────────────
// PASSWORD VALIDATION
// ─────────────────────────────────────────────
const PWD_RULES = {
  length:    { test: v => v.length >= 8,            label: "8+ characters"       },
  uppercase: { test: v => /[A-Z]/.test(v),          label: "Uppercase letter"    },
  lowercase: { test: v => /[a-z]/.test(v),          label: "Lowercase letter"    },
  number:    { test: v => /[0-9]/.test(v),          label: "Number"              },
  special:   { test: v => /[^A-Za-z0-9]/.test(v),  label: "Special character"   },
};

function validatePassword(password) {
  const results = {};
  for (const [key, rule] of Object.entries(PWD_RULES)) {
    results[key] = rule.test(password);
  }
  return results;
}

function isPasswordValid(password) {
  return Object.values(validatePassword(password)).every(Boolean);
}

// Update the live password rule checklist in register.html
function updatePwdChecklist(password) {
  const results = validatePassword(password);
  for (const [key, passed] of Object.entries(results)) {
    const el = document.getElementById("rule-" + key);
    if (el) el.classList.toggle("pass", passed);
  }
}

// ─────────────────────────────────────────────
// FORM HELPERS
// ─────────────────────────────────────────────
function showError(inputEl, message) {
  inputEl.classList.add("error");
  const err = inputEl.parentElement.querySelector(".field-error");
  if (err) { err.textContent = message; err.classList.add("visible"); }
}

function clearError(inputEl) {
  inputEl.classList.remove("error");
  const err = inputEl.parentElement.querySelector(".field-error");
  if (err) err.classList.remove("visible");
}

function showAlert(id, message) {
  const el = document.getElementById(id);
  if (el) { el.textContent = message; el.classList.add("visible"); }
}

function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("visible");
}

// ─────────────────────────────────────────────
// OTP INPUT AUTO-ADVANCE
// ─────────────────────────────────────────────
function initOtpInputs() {
  const inputs = document.querySelectorAll(".otp-group input");
  inputs.forEach((input, i) => {
    input.addEventListener("input", e => {
      const val = e.target.value.replace(/\D/g, "").slice(-1);
      e.target.value = val;
      if (val && i < inputs.length - 1) inputs[i + 1].focus();
      checkOtpComplete(inputs);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !input.value && i > 0) inputs[i - 1].focus();
    });
    input.addEventListener("paste", e => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
      pasted.split("").forEach((ch, idx) => {
        if (inputs[idx]) inputs[idx].value = ch;
      });
      const next = Math.min(pasted.length, inputs.length - 1);
      inputs[next].focus();
      checkOtpComplete(inputs);
    });
  });
}

function getOtpValue() {
  return Array.from(document.querySelectorAll(".otp-group input"))
              .map(i => i.value).join("");
}

function checkOtpComplete(inputs) {
  const complete = Array.from(inputs).every(i => i.value.length === 1);
  const btn = document.getElementById("verify-btn");
  if (btn) btn.disabled = !complete;
}

// ─────────────────────────────────────────────
// AZURE AD B2C — STUBS (wired up in next phase)
// ─────────────────────────────────────────────

// Called after successful Azure login — receives the ID token claims
function onLoginSuccess(account) {
  // account.name, account.username available here
  sessionStorage.setItem("auth_user", JSON.stringify({
    name:  account.name  || "User",
    email: account.username || "",
  }));
  window.location.href = "success.html";
}

// Called on logout
function onLogout() {
  sessionStorage.removeItem("auth_user");
  window.location.href = "index.html";
}

// Retrieve logged-in user from session (used by success.html)
function getSessionUser() {
  const raw = sessionStorage.getItem("auth_user");
  return raw ? JSON.parse(raw) : null;
}

// Guard — redirect to login if no session (call on protected pages)
function requireAuth() {
  if (!getSessionUser()) window.location.href = "index.html";
}
