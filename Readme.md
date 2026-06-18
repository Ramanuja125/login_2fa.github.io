# Secure Portal — Full Architecture & Documentation

---

## What Is This?

A HIPAA-conscious, two-factor authenticated portal hosted entirely for free on GitHub Pages. After logging in with email, password, and a one-time code sent to your inbox, users can either **upload new files** or **browse files already stored in the cloud** — and then have a live AI conversation with the contents of those files, without any API keys ever reaching the browser.

Built with no backend server, no database we manage, and no AI framework. Everything runs on managed cloud services stitched together with clean, minimal code.

---

## What Was Built (Feature List)

| # | Feature | How |
|---|---|---|
| 1 | User registration with email + password | Firebase Authentication |
| 2 | Email verification on sign-up | Firebase built-in |
| 3 | Two-factor login (password + OTP) | Firebase + EmailJS |
| 4 | Password reset via email | Firebase built-in |
| 5 | Secure session management | Browser sessionStorage |
| 6 | Mode selection after login — Upload or Load Stored | Vanilla JavaScript |
| 7 | Multi-file upload to AWS S3 | Pre-signed POST URLs via Lambda |
| 8 | Drag-and-drop file upload UI | Vanilla JavaScript |
| 9 | Load stored files — browse bucket contents with checkboxes | Lambda list_files + S3 list_objects_v2 |
| 10 | AI chatbot — Per File tab | Lambda + OpenRouter + GPT-4o mini |
| 11 | Auto file summary when chat opens | Same Lambda, auto-triggered |
| 12 | Per-file independent conversation history | Browser memory (JavaScript) |
| 13 | Ask All Files tab — Combined Answer | All files merged in one Lambda call |
| 14 | Ask All Files tab — Ask Each File | Parallel per-file Lambda calls |
| 15 | Speech-to-text mic button | Browser Web Speech API (no external service) |
| 16 | API key never exposed to browser | Lambda environment variable only |

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Hosting | GitHub Pages | Serves all HTML/CSS/JS files, free |
| Authentication | Firebase Auth | Stores and verifies email + hashed password |
| OTP Delivery | EmailJS | Sends 6-digit code to user's inbox |
| Email Transport | Gmail SMTP (via EmailJS) | Actual email delivery |
| Upload backend | AWS Lambda — `s3-upload-lambda` (Python 3.12) | Generates temporary S3 upload permissions |
| Chat + List backend | AWS Lambda — `s3-chat` (Python 3.12) | Reads files from S3, extracts text, lists bucket, calls AI |
| Python packages | AWS Lambda Layer — `s3-chat-layer` | openpyxl, pypdf, python-docx, xlrd |
| API layer | AWS API Gateway (HTTP API) | HTTPS endpoints for both Lambdas |
| File storage | AWS S3 | Stores all uploaded files |
| AI model | GPT-4o mini via OpenRouter | Answers questions about file contents |
| Voice input | Browser Web Speech API | Speech-to-text, built into Chrome/Edge |
| Frontend | HTML, CSS, Vanilla JS | All UI and browser-side logic |

---

## Full System Architecture

```
                  +------------------------------------------+
                  |            GitHub Pages                  |
                  |          kanikayears.com                 |
                  |                                          |
                  |  index.html      --> verify.html         |
                  |  register.html                           |
                  |  forgot-password.html                    |
                  |  upload.html  <-- (main page after login)|
                  +-----+-----------------------------+------+
                        |                             |
          +-------------+----------+   +--------------+----------------------------+
          |  Firebase + EmailJS    |   |    AWS API Gateway (HTTP API)             |
          |                        |   |  aoqop7lkph.execute-api.us-east-2         |
          |  - Auth (login)        |   |                                           |
          |  - OTP (email)         |   |  POST /get-upload-url                    |
          |  - Password reset      |   |  POST /chat  (chat + list + combined)    |
          +------------------------+   +---------+------------------+--------------+
                                                 |                  |
                                    +------------+------+  +--------+------------+
                                    |  Lambda           |  |  Lambda             |
                                    |  s3-upload-lambda |  |  s3-chat            |
                                    |                   |  |                     |
                                    |  Generates        |  |  - list_files       |
                                    |  pre-signed       |  |  - single file chat |
                                    |  POST URL         |  |  - combined chat    |
                                    +------------+------+  +--------+------------+
                                                 |                  |
                                    +------------+------------------+------------+
                                    |                  AWS S3                   |
                                    |  emr-lab-bucket-699092321120-us-east-2    |
                                    |  (all files stored in bucket root)        |
                                    +-------------------------------------------+
```

