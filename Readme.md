# Secure Portal — Full Architecture & Documentation

## What Is This?

A HIPAA-conscious, two-factor authenticated file upload portal hosted entirely for free on GitHub Pages. After logging in with email, password, and a one-time code sent to your inbox, users can upload medical or clinical files (Excel, PDF, Word, CSV, TXT) directly to AWS S3 — and then **have a live conversation with the contents of those files** using an AI assistant, without exposing any API keys to the browser.

This was built with no backend server, no database we manage, and no AI framework like LangChain. Everything runs on managed cloud services stitched together.

---

## What Was Built (Feature List)

| # | Feature | How |
|---|---|---|
| 1 | User registration with email + password | Firebase Authentication |
| 2 | Email verification on sign-up | Firebase built-in |
| 3 | Two-factor login (password + OTP) | Firebase + EmailJS |
| 4 | Password reset via email | Firebase built-in |
| 5 | Secure session management | Browser sessionStorage |
| 6 | Multi-file upload to AWS S3 | Pre-signed POST URLs via Lambda |
| 7 | Drag-and-drop file upload UI | Vanilla JavaScript |
| 8 | AI chatbot for uploaded files | Lambda + OpenRouter + GPT-4o mini |
| 9 | Auto file summary on chat open | Same Lambda, auto-triggered |
| 10 | Per-file independent chat history | Browser memory (JavaScript) |
| 11 | Ask All Files — cross-file parallel queries | Browser fires one request per file simultaneously |
| 12 | Two-tab chat UI (Per File / Ask All) | Vanilla JavaScript tab switching |
| 13 | API key never exposed to browser | Lambda environment variable |

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Hosting | GitHub Pages | Serves all HTML/CSS/JS files for free |
| Authentication | Firebase Auth | Stores and verifies email + password |
| OTP Delivery | EmailJS | Sends 6-digit code to user's inbox |
| Email Transport | Gmail SMTP (via EmailJS) | Actual email delivery |
| Upload backend | AWS Lambda (Python 3.12) — `s3-upload-lambda` | Generates temporary S3 upload permissions |
| Chat backend | AWS Lambda (Python 3.12) — `s3-chat` | Reads files from S3, extracts text, calls AI |
| Lambda packages | AWS Lambda Layer — `s3-chat-layer` | openpyxl, pypdf, python-docx, xlrd |
| API layer | AWS API Gateway (HTTP API) | HTTPS endpoints that trigger Lambdas |
| File storage | AWS S3 | Stores uploaded files |
| AI model | GPT-4o mini via OpenRouter | Answers questions about file contents |
| Frontend | HTML, CSS, Vanilla JS | All UI and browser-side logic |

---

## Full System Architecture

```
                  ┌─────────────────────────────────────────┐
                  │           GitHub Pages                   │
                  │         kanikayears.com                  │
                  │                                          │
                  │  index.html      → verify.html           │
                  │  register.html                           │
                  │  forgot-password.html                    │
                  │  upload.html  ← (main page after login)  │
                  └────┬──────────────────────┬─────────────┘
                       │                      │
         ┌─────────────▼──────┐    ┌──────────▼──────────────────────────┐
         │  Firebase + EmailJS │    │     AWS API Gateway (HTTP API)       │
         │                    │    │   aoqop7lkph.execute-api.us-east-2   │
         │  - Auth (login)    │    │                                      │
         │  - OTP (email)     │    │  POST /get-upload-url                │
         │  - Password reset  │    │  POST /chat                          │
         └────────────────────┘    └────────┬─────────────┬──────────────┘
                                            │             │
                               ┌────────────▼──┐   ┌──────▼─────────────┐
                               │  Lambda        │   │  Lambda             │
                               │  s3-upload-    │   │  s3-chat            │
                               │  lambda        │   │                     │
                               │                │   │  1. Get file from S3│
                               │  Generates     │   │  2. Extract text    │
                               │  pre-signed    │   │  3. Call OpenRouter │
                               │  POST URL      │   │     → GPT-4o mini   │
                               └────────┬───────┘   └──────┬─────────────┘
                                        │                  │
                                ┌───────▼──────────────────▼──────────────┐
                                │              AWS S3                      │
                                │   emr-lab-bucket-699092321120-us-east-2  │
                                │   (files stored in bucket root)          │
                                └──────────────────────────────────────────┘
```

