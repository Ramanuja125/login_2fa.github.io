/* ============================================
   auth.js — Firebase Auth + EmailJS OTP
   ============================================ */

// ─────────────────────────────────────────────
// FIREBASE CONFIG
// ─────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCgYDRYO3Wwhbua6nnKn66UZkkfZrdB7-c",
  authDomain:        "hipaa-877ca.firebaseapp.com",
  projectId:         "hipaa-877ca",
  storageBucket:     "hipaa-877ca.firebasestorage.app",
  messagingSenderId: "1037521256169",
  appId:             "1:1037521256169:web:d91f776d182ff29cfb3a78",
};

// ─────────────────────────────────────────────
// EMAILJS CONFIG
// ─────────────────────────────────────────────
const EMAILJS_SERVICE_ID  = "service_xkqj0hk";
const EMAILJS_TEMPLATE_ID = "template_itledcu";
const EMAILJS_PUBLIC_KEY  = "b44XRc1OzkR_E985i";

// ─────────────────────────────────────────────
// FIREBASE INIT
// ─────────────────────────────────────────────
let _auth = null;

function getAuth() {
  if (_auth) return _auth;
  firebase.initializeApp(FIREBASE_CONFIG);
  _auth = firebase.auth();
  return _auth;
}

// ─────────────────────────────────────────────
// OTP HELPERS
// ─────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeOTP(email, name, otp) {
  sessionStorage.setItem("otp_data", JSON.stringify({
    email,
    name,
    otp,
    expiry: Date.now() + 10 * 60 * 1000, // 10 minutes
  }));
}

function verifyOTP(entered) {
  const raw = sessionStorage.getItem("otp_data");
  if (!raw) return { valid: false, message: "Session expired. Please sign in again." };

  const data = JSON.parse(raw);

  if (Date.now() > data.expiry) {
    sessionStorage.removeItem("otp_data");
    getAuth().signOut();
    return { valid: false, message: "Code expired. Please sign in again." };
  }

  if (entered !== data.otp) {
    return { valid: false, message: "Incorrect code. Please try again." };
  }

  // Valid — promote to full session (localStorage = shared across tabs)
  localStorage.setItem("auth_user", JSON.stringify({
    name:  data.name,
    email: data.email,
  }));
  sessionStorage.removeItem("otp_data");
  return { valid: true };
}

// ─────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────
async function registerUser(email, password) {
  const auth = getAuth();
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.sendEmailVerification();
  return cred.user;
}

// ─────────────────────────────────────────────
// LOGIN — password check → OTP via EmailJS
// ─────────────────────────────────────────────
async function loginUser(email, password) {
  const auth = getAuth();

  // Step 1: verify password with Firebase
  const cred = await auth.signInWithEmailAndPassword(email, password);
  const name = cred.user.displayName || email.split("@")[0];

  // Step 2: generate OTP and store temporarily
  const otp = generateOTP();
  storeOTP(email, name, otp);

  // Step 3: send OTP via EmailJS
  await emailjs.send(
    EMAILJS_SERVICE_ID,
    EMAILJS_TEMPLATE_ID,
    { to_email: email, otp_code: otp },
    EMAILJS_PUBLIC_KEY
  );

  // User stays signed in to Firebase — if OTP fails we sign out on verify page
}

// ─────────────────────────────────────────────
// SIGN OUT
// ─────────────────────────────────────────────
async function signOut() {
  localStorage.removeItem("auth_user");
  localStorage.removeItem("open_tabs");
  sessionStorage.removeItem("otp_data");
  sessionStorage.removeItem("tab_id");
  try { await getAuth().signOut(); } catch (e) { /* ignore */ }
  window.location.href = "index.html";
}

// ─────────────────────────────────────────────
// SESSION HELPERS
// ─────────────────────────────────────────────
function getSessionUser() {
  const raw = localStorage.getItem("auth_user");
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
// OTP INPUT AUTO-ADVANCE (verify.html)
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

// ─────────────────────────────────────────────
// TAB SESSION TRACKER
// Keeps auth_user in localStorage (shared across tabs).
// Clears it automatically when the last tab closes.
// ─────────────────────────────────────────────
(function initTabSession() {
  // Give this tab a unique ID
  const tabId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  sessionStorage.setItem("tab_id", tabId);

  // Register tab
  const tabs = JSON.parse(localStorage.getItem("open_tabs") || "[]");
  tabs.push(tabId);
  localStorage.setItem("open_tabs", JSON.stringify(tabs));

  // Deregister on close — if last tab, wipe the session
  window.addEventListener("beforeunload", function () {
    let remaining = JSON.parse(localStorage.getItem("open_tabs") || "[]")
      .filter(function (id) { return id !== tabId; });
    if (remaining.length === 0) {
      localStorage.removeItem("auth_user");
      localStorage.removeItem("open_tabs");
    } else {
      localStorage.setItem("open_tabs", JSON.stringify(remaining));
    }
  });
})();