---

## User Journey (End to End)

### Step 1 — Login with Two Factors

```
index.html
  User enters email + password
  --> Firebase checks the password against its stored hash
  --> JavaScript generates a random 6-digit code, stores it in the browser tab only
  --> EmailJS sends the code to the user's email via Gmail SMTP
  --> User is sent to verify.html

verify.html
  User types the 6-digit code
  --> Browser checks: does it match? Is it still within 10 minutes?
  --> If yes: session is saved, user goes to upload.html
  --> If wrong or expired: user must log in again
```

**Non-technical:** It's a double lock. Your password is the first key. A one-time code sent to your inbox is the second. Even if someone steals your password, they cannot log in without also accessing your email.

---

### Step 2 — Choose a Mode

After login, the upload page shows two options side by side:

**Upload Files** — choose files from your computer and send them to secure cloud storage. Supports Excel (.xlsx, .xls), PDF, Word (.docx), CSV, TXT. Multiple files at once, with drag-and-drop.

**Load Stored Files** — browse every file already in the S3 bucket. Files are shown as a scrollable list with checkboxes, file size, and upload date. Select any combination and click Load — they are ready to chat with immediately, no re-upload needed.

Both modes feed into exactly the same chat interface. You can even mix: load some stored files, then switch back to Upload and add more — they all merge into one session.

---

### Step 3 — Chat With Your Files

The chat section has two tabs:

#### Per File Chat

Select one file from the dropdown. The AI automatically reads the file and gives you a 2-3 sentence summary of what it contains. Then ask any follow-up question. The full conversation is remembered for each file separately — switch to another file and back, and your conversation picks up exactly where it left off.

#### Ask All Files

Two buttons:

**Combined Answer** — all uploaded/loaded files are merged together and sent to the AI in a single request. The AI sees all files at once and can reason across them. Use this for cross-file questions like "find patients older than 65 and show their highest values across all reports." This is the power mode — one coherent answer synthesised from everything.

**Ask Each File** — the same question is sent to every file simultaneously in parallel. Each file gets its own answer card labelled with the filename. Use this when you want to compare the same metric across files independently, such as "what was the total on this date?" across daily reports.

#### Voice Input (Mic Button)

Every question box has a small microphone icon in the corner. Click it, speak your question, and it types itself. The button pulses red while listening. Click again to stop. This uses the browser's built-in speech recognition — no external service, no API key, works entirely inside Chrome or Edge.

---

## How the AI Works — Technical Detail

### The "Agent" — Three Steps, No Framework

There is no LangChain, AutoGen, or any AI agents framework. The `s3-chat` Lambda does three things in sequence:

```
1. boto3 s3.get_object()    -- download the file bytes from S3
2. extract_text()           -- parse the file and convert to plain text
3. call_openrouter()        -- send text + question to GPT-4o mini, return answer
```

That's it. The "intelligence" comes entirely from GPT-4o mini. The Lambda is just the plumbing.

### File Text Extraction

| File Type | Library | Why This Library |
|---|---|---|
| `.xlsx` (Excel 2007+) | openpyxl | Pure Python, reads the zip-based XML format |
| `.xls` (Excel 97-2003) | xlrd | openpyxl cannot read the old binary OLE2 format; xlrd is the fallback |
| `.pdf` | pypdf | Pure Python. pdfplumber was tried first but has compiled C extensions that fail when CloudShell Python (3.13) doesn't match Lambda Python (3.12). pypdf has no compiled code. |
| `.docx` | python-docx | Reads Word document XML |
| `.csv` / `.txt` | built-in | Just decode bytes as UTF-8, no library needed |

Single-file context limit: 60,000 characters (enough for large spreadsheets).
Combined mode: 120,000 characters total, split equally across all files (e.g. 4 files = 30,000 chars each).

### How Multi-Turn Conversation Works

Every time you send a message, the full conversation history is re-sent alongside the new question. This is how all AI chat systems maintain memory — the model itself is stateless; context is rebuilt each call.

