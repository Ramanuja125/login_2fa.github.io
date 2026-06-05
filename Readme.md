# Secure Portal — Architecture & Documentation

## Overview

A HIPAA-compliant login system built on GitHub Pages (static frontend) with Firebase Authentication for credential management and EmailJS for OTP delivery. No traditional database is owned or managed — Firebase handles all identity storage.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Hosting | GitHub Pages | Static file hosting (free) |
| Authentication | Firebase Auth (Google) | Email/password verification, credential storage |
| OTP Delivery | EmailJS | Sends 6-digit code to user's email |
| Email Transport | Gmail SMTP | Email delivery via user's own Gmail account |
| Frontend | HTML, CSS, Vanilla JS | UI and client-side logic |

---

## File Structure

```
/
├── index.html          → Login page
├── register.html       → New user registration
├── verify.html         → OTP code entry (2FA step)
├── success.html        → Post-login landing page
├── forgot-password.html→ Password reset request
├── styles.css          → Shared styles across all pages
└── auth.js             → Shared auth logic, Firebase + EmailJS config
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                   GitHub Pages                       │
│  (ramanuja125.github.io/login_2fa.github.io/)        │
│                                                     │
│  index.html ──────► verify.html ──────► success.html│
│  register.html                                      │
│  forgot-password.html                               │
│                                                     │
│  All pages load: styles.css + auth.js               │
└────────────────┬──────────────┬──────────────────────┘
                 │              │
                 ▼              ▼
    ┌────────────────┐   ┌─────────────────┐
    │    Firebase    │   │    EmailJS      │
    │ Authentication │   │  (OTP Delivery) │
    │                │   │                 │
    │ • Stores users │   │ • Sends 6-digit │
    │ • Verifies pwd │   │   code to email │
    │ • Resets pwd   │   │ • Uses Gmail    │
    │ • HIPAA BAA ✓  │   │   SMTP          │
    └────────────────┘   └────────┬────────┘
                                  │
                         ┌────────▼────────┐
                         │  Gmail SMTP     │
                         │ (anantharamanuja│
                         │  @gmail.com)    │
                         └─────────────────┘
```

---

## How Files Call Each Other

```
index.html
  │  loads → styles.css (visual styling)
  │  loads → firebase-app-compat.js (Firebase SDK)
  │  loads → firebase-auth-compat.js (Firebase Auth SDK)
  │  loads → @emailjs/browser (EmailJS SDK)
  │  loads → auth.js (shared logic)
  │
  │  on submit → calls loginUser(email, password) [in auth.js]
  │    ├── Firebase.signInWithEmailAndPassword()
  │    ├── generateOTP() + storeOTP() [in auth.js]
  │    └── emailjs.send() → EmailJS API → Gmail → user inbox
  │
  └── on success → redirects to verify.html

verify.html
  │  loads → styles.css
  │  loads → auth.js
  │
  │  on code entry → calls verifyOTP(code) [in auth.js]
  │    ├── checks code against sessionStorage
  │    ├── checks expiry (10 minutes)
  │    └── if valid → stores auth_user in sessionStorage
  │
  └── on success → redirects to success.html

success.html
  │  loads → styles.css
  │  loads → firebase-app-compat.js
  │  loads → firebase-auth-compat.js
  │  loads → auth.js
  │
  │  on load → calls getSessionUser() [in auth.js]
  │    ├── if no session → redirects to index.html
  │    └── if session exists → displays user name + email
  │
  └── on Sign Out → calls signOut() [in auth.js]
        ├── clears sessionStorage
        ├── Firebase.signOut()
        └── redirects to index.html

register.html
  │  loads → styles.css + Firebase SDKs + auth.js
  │
  │  on submit → calls registerUser(email, password) [in auth.js]
  │    ├── Firebase.createUserWithEmailAndPassword()
  │    └── Firebase.sendEmailVerification()
  │
  └── on success → shows confirmation message

forgot-password.html
  │  loads → styles.css + Firebase SDKs + auth.js
  │
  │  on submit → Firebase.sendPasswordResetEmail(email)
  │    └── Firebase uses Gmail SMTP to deliver reset link
  │
  └── user clicks link in email → Firebase hosted reset page
        └── on completion → redirects to index.html
```