---

## Authentication Flow (Firebase + EmailJS)

### Non-technical explanation
Think of it as a double lock on the front door. The first key is your password. Once Firebase confirms it's right, a one-time code is immediately sent to your email. You enter that code on the next screen. Only if both are correct do you get in. Even if someone steals your password, they can't log in without also accessing your email.

### Registration
```
1. User enters email + password on register.html
2. Client checks password rules: 8+ characters, uppercase, lowercase, number, special character
3. Firebase creates the account and stores a hashed (scrambled) password — we never see the real password
4. Firebase sends an email verification link
5. User is redirected to login page
```

### Login (2-Factor Flow)
```
1. User enters email + password on index.html
2. Firebase verifies the password against its stored hash
3. JavaScript generates a random 6-digit OTP (e.g. "847291") entirely in the browser
4. OTP is saved to sessionStorage with a 10-minute expiry timestamp
   → sessionStorage only lives in that browser tab, never sent to any server
5. EmailJS sends the OTP to the user's email via Gmail SMTP
6. User is redirected to verify.html
7. User types the 6-digit code
8. Browser checks: does it match? Is it still within 10 minutes?
9. If yes → auth_user is saved to sessionStorage → upload.html
10. If wrong or expired → user must log in again
```

### Password Reset
```
1. User enters email on forgot-password.html
2. Firebase sends a reset link to that email
3. User clicks link → Firebase's hosted reset page
4. Firebase updates the stored password hash
5. User is sent back to index.html
```

### Sign Out
```
1. User clicks "Sign Out"
2. sessionStorage is cleared (auth_user removed from browser memory)
3. Firebase signs out
4. User is sent back to index.html
```

---

## File Upload — How It Works

### Non-technical explanation
When you upload a file, your browser never talks directly to AWS using our credentials. Instead it asks our server (Lambda) "can I upload this file?" Lambda generates a one-time permission slip (pre-signed URL) that expires in 15 minutes. The browser uses that permission slip to put the file directly into S3. Lambda never touches the file itself during upload.

### Why Pre-Signed POST (not PUT)?
We use `generate_presigned_post` specifically, not `generate_presigned_url("put_object")`. This matters because Lambda runs with temporary IAM credentials (keys starting with `ASIA`). There is a known bug in boto3 where `put_object` pre-signed URLs generate the wrong signature when temporary credentials are used, causing S3 to reject the upload with `SignatureDoesNotMatch`. The POST method was designed for browser uploads and works correctly with temporary credentials.

### Why `addressing_style: "virtual"`?
Without this, boto3 generates an S3 URL in the old "path style" format: `s3.amazonaws.com/bucket-name/file`. AWS is deprecating path-style URLs and responds with a `301 Redirect` to the new format. When a browser follows that redirect, it strips the CORS headers — so the upload silently fails. Setting `addressing_style: "virtual"` generates the new format upfront: `bucket-name.s3.us-east-2.amazonaws.com/file`.

### Upload Sequence
```
Browser                    API Gateway      Lambda            S3
  │                             │              │               │
  │── POST /get-upload-url ────►│              │               │
  │   { filename: "data.xlsx" } │              │               │
  │                             │── invoke ───►│               │
  │                             │              │── presigned ──►│
  │                             │              │   POST URL    │
  │                             │◄── response ─│               │
  │◄── { upload_url, fields } ──│              │               │
  │                             │              │               │
  │── POST upload_url ──────────────────────────────────────►│
  │   (FormData: fields + file)                               │
  │◄── 204 No Content ──────────────────────────────────────│
```

### File Support
Excel (.xlsx, .xls), PDF, Word (.docx), CSV, TXT. Multiple files can be selected at once and are uploaded one by one, each getting its own pre-signed URL.

---

## The File Chat Feature — How the AI Agent Works

### Non-technical explanation
After uploading files, the chat section appears with two tabs:

**Per File Chat** — select one file, get an automatic 2-3 sentence summary of what it contains, then ask follow-up questions in a full conversation. The chat remembers the full conversation history for each file separately. Switch files and pick up right where you left off.