```javascript
// Stored in the browser for each file
perFileChatHistory = {
  "patient-records.xlsx": [
    { role: "assistant", content: "This file contains patient records..." },
    { role: "user",      content: "Who is older than 65?" },
    { role: "assistant", content: "The following patients are older than 65..." }
  ],
  "lab-results-06-17.pdf": [
    { role: "assistant", content: "This file contains lab results from June 17..." }
  ]
}
```

On the Lambda side it becomes:

```python
messages = [
  { "role": "system",    "content": "You are a helpful assistant. FILE CONTENT:\n..." },
  { "role": "assistant", "content": "This file contains patient records..." },
  { "role": "user",      "content": "Who is older than 65?" },
]
# Sent to OpenRouter --> GPT-4o mini --> answer returned
```

### Combined Mode — How All Files Are Merged

When the browser sends a combined request, it passes an array of S3 keys:

```json
{
  "s3_keys": ["patients-name.xlsx", "6-17-2026.pdf", "6-18-2026.pdf", "6-19-2026.pdf"],
  "question": "Find patients older than 65 and their highest blood pressure across all reports"
}
```

The Lambda fetches all four files from S3, extracts text from each, and assembles a single document:

```
============================================================
FILE: patients-name.xlsx
============================================================
[full spreadsheet content, up to 30,000 chars]

============================================================
FILE: 6-17-2026.pdf
============================================================
[full PDF content, up to 30,000 chars]
...
```

This combined text becomes the system prompt context. GPT-4o mini reads all of it and answers the cross-file question in one response.

### Load Stored Files — How the Bucket Listing Works

When the user selects "Load Stored Files", the browser sends:

```json
{ "action": "list_files" }
```

The Lambda runs `s3.list_objects_v2()` with a paginator (handles buckets with more than 1000 files), collects key, size, and last-modified date for every object, sorts newest first, and returns the list. The browser renders it as a checkbox list. No file content is downloaded at this stage — only metadata.

### Security: API Key Never in the Browser

```
Browser                     API Gateway          Lambda              OpenRouter
  |                              |                  |                    |
  |-- POST /chat -------------->|                  |                    |
  |   { s3_key, question }      |                  |                    |
  |                             |-- invoke ------->|                    |
  |                             |                  |-- POST (with key)->|
  |                             |                  |  Authorization:    |
  |                             |                  |  Bearer sk-or-v1.. |
  |                             |                  |<-- { answer } -----|
  |<-- { answer } -------------|                  |                    |
```

The OpenRouter key is an environment variable inside Lambda. It never appears in any HTML, JS, or GitHub file. DevTools inspection of the page will show no key.

---

## AWS Setup — Step by Step

### Resources Created

| AWS Resource | Name | Purpose |
|---|---|---|
| S3 Bucket | `emr-lab-bucket-699092321120-us-east-2-an` | Stores all uploaded files |
| Lambda Function | `s3-upload-lambda` | Generates pre-signed upload URLs |
| Lambda Function | `s3-chat` | Chat, file listing, combined queries |
| Lambda Layer | `s3-chat-layer` | Python packages for s3-chat |
| API Gateway | HTTP API | HTTPS endpoints for both Lambdas |
| IAM Role | `s3-upload-lambda-role` | Shared permissions role for both Lambdas |
| Inline Policy (on role) | `s3-put-emr-lab-bucket` | s3:PutObject — allows upload Lambda to write files |
| Inline Policy (on role) | `s3-read-list-emr-lab-bucket` | s3:GetObject + s3:ListBucket — allows chat Lambda to read files and list the bucket |

---

### Step 1 — S3 Bucket

Created in `us-east-2` (Ohio). The account ID in the name ensures global uniqueness.

CORS policy (allows the website to POST directly to the bucket):
```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["PUT", "POST"],
  "AllowedOrigins": ["https://kanikayears.com"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

The `AllowedOrigins` value must match exactly — no trailing slash.

---

### Step 2 — IAM Role and Policies

Lambda functions cannot touch S3 without explicit permission. The role `s3-upload-lambda-role` is attached to both Lambda functions. All permissions are added as **inline policies directly on the role** (IAM → Roles → `s3-upload-lambda-role` → Permissions → Add permissions → Create inline policy).

You need exactly two inline policies on this role:

---

**Inline Policy 1 — `s3-put-emr-lab-bucket`**
Allows the upload Lambda to write files into the bucket.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::emr-lab-bucket-699092321120-us-east-2-an/*"
  }]
}
```

---