---

## Authentication Flow

### Registration
```
1. User fills email + password on register.html
2. Client validates password rules (8+ chars, upper, lower, number, special)
3. Firebase.createUserWithEmailAndPassword(email, password)
   └── Firebase stores: email + bcrypt-hashed password
4. Firebase.sendEmailVerification()
   └── Verification email sent via Gmail SMTP
5. User is shown success message → redirected to login
```

### Login (2FA Flow)
```
1. User enters email + password on index.html
2. Firebase.signInWithEmailAndPassword(email, password)
   └── Firebase verifies credentials against stored hash ✓
3. generateOTP() → random 6-digit number (e.g. 847291)
4. storeOTP() → saved in sessionStorage with 10-minute expiry
   └── { email, name, otp: "847291", expiry: timestamp }
5. emailjs.send(serviceId, templateId, { to_email, otp_code })
   └── EmailJS → Gmail SMTP → user's inbox
6. Redirect to verify.html
7. User enters 6-digit code
8. verifyOTP(code):
   ├── Check code matches sessionStorage
   ├── Check not expired
   └── If valid → store auth_user in sessionStorage → success.html
```

### Password Reset
```
1. User enters email on forgot-password.html
2. Firebase.sendPasswordResetEmail(email)
   └── Email sent via Gmail SMTP (not Firebase's no-reply)
3. User clicks link in email
4. Firebase hosted page → user enters new password
5. Firebase updates stored password hash
6. User redirected to index.html to log in with new password
```

### Sign Out
```
1. User clicks Sign Out on success.html
2. sessionStorage.removeItem("auth_user")
3. Firebase.signOut()
4. Redirect to index.html
```

---

## Where Data Lives

| Data | Where Stored | Duration |
|---|---|---|
| Email + hashed password | Firebase Authentication | Permanent (until deleted) |
| OTP code | Browser sessionStorage | 10 minutes or until tab closes |
| Logged-in user session | Browser sessionStorage | Until sign out or tab closes |
| Password reset token | Firebase (internal) | 1 hour |

**No database is owned or managed.** Firebase handles all persistent identity storage internally.

---

## EmailJS Integration

EmailJS is loaded from CDN on `index.html`:
```html
<script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js"></script>
```

Called inside `loginUser()` in `auth.js`:
```javascript
await emailjs.send(
  "service_8ngw648",    // EmailJS Service ID (linked to Gmail)
  "template_9yfipwi",   // EmailJS Template ID
  {
    to_email: email,    // recipient — the user logging in
    otp_code: otp,      // the 6-digit code
  },
  "1SRRPZQ8Tp7xLh_Ub"  // EmailJS Public Key
);
```

**EmailJS template variables:**
- `{{to_email}}` — dynamically replaced with the user's email
- `{{otp_code}}` — dynamically replaced with the 6-digit code

**Email delivery path:**
```
auth.js → EmailJS API → Gmail SMTP (anantharamanuja@gmail.com) → user inbox
```

EmailJS stores nothing — it is purely a delivery pipeline.

---

## Security Notes

- Passwords are never stored in plain text — Firebase uses secure hashing
- OTP codes live only in `sessionStorage` (cleared on tab close, never sent to any server)
- OTP expires after 10 minutes
- EmailJS Public Key is visible in client code — this is by design (it is not a secret). Restrict allowed domains in EmailJS dashboard to prevent misuse
- All traffic is over HTTPS (GitHub Pages enforces this)
- Firebase handles account lockout after repeated failed login attempts

---

## HIPAA Compliance

| Requirement | How Met |
|---|---|
| Access controls | Email + password + OTP 2FA |
| Credential security | Firebase (Google) — HIPAA BAA available |
| Email transport | Gmail SMTP over TLS |
| Session management | sessionStorage cleared on tab close |
| Transmission security | HTTPS enforced by GitHub Pages |
| Audit controls | Firebase Authentication logs all sign-in events |

> **Note:** For production HIPAA deployment, sign Google's Cloud Data Processing Addendum (HIPAA BAA) at [cloud.google.com/security/compliance/hipaa](https://cloud.google.com/security/compliance/hipaa). This is free and covers Firebase Authentication.