**Ask All Files** — type a single question and every uploaded file is queried at the same time, in parallel. Results appear as cards, one per file, with the filename labelled. This is useful when your files are similar in structure (e.g. daily student data, weekly reports) and you want to compare answers across dates or versions — you'd get all answers in one go instead of asking each file one by one.

There is no AI framework (no LangChain, no AutoGen, no agents SDK). It's three steps in one Lambda function: read file → extract text → ask GPT. The "Ask All" feature reuses the exact same Lambda — the browser just calls it once per file simultaneously.

### Architecture of the Chat System

#### Tab 1: Per File Chat

```
Browser (upload.html)
  │
  │  User selects file from dropdown
  │  → Browser auto-sends: "Summarize this file in 2-3 sentences"
  │
  │── POST /chat ──────────────────────────────────────────────────►
  │   {                                                             │
  │     s3_key: "student-data-2025-06-19.xlsx",                    │
  │     question: "Summarize this file...",                    Lambda (s3-chat)
  │     chat_history: []                                           │
  │   }                                                            │
  │                                                      1. boto3 s3.get_object()
  │                                                         → downloads file bytes
  │                                                                 │
  │                                                      2. extract_text()
  │                                                         → parses file by extension
  │                                                         → returns plain text string
  │                                                                 │
  │                                                      3. call_openrouter()
  │                                                         → builds messages array
  │                                                         → POST to OpenRouter API
  │                                                         → GPT-4o mini answers
  │                                                                 │
  │◄── { answer: "This file contains..." } ────────────────────────┘
  │
  │  Browser displays answer as chat bubble
  │  Browser stores { role: "assistant", content: answer } in perFileChatHistory
```

#### Tab 2: Ask All Files

```
Browser (upload.html)
  │
  │  User types: "How many students scored above 90?"
  │  → Browser fires ONE request per uploaded file, all at the same time
  │
  ├── POST /chat { s3_key: "student-data-2025-06-19.xlsx", question: "..." } ──►  Lambda
  ├── POST /chat { s3_key: "student-data-2025-06-20.xlsx", question: "..." } ──►  Lambda
  └── POST /chat { s3_key: "student-data-2025-06-21.xlsx", question: "..." } ──►  Lambda
                                                                                    │
                                              (all three run in parallel on AWS)    │
                                                                                    │
  ◄── { answer: "14 students scored above 90" }  ←  2025-06-19.xlsx ───────────────┘
  ◄── { answer: "9 students scored above 90"  }  ←  2025-06-20.xlsx
  ◄── { answer: "21 students scored above 90" }  ←  2025-06-21.xlsx
  │
  │  Browser renders one answer card per file, labelled with the filename
  │  No conversation history is kept — each "Ask All" question is fresh
```

The Lambda function (`s3-chat`) is identical for both modes. The only difference is that in Ask All mode, the browser calls it once per file simultaneously using `Promise.all()`, rather than one at a time.

### How Text Is Extracted From Each File Type

| File Type | Library Used | Why |
|---|---|---|
| `.xlsx` (modern Excel) | openpyxl | Pure Python, reads the zip-based XML format used by Excel 2007+ |
| `.xls` (old Excel 97-2003) | xlrd | openpyxl cannot read the old binary OLE2 format; xlrd is the fallback |
| `.pdf` | pypdf | Pure Python PDF reader. We chose this over pdfplumber specifically because pdfplumber contains compiled C extensions (.so files) — those are compiled for a specific Python version and fail when the CloudShell Python version (3.13) doesn't match the Lambda Python version (3.12). pypdf is pure Python so it works regardless. |
| `.docx` | python-docx | Reads Word document XML |
| `.csv` / `.txt` | built-in (decode) | No library needed — just decode bytes as UTF-8 |

The extracted text is truncated to 60,000 characters before sending to the AI to stay within the model's context window.

### How Multi-Turn Chat Works
Every time the user sends a message, the browser sends the full conversation history alongside the new question:

```javascript
// In the browser (JavaScript)
perFileChatHistory = {
  "hospital-data.xlsx": [
    { role: "assistant", content: "This file contains readmission rates..." },
    { role: "user",      content: "What is the highest value?" },
    { role: "assistant", content: "The highest value is 0.99%..." },
  ],
  "patient-list.csv": [
    { role: "assistant", content: "This file contains patient records..." },
  ]
}
```

When you switch files, the current conversation is saved and the other file's conversation is loaded. Each file has a completely separate memory.

On the Lambda side, these messages are assembled into the format the AI model expects:

```python
messages = [
  { "role": "system",    "content": "You are a helpful assistant. FILE CONTENT:\n<full file text>" },
  { "role": "assistant", "content": "This file contains readmission rates..." },
  { "role": "user",      "content": "What is the highest value?" },
]
```

This is the standard way all chat AI systems maintain context — the entire conversation is re-sent each time.

### Security: How the API Key Never Reaches the Browser
The OpenRouter API key (`sk-or-v1-...`) exists only as a Lambda environment variable. The browser never receives it — it only calls `/chat` on API Gateway, which invokes Lambda, and Lambda makes the actual OpenRouter request server-side. Even if someone opened DevTools on the page, they would find no key anywhere.

---

## AWS Setup — Detailed Technical Reference

### What Was Created on AWS

| AWS Resource | Name | Purpose |
|---|---|---|
| S3 Bucket | `emr-lab-bucket-699092321120-us-east-2-an` | Stores uploaded files |
| Lambda Function | `s3-upload-lambda` | Generates pre-signed upload URLs |
| Lambda Function | `s3-chat` | File text extraction + AI chat |
| Lambda Layer | `s3-chat-layer` | Python packages for s3-chat |
| API Gateway | HTTP API | HTTPS endpoints for both Lambdas |
| IAM Role | `s3-upload-lambda-role` | Permissions for both Lambdas |
| IAM Policy | `s3-put-emr-lab-bucket` | Allows s3:PutObject on the bucket |
| IAM Policy | `s3-get-emr-lab-bucket` | Allows s3:GetObject on the bucket |

---

### Step 1 — S3 Bucket

The bucket `emr-lab-bucket-699092321120-us-east-2-an` was created in `us-east-2` (Ohio). The number in the name is the AWS account ID — this is a common naming pattern to ensure global uniqueness.

**CORS policy applied to the bucket** (allows the website to POST files directly):
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedOrigins": ["https://kanikayears.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```
`AllowedOrigins` must be an exact match — no trailing slash. This tells S3 "only accept uploads originating from kanikayears.com."

---

### Step 2 — IAM Role and Policies

**Why IAM roles?** Lambda cannot touch S3 without explicit permission. The role `s3-upload-lambda-role` is attached to both Lambda functions and grants them AWS permissions.