**Inline Policy 2 — `s3-read-list-emr-lab-bucket`**
Allows the chat Lambda to read individual files and list the entire bucket contents.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::emr-lab-bucket-699092321120-us-east-2-an/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::emr-lab-bucket-699092321120-us-east-2-an"
    }
  ]
}
```

**Critical distinction:** `s3:GetObject` targets objects inside the bucket — ARN ends with `/*`. `s3:ListBucket` targets the bucket itself — ARN has no `/*`. If `s3:ListBucket` is missing, the Load Stored Files feature returns a 500 error even though file reading and uploading work fine. This was the exact issue encountered: the policy initially only had `s3:GetObject`, and `s3:ListBucket` was added later to fix the Load Stored Files feature.

---

**What is an ARN?**
```
arn:aws:s3:::emr-lab-bucket-699092321120-us-east-2-an/*
    ^^^  ^^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
     |    |   Bucket name (S3 ARNs omit region and account ID)
     |    Service name
     AWS partition
```

The `/*` means "all objects inside the bucket." Without it, the policy covers only bucket-level actions (like listing), not individual file access. Early in the setup, the read policy had the Lambda Layer ARN accidentally pasted in instead of the S3 bucket ARN — this caused `AccessDenied` on every file read until corrected.

---

### Step 3 — Lambda Layer (s3-chat-layer)

A Lambda Layer is a ZIP of Python packages shared across Lambda functions. This avoids packaging dependencies into the function ZIP itself.

**Commands run in AWS CloudShell** (the browser terminal inside AWS Console):

```bash
# Lambda expects packages inside a folder named "python/"
mkdir python

# Install packages into that folder
pip install openpyxl pypdf python-docx xlrd -t python/ --quiet

# Zip it
zip -r layer.zip python/

# Publish to Lambda
aws lambda publish-layer-version \
  --layer-name s3-chat-layer \
  --zip-file fileb://layer.zip \
  --compatible-runtimes python3.12
```

**Why CloudShell?** Lambda runs Python 3.12 on Amazon Linux. Packages with compiled C extensions (`.so` files) are version-specific. CloudShell also runs Amazon Linux, so packages installed there match Lambda's environment. A Mac or Windows machine would produce incompatible binaries.

**The pdfplumber problem:** pdfplumber was tried first but has compiled extensions. CloudShell at the time was Python 3.13 while Lambda is Python 3.12 — version mismatch caused import failures. Switched to pypdf which is pure Python and works anywhere.

The publish command returns an ARN like:
```
arn:aws:lambda:us-east-2:699092321120:layer:s3-chat-layer:2
```
Paste this into the Lambda function's Layers section. The `:2` is the version — increments each publish.

---

### Step 4 — Lambda Functions

**`s3-upload-lambda`** (`lambda_function.py`)
- Runtime: Python 3.12, Role: `s3-upload-lambda-role`
- Env vars: `BUCKET_NAME`, `BUCKET_REGION`, `ALLOWED_ORIGIN`
- Receives a filename, sanitises it, returns a 15-minute pre-signed POST URL

**`s3-chat`** (`chat_lambda_function.py`)
- Runtime: Python 3.12, Role: `s3-upload-lambda-role`, Layer: `s3-chat-layer`
- Handles three actions based on what the browser sends:

| Request body contains | Action |
|---|---|
| `action: "list_files"` | Lists all files in the S3 bucket (name, size, date) |
| `s3_key: "file.xlsx"` | Single-file chat — reads one file, answers the question |
| `s3_keys: ["a.xlsx", "b.pdf"]` | Combined chat — merges all files, answers once across all |

- Env vars:

| Variable | Value |
|---|---|
| `BUCKET_NAME` | `emr-lab-bucket-699092321120-us-east-2-an` |
| `BUCKET_REGION` | `us-east-2` |
| `ALLOWED_ORIGIN` | `https://kanikayears.com` |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` (never put this anywhere else) |

---

### Step 5 — API Gateway

HTTP API (simpler, cheaper, and faster than REST API). Two routes:

| Route | Lambda | Endpoint |
|---|---|---|
| `POST /get-upload-url` | `s3-upload-lambda` | `https://aoqop7lkph.execute-api.us-east-2.amazonaws.com/get-upload-url` |
| `POST /chat` | `s3-chat` | `https://aoqop7lkph.execute-api.us-east-2.amazonaws.com/chat` |

HTTP APIs auto-deploy — no manual "Deploy Stage" step needed. CORS is handled inside the Lambda responses, not at the API Gateway level.

---

## Firebase & EmailJS Setup

### Firebase

Project: `hipaa-877ca`. Only Firebase Authentication is used — no Firestore database. Firebase stores email addresses and hashed passwords. We never see actual passwords.

**Authorized Domains** (Firebase Console → Authentication → Settings → Authorized domains):
- `localhost`
- `ramanuja125.github.io`
- `kanikayears.com`

Firebase will reject sign-ins from any domain not on this list.

The Firebase config in `auth.js` (apiKey, projectId, etc.) is safe to be public. These values identify the project but access is controlled by the Authorized Domains list, not by keeping the config secret.

### EmailJS

Sends OTP codes from the browser without a backend server. Connected to Gmail via SMTP.

| Value | ID |
|---|---|
| Account | kanikayears@gmail.com |
| Service ID | `service_xkqj0hk` |
| Template ID | `template_itledcu` |
| Public Key | `TTVqGUIKfCVoS2Sbz` |

Set in `auth.js`. The Public Key is safe to expose — it only allows sending through your own templates.

Template variables: `{{to_email}}` and `{{otp_code}}` — configured in the EmailJS template editor.

To rotate the key: emailjs.com → Account → API Keys → regenerate → update `EMAILJS_PUBLIC_KEY` in `auth.js`.

---

## File Structure

```
/
+-- index.html              --> Login page (email + password)
+-- register.html           --> New user registration
+-- verify.html             --> OTP entry (2FA step)
+-- upload.html             --> Main page: mode selection, upload, load stored, AI chat
+-- forgot-password.html    --> Password reset
+-- styles.css              --> Shared styles across all pages
+-- auth.js                 --> All Firebase + EmailJS logic
+-- lambda_function.py      --> s3-upload-lambda: generates pre-signed upload URLs
+-- chat_lambda_function.py --> s3-chat: file reading, bucket listing, AI chat
+-- cors_policy.json        --> S3 bucket CORS configuration
+-- README.md               --> This file
```

---

## Security Architecture

| Concern | How It Is Handled |
|---|---|
| AWS credentials in browser | Never happens — Lambda generates temporary upload URLs |
| OpenRouter API key in browser | Never happens — key lives only in Lambda environment variables |
| Password storage | Firebase hashes passwords — we never see them |
| OTP storage | Lives only in sessionStorage (browser tab memory), expires in 10 minutes |
| Session persistence | sessionStorage — clears automatically when the tab closes |
| Pre-signed URL abuse | URLs expire in 15 minutes and are scoped to one specific file key |
| S3 files publicly readable | Bucket has Block All Public Access enabled — files are private |
| Cross-origin attacks | CORS headers on both Lambdas restrict requests to kanikayears.com only |

---

## How to Change Things

**Change the AI model:** In `chat_lambda_function.py`, update `"model": "openai/gpt-4o-mini"` to any model on OpenRouter (e.g. `"anthropic/claude-3-haiku"`, `"google/gemini-flash-1.5"`). Redeploy the Lambda.

**Change the S3 bucket:** Create the new bucket, apply `cors_policy.json`, update the IAM policy ARNs, update `BUCKET_NAME` in both Lambda env vars.

**Rotate the OpenRouter API key:** openrouter.ai → Keys → new key → update `OPENROUTER_API_KEY` in `s3-chat` env vars. No code changes needed.

**Rotate the EmailJS public key:** emailjs.com → Account → regenerate → update `EMAILJS_PUBLIC_KEY` in `auth.js`.

---

## HIPAA Considerations

| Requirement | Status |
|---|---|
| Access controls | Email + password + OTP 2FA enforced on every login |
| Credential security | Firebase (Google) — HIPAA BAA available from Google |
| Session management | sessionStorage — clears on tab close |
| Transmission security | HTTPS enforced by GitHub Pages and AWS API Gateway |
| S3 encryption | Server-side encryption (SSE-S3) enabled by default |
| Audit logging | Firebase logs all sign-in events; AWS CloudTrail logs S3 and Lambda activity |

For a production HIPAA deployment: sign Google's BAA at cloud.google.com and AWS's BAA via AWS Artifact. EmailJS may need to be replaced with a HIPAA-compliant transactional email service.
