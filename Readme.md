# Secure Portal — Architecture & Documentation

## Overview

A HIPAA-compliant login system built on GitHub Pages (static frontend) with Firebase Authentication for credential management and EmailJS for OTP delivery. After login, users can upload files directly to AWS S3 via pre-signed URLs — AWS credentials are never exposed to the browser.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Hosting | GitHub Pages | Static file hosting (free) |
| Authentication | Firebase Auth (Google) | Email/password verification, credential storage |
| OTP Delivery | EmailJS | Sends 6-digit code to user's email |
| Email Transport | Gmail SMTP | Email delivery via user's own Gmail account |
| File upload backend | AWS Lambda (Python 3.12) | Generates pre-signed S3 POST URLs |
| API layer | AWS API Gateway (HTTP API) | HTTPS endpoint that triggers Lambda |
| File storage | AWS S3 | Stores uploaded files |
| Frontend | HTML, CSS, Vanilla JS | UI and client-side logic |

---

## File Structure

```
/
├── index.html              → Login page
├── register.html           → New user registration
├── verify.html             → OTP code entry (2FA step) → redirects to upload.html
├── upload.html             → Post-login file upload page (multi-file, drag-and-drop)
├── forgot-password.html    → Password reset
├── styles.css              → Shared styles across all pages
├── auth.js                 → Shared auth logic (Firebase + EmailJS)
├── lambda_function.py      → AWS Lambda — generates pre-signed S3 POST URLs
├── cors_policy.json        → S3 bucket CORS configuration
├── iam_policy.json         → IAM inline policy for Lambda execution role
└── AWS_SETUP_GUIDE.md      → Step-by-step AWS infrastructure setup guide
```

---

## Full Architecture

```
                    ┌──────────────────────────────────────┐
                    │           GitHub Pages               │
                    │        kanikayears.com               │
                    │                                      │
                    │  index.html → verify.html            │
                    │                    │                 │
                    │                    ▼                 │
                    │             upload.html              │
                    └──────┬───────────────┬──────────────┘
                           │               │
         ┌─────────────────▼──┐   ┌────────▼──────────────────┐
         │  Firebase + EmailJS│   │  AWS API Gateway           │
         │  (Auth + OTP)      │   │  POST /get-upload-url      │
         └────────────────────┘   └────────┬──────────────────┘
                                           │
                                  ┌────────▼──────────────────┐
                                  │  AWS Lambda               │
                                  │  (Python 3.12)            │
                                  │  generate_presigned_post  │
                                  └────────┬──────────────────┘
                                           │
                             ┌─────────────▼─────────────────┐
                             │  AWS S3                        │
                             │  emr-lab-bucket-...-us-east-2  │
                             │  (files land in bucket root)   │
                             └────────────────────────────────┘
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
5. User shown success message → redirected to login
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
   └── If valid → store auth_user in sessionStorage → upload.html
```

### Password Reset
```
1. User enters email on forgot-password.html
2. Firebase.sendPasswordResetEmail(email)
   └── Email sent via Gmail SMTP
3. User clicks link in email → Firebase hosted reset page
4. Firebase updates stored password hash
5. User redirected to index.html
```

### Sign Out
```
1. User clicks Sign Out on upload.html
2. sessionStorage.removeItem("auth_user")
3. Firebase.signOut()
4. Redirect to index.html
```

---

## S3 File Upload

After passing 2FA, users land on `upload.html` where they can upload one or more files directly to S3.

### How the Upload Works

The browser never holds your AWS credentials. Instead it uses a **pre-signed POST URL** — a temporary, single-use S3 upload permission generated by Lambda.

```
Browser                  API Gateway      Lambda           S3
  │                           │              │              │
  │─ POST /get-upload-url ───►│              │              │
  │  { filename: "file.pdf" } │              │              │
  │                           │─ invoke ────►│              │
  │                           │              │─ presigned ─►│
  │                           │              │  POST URL    │
  │                           │◄─ response ──│              │
  │◄─ { upload_url, fields } ─│              │              │
  │                           │              │              │
  │─ POST upload_url ──────────────────────────────────────►│
  │  (FormData: fields + file)                              │
  │◄─ 204 No Content ───────────────────────────────────────│
```

### Why Pre-Signed POST (not PUT)

The Lambda uses `generate_presigned_post` rather than `generate_presigned_url("put_object")`. This matters because:

- Lambda runs with **temporary IAM credentials** (STS — access keys starting with `ASIA`). These require SigV4 signatures.
- boto3 has a known bug where `generate_presigned_url("put_object")` generates a `GET` canonical request instead of `PUT` with temporary credentials, causing `SignatureDoesNotMatch` errors on S3.
- `generate_presigned_post` generates HTTP POST + multipart form, which is specifically designed for direct browser-to-S3 uploads and works correctly with STS credentials.

### Virtual-Hosted S3 URLs

The Lambda sets `addressing_style: "virtual"` in the boto3 config:

```python
s3 = boto3.client(
    "s3",
    region_name=BUCKET_REGION,
    config=Config(s3={"addressing_style": "virtual"}),
)
```