**Policy 1 — `s3-put-emr-lab-bucket`** (for the upload Lambda):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowS3Upload",
    "Effect": "Allow",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::emr-lab-bucket-699092321120-us-east-2-an/*"
  }]
}
```

**Policy 2 — `s3-get-emr-lab-bucket`** (added later, for the chat Lambda):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowS3Read",
    "Effect": "Allow",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::emr-lab-bucket-699092321120-us-east-2-an/*"
  }]
}
```

**What is an ARN?** ARN stands for Amazon Resource Name — it is AWS's universal identifier for any resource. The format is:
```
arn:aws:s3:::bucket-name/*
         ^   ^   ^
         |   |   └── The bucket name (no region/account for S3 ARNs)
         |   └────── Service (s3, lambda, iam, etc.)
         └────────── AWS partition (always "aws" for standard regions)
```
The `/*` at the end means "all objects inside the bucket." Without it, the policy would only apply to the bucket itself (listing), not the files inside. **When the chat Lambda's read policy was first created, it accidentally had the Lambda Layer ARN pasted in instead of the S3 bucket ARN — this caused `AccessDenied` errors until corrected.**

---

### Step 3 — Lambda Layer (s3-chat-layer)

A Lambda Layer is a ZIP file containing Python packages that gets attached to a Lambda function. This is how we add `openpyxl`, `pypdf`, `python-docx`, and `xlrd` to Lambda without packaging them into the function ZIP itself.

**These exact commands were run in AWS CloudShell** (the browser-based terminal inside the AWS Console):

```bash
# 1. Create the directory structure Lambda expects
mkdir python

# 2. Install all required packages into that directory
pip install openpyxl pypdf python-docx xlrd -t python/ --quiet

# 3. Zip the directory
zip -r layer.zip python/

# 4. Publish the layer to Lambda
aws lambda publish-layer-version \
  --layer-name s3-chat-layer \
  --zip-file fileb://layer.zip \
  --compatible-runtimes python3.12
```

**Why `python/` directory name?** Lambda requires packages to be inside a folder named `python/` (for Python runtimes) so it knows where to look when the function runs.

**Why did we use CloudShell?** Lambda runs Python 3.12 on Amazon Linux. Some Python packages contain compiled C extensions (`.so` files) that are specific to an OS and Python version. CloudShell also runs Amazon Linux, so packages installed there will be compatible with Lambda. If we had installed packages on a Mac or Windows machine, compiled extensions would fail with `invalid ELF header` or similar errors at runtime.

**The `pdfplumber` problem:** The first attempt used `pdfplumber` for PDF reading, but it contains compiled C extensions. CloudShell was running Python 3.13 at the time, and Lambda runs Python 3.12 — the compiled `.so` files are version-specific, so the layer crashed at import. We switched to `pypdf` which is 100% pure Python and works regardless of version.

**The publish command outputs an ARN** like:
```
arn:aws:lambda:us-east-2:699092321120:layer:s3-chat-layer:2
```
This ARN is what you paste into the Lambda function's "Layers" section to attach the layer. The `:2` at the end is the version number — each time you republish, it increments.

---

### Step 4 — Lambda Functions

**Function 1: `s3-upload-lambda`** (`lambda_function.py`)
- Runtime: Python 3.12
- Role: `s3-upload-lambda-role`
- Environment variables: `BUCKET_NAME`, `BUCKET_REGION`, `ALLOWED_ORIGIN`
- Does: receives a filename from the browser, sanitises it, generates a 15-minute pre-signed POST URL

**Function 2: `s3-chat`** (`chat_lambda_function.py`)
- Runtime: Python 3.12
- Role: `s3-upload-lambda-role` (same role, but with the GetObject policy added)
- Layer: `s3-chat-layer` (attached so it can import openpyxl, pypdf, etc.)
- Environment variables:

| Variable | Value |
|---|---|
| `BUCKET_NAME` | `emr-lab-bucket-699092321120-us-east-2-an` |
| `BUCKET_REGION` | `us-east-2` |
| `ALLOWED_ORIGIN` | `https://kanikayears.com` |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` (never put this anywhere else) |

- Does: downloads the file from S3, extracts text based on file type, builds the conversation history, calls OpenRouter API, returns the AI's answer

---

### Step 5 — API Gateway

An HTTP API was created (not a REST API — HTTP APIs are simpler, cheaper, and faster). Two routes were added:

| Route | Lambda | URL |
|---|---|---|
| `POST /get-upload-url` | `s3-upload-lambda` | `https://aoqop7lkph.execute-api.us-east-2.amazonaws.com/get-upload-url` |
| `POST /chat` | `s3-chat` | `https://aoqop7lkph.execute-api.us-east-2.amazonaws.com/chat` |

HTTP APIs auto-deploy on every change, so there's no manual "deploy stage" step needed.

**CORS** is handled inside the Lambda functions themselves (not at the API Gateway level) — each Lambda returns `Access-Control-Allow-Origin: https://kanikayears.com` in its response headers, and handles the browser's `OPTIONS` preflight request.

---

## Firebase / Firestore Setup

**Project:** `hipaa-877ca` in Firebase Console.

Firebase Authentication is the only Firebase service used — there is no Firestore database. Firebase stores:
- Email address
- Hashed password (Firebase handles hashing, we never see the plain password)
- Email verification status

**Authorized Domains** (Firebase Console → Authentication → Settings → Authorized domains) must include:
- `localhost` (for local testing)
- `ramanuja125.github.io` (the GitHub Pages domain)
- `kanikayears.com` (the custom domain)

Without these, Firebase will reject sign-in attempts from those origins.

**The `auth.js` file** contains the Firebase config (apiKey, projectId, etc.) — these are safe to be public. Firebase API keys are not secret; they identify the project. Access is controlled by Authorized Domains and Firebase Security Rules, not by keeping the key private.

---

## EmailJS Setup

EmailJS is a service that lets JavaScript send emails directly from the browser without a backend server. It connects to a Gmail account via SMTP and sends emails on your behalf.

**Current account:** kanikayears@gmail.com

| Config Value | ID |
|---|---|
| Service ID | `service_xkqj0hk` |
| Template ID | `template_itledcu` |
| Public Key | `TTVqGUIKfCVoS2Sbz` |

These are set in `auth.js`. The Public Key is safe to expose — it only allows sending emails through your own EmailJS templates, not reading or modifying anything.

**Template variables used:** `{{to_email}}` and `{{otp_code}}` — set inside the EmailJS template editor at emailjs.com.

**If you need to rotate the Public Key:** log into emailjs.com → Account → API Keys → regenerate → update `EMAILJS_PUBLIC_KEY` in `auth.js`.

---

## File Structure

```
/
├── index.html              → Login page (email + password)
├── register.html           → New user registration
├── verify.html             → OTP code entry (2FA step)
├── upload.html             → Post-login file upload + AI chat
├── forgot-password.html    → Password reset
├── styles.css              → Shared styles (all pages)
├── auth.js                 → All Firebase + EmailJS logic
├── lambda_function.py      → Code for s3-upload-lambda (upload URLs)
├── chat_lambda_function.py → Code for s3-chat (file reading + AI)
├── cors_policy.json        → S3 bucket CORS configuration
└── README.md               → This file
```

---

## Security Architecture Summary

| Concern | How It's Handled |
|---|---|
| AWS credentials in browser | Never happen. Lambda generates temporary upload URLs. |
| OpenRouter API key in browser | Never happens. Key lives only in Lambda environment variables. |
| Password storage | Firebase handles it. Passwords are hashed (bcrypt). We never see them. |
| OTP storage | Lives only in `sessionStorage` (browser tab memory). Never sent to any server. |
| Session hijacking | Sessions live in `sessionStorage` — cleared when the tab closes. |
| Pre-signed URL abuse | URLs expire in 15 minutes and are for a single file key. |
| S3 files publicly readable | S3 bucket has "Block all public access" enabled. Files are private. |
| Cross-origin attacks | CORS headers on both Lambda functions restrict requests to kanikayears.com only. |

---

## How to Change Things

### Change the AI model
In `chat_lambda_function.py`, find this line:
```python
"model": "openai/gpt-4o-mini",
```
Replace with any model available on OpenRouter (e.g. `"anthropic/claude-3-haiku"`, `"google/gemini-flash-1.5"`). Redeploy the Lambda.

### Change the S3 bucket
1. Create a new bucket, apply `cors_policy.json` (update `AllowedOrigins` if domain changed)
2. Update the IAM policies with the new bucket ARN
3. Update `BUCKET_NAME` environment variable in both Lambda functions

### Change the EmailJS account
1. Create a new service on emailjs.com linked to your Gmail
2. Create a template with `{{to_email}}` and `{{otp_code}}` variables
3. Update `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY` in `auth.js`

### Rotate the OpenRouter API key
Go to openrouter.ai → Keys → create new → update `OPENROUTER_API_KEY` in the `s3-chat` Lambda environment variables. No code changes needed.

---

## HIPAA Considerations

| Requirement | Status |
|---|---|
| Access controls | Email + password + OTP 2FA enforced |
| Credential security | Firebase (Google) — HIPAA BAA available from Google |
| Session management | sessionStorage — cleared on tab close |
| Transmission security | HTTPS enforced by GitHub Pages and AWS API Gateway |
| S3 encryption | Server-side encryption (SSE-S3) enabled by default |
| Audit logging | Firebase logs all sign-in events; AWS CloudTrail logs S3 + Lambda activity |

> For a production HIPAA deployment, sign Google's BAA at cloud.google.com and AWS's BAA via AWS Artifact in the console. EmailJS may need to be replaced with a HIPAA-compliant email service.
