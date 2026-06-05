/* ============================================
   auth.js — MSAL Authentication + Form Helpers
   Microsoft Entra ID (Azure AD)
   ============================================ */

// ─────────────────────────────────────────────
// AZURE CONFIG
// ─────────────────────────────────────────────
const AZURE_CONFIG = {
  clientId:    "58efa254-95c7-46ed-ab93-6e1cc607e16c",
  tenantId:    "8e261532-d7e8-48ae-b5c4-8fea024a915b",
  redirectUri: "https://ramanuja125.github.io/login_2fa.github.io/success.html",
};

// ─────────────────────────────────────────────
// MSAL INSTANCE
// ─────────────────────────────────────────────
let _msalInstance = null;

function getMsalInstance() {
  if (_msalInstance) return _msalInstance;

  const msalConfig = {
    auth: {
      clientId:    AZURE_CONFIG.clientId,
      authority:   `https://login.microsoftonline.com/${AZURE_CONFIG.tenantId}`,
      redirectUri: AZURE_CONFIG.redirectUri,
    },
    cache: {
      cacheLocation:          "sessionStorage",
      storeAuthStateInCookie: false,
    },
  };

  // "msal" is the global from alcdn.msauth.net (MSAL v2)
  _msalInstance = new msal.PublicClientApplication(msalConfig);
  return _msalInstance;
}

// ─────────────────────────────────────────────
// AUTH ACTIONS
// ─────────────────────────────────────────────

// Sign in — redirects to Microsoft login page
async function signIn() {
  const instance = getMsalInstance();
  await instance.loginRedirect({
    scopes: ["User.Read", "openid", "profile", "email"],
  });
}

// Sign up — opens Microsoft account creation flow
async function signUp() {
  const instance = getMsalInstance();
  await instance.loginRedirect({
    scopes: ["User.Read", "openid", "profile", "email"],
    prompt: "create",
  });
}

// Handle redirect callback on success.html
// Returns the user object if login was successful, null otherwise
async function handleRedirectAndGetUser() {
  const instance = getMsalInstance();

  try {
    const response = await instance.handleRedirectPromise();

    if (response && response.account) {
      const user = {
        name:  response.account.name     || response.account.username,
        email: response.account.username || "",
      };
      sessionStorage.setItem("auth_user", JSON.stringify(user));
      return user;
    }

    // Already authenticated (page reload)
    const accounts = instance.getAllAccounts();
    if (accounts.length > 0) {
      const user = {
        name:  accounts[0].name     || accounts[0].username,
        email: accounts[0].username || "",
      };
      sessionStorage.setItem("auth_user", JSON.stringify(user));
      return user;
    }

    return null;
  } catch (error) {
    console.error("MSAL redirect error:", error);
    return null;
  }
}

// Sign out
async function signOut() {
  sessionStorage.removeItem("auth_user");
  try {
    const instance = getMsalInstance();
    const accounts = instance.getAllAccounts();
    await instance.logoutRedirect({
      account:               accounts[0] || null,
      postLogoutRedirectUri: "https://ramanuja125.github.io/login_2fa.github.io/index.html",
    });
  } catch (e) {
    window.location.href = "index.html";
  }
}

// ─────────────────────────────────────────────
// SESSION HELPERS
// ─────────────────────────────────────────────
function getSessionUser() {
  const raw = sessionStorage.getItem("auth_user");
  return raw ? JSON.parse(raw) : null;
}

function requireAuth() {
  if (!getSessionUser()) window.location.href = "index.html";
}

// ─────────────────────────────────────────────
// PASSWORD VALIDATION
// ─────────────────────────────────────────────
const PWD_RULES = {
  length:    { test: v => v.length >= 8,           label: "8+ characters"     },
  uppercase: { test: v => /[A-Z]/.test(v),         label: "Uppercase letter"  },
  lowercase: { test: v => /[a-z]/.test(v),         label: "Lowercase letter"  },
  number:    { test: v => /[0-9]/.test(v),         label: "Number"            },
  special:   { test: v => /[^A-Za-z0-9]/.test(v), label: "Special character" },
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
// OTP INPUT HELPERS (verify.html)
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
      pasted.split("").forEach((ch, idx) => { if (inputs[idx]) inputs[idx].value = ch; });
      inputs[Math.min(pasted.length, inputs.length - 1)].focus();
      checkOtpComplete(inputs);
    });
  });
}

function getOtpValue() {
  return Array.from(document.querySelectorAll(".otp-group input")).map(i => i.value).join("");
}

function checkOtpComplete(inputs) {
  const complete = Array.from(inputs).every(i => i.value.length === 1);
  const btn = document.getElementById("verify-btn");
  if (btn) btn.disabled = !complete;
}
