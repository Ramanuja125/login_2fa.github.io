/* ============================================
   auth.js — Firebase Authentication + Form Helpers
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

// Where Firebase redirects after the email link is clicked
const EMAIL_LINK_REDIRECT = "https://ramanuja125.github.io/login_2fa.github.io/success.html";

// ─────────────────────────────────────────────
// FIREBASE INIT (called once after SDK loads)
// ─────────────────────────────────────────────
let _auth = null;

function getAuth() {
  if (_auth) return _auth;
  firebase.initializeApp(FIREBASE_CONFIG);
  _auth = firebase.auth();
  return _auth;
}

// ─────────────────────────────────────────────
// REGISTER — email + password
// ─────────────────────────────────────────────
async function registerUser(email, password) {
  const auth = getAuth();
  const credential = await auth.createUserWithEmailAndPassword(email, password);
  // Send a verification email so user confirms ownership
  await credential.user.sendEmailVerification();
  return credential.user;
}

// ─────────────────────────────────────────────
// LOGIN — password check → then email link 2FA
// ─────────────────────────────────────────────
async function loginUser(email, password) {
  const auth = getAuth();

  // Step 1: verify password
  await auth.signInWithEmailAndPassword(email, password);

  // Step 2: immediately sign out — user is not fully logged in until email link
  await auth.signOut();

  // Step 3: send 2FA email link
  await auth.sendSignInLinkToEmail(email, {
    url:              EMAIL_LINK_REDIRECT,
    handleCodeInApp:  true,
  });

  // Save email so success.html can complete the sign-in
  localStorage.setItem("emailForSignIn", email);
}

// ─────────────────────────────────────────────
// COMPLETE SIGN-IN from email link (runs on success.html)
// ─────────────────────────────────────────────
async function completeEmailLinkSignIn() {
  const auth = getAuth();
  const url  = window.location.href;

  if (!auth.isSignInWithEmailLink(url)) return null;

  let email = localStorage.getItem("emailForSignIn");

  // If user opened the link on a different device, ask for email
  if (!email) {
    email = window.prompt("Please enter your email to confirm sign-in:");
    if (!email) return null;
  }

  const result = await auth.signInWithEmailLink(email, url);
  localStorage.removeItem("emailForSignIn");

  const user = {
    name:  result.user.displayName || email.split("@")[0],
    email: result.user.email,
  };
  sessionStorage.setItem("auth_user", JSON.stringify(user));
  return user;
}

// ─────────────────────────────────────────────
// SIGN OUT
// ─────────────────────────────────────────────
async function signOut() {
  sessionStorage.removeItem("auth_user");
  try {
    await getAuth().signOut();
  } catch (e) { /* ignore */ }
  window.location.href = "index.html";
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