This forces the URL format to `bucket-name.s3.region.amazonaws.com/key`. Without it, boto3 defaults to the deprecated path-style format (`s3.region.amazonaws.com/bucket/key`), which S3 responds to with a `301 PermanentRedirect`. Browser redirects strip CORS headers, causing uploads to silently fail.

### Lambda Function

`lambda_function.py` is deployed to AWS Lambda. It:

1. Accepts `{ "filename": "report.pdf" }` in the POST body
2. Sanitises the filename (removes characters other than `.`, `-`, `_`, letters, digits)
3. Calls `s3.generate_presigned_post(Bucket, Key, ExpiresIn=900)` — key goes to the **bucket root** (no subfolder)
4. Returns `{ upload_url, fields, key }` to the browser

Configuration via Lambda environment variables:

| Variable | Value |
|---|---|
| `BUCKET_NAME` | `emr-lab-bucket-699092321120-us-east-2-an` |
| `BUCKET_REGION` | `us-east-2` |
| `ALLOWED_ORIGIN` | `https://kanikayears.com` |

### S3 CORS Policy

The bucket must allow the site to POST directly to it (`cors_policy.json`):

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedOrigins": ["https://kanikayears.com"],
    "ExposeHeaders":  ["ETag"],
    "MaxAgeSeconds":  3000
  }
]
```

`AllowedOrigins` must match exactly — no trailing slash.

### IAM Policy (Lambda Execution Role)

The Lambda execution role `s3-upload-lambda-role` has an inline policy granting only `s3:PutObject` on the target bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid":      "AllowS3Upload",
      "Effect":   "Allow",
      "Action":   "s3:PutObject",
      "Resource": "arn:aws:s3:::emr-lab-bucket-699092321120-us-east-2-an/*"
    }
  ]
}
```

The resource ARN must end with `/*` — omitting it causes `AccessDenied`.

### Multi-File Upload

`upload.html` supports selecting multiple files at once via `<input type="file" multiple>`. Files are uploaded sequentially — each gets its own presigned URL:

```javascript
for (let i = 0; i < selectedFiles.length; i++) {
  // 1. Get presigned URL from Lambda
  const { upload_url, fields } = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name }),
  }).then(r => r.json());

  // 2. Upload directly to S3
  const formData = new FormData();
  Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
  formData.append("file", file);  // file MUST be the last field
  await fetch(upload_url, { method: "POST", body: formData });
}
```

The `file` field must come last in `FormData` — S3 rejects uploads where any field follows the file.

---

## Where Data Lives

| Data | Where Stored | Duration |
|---|---|---|
| Email + hashed password | Firebase Authentication | Permanent (until deleted) |
| OTP code | Browser sessionStorage | 10 minutes or until tab closes |
| Logged-in user session | Browser sessionStorage | Until sign out or tab closes |
| Uploaded files | AWS S3 bucket root | Permanent (until manually deleted) |

No database is owned or managed. Firebase handles identity storage; S3 handles files.

---

## Security Notes

- Passwords are never stored in plain text — Firebase uses secure hashing
- OTP codes live only in `sessionStorage`, never sent to any server, expire after 10 minutes
- AWS credentials are never sent to the browser — Lambda generates a temporary upload URL
- Pre-signed POST URLs expire after 15 minutes
- All traffic is over HTTPS
- S3 bucket has Block all public access enabled — files are not publicly readable

---

## HIPAA Compliance

| Requirement | How Met |
|---|---|
| Access controls | Email + password + OTP 2FA |
| Credential security | Firebase (Google) — HIPAA BAA available |
| Email transport | Gmail SMTP over TLS |
| Session management | sessionStorage cleared on tab close |
| Transmission security | HTTPS enforced by GitHub Pages and AWS API Gateway |
| Audit controls | Firebase logs all sign-in events; AWS CloudTrail logs S3 activity |
| File encryption | S3 server-side encryption (SSE-S3) enabled by default |

> **Note:** For production HIPAA deployment, sign Google's HIPAA BAA at [cloud.google.com/security/compliance/hipaa](https://cloud.google.com/security/compliance/hipaa) and AWS's BAA via AWS Artifact in the console.

---

## How to Change the S3 Bucket

1. Create the new bucket in S3 and apply `cors_policy.json` (update `AllowedOrigins` if your domain changed)
2. Update the IAM inline policy on `s3-upload-lambda-role` — change the ARN to the new bucket name
3. In Lambda → Configuration → Environment variables, update `BUCKET_NAME` (and `BUCKET_REGION` if needed)
4. Nothing in `upload.html` or API Gateway needs to change

---

## EmailJS Configuration

```javascript
await emailjs.send(
  "service_8ngw648",    // EmailJS Service ID (linked to Gmail)
  "template_9yfipwi",   // EmailJS Template ID
  { to_email: email, otp_code: otp },
  "1SRRPZQ8Tp7xLh_Ub"  // EmailJS Public Key
);
```

**Template variables:** `{{to_email}}` and `{{otp_code}}` — set in the EmailJS template editor.

---

## Firebase Configuration

**Firebase Authorized Domains** (Firebase Console → Authentication → Settings → Authorized domains) must include:
- `localhost`
- `ramanuja125.github.io`
- `kanikayears.com`
