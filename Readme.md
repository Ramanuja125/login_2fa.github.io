# Secure Patient Portal — Full Architecture & Documentation

> **How to use this file:** Each major feature has its own clearly labelled section. When something new is added, scroll to the relevant section and add to it — no need to rewrite anything else. The Table of Contents links to every section.

---

## Table of Contents

1. [What Is This?](#what-is-this)
2. [Feature List](#feature-list)
3. [Tech Stack](#tech-stack)
4. [System Architecture](#system-architecture)
5. [User Journey](#user-journey)
6. [How the AI Works](#how-the-ai-works)
7. [SMS Bill Reminder System](#sms-bill-reminder-system)
8. [AWS Setup — Auth & File Chat](#aws-setup--auth--file-chat)
9. [AWS Setup — SMS System](#aws-setup--sms-system)
10. [AWS Setup — Structured Query (DuckDB)](#aws-setup--structured-query-duckdb)
11. [Firebase & EmailJS Setup](#firebase--emailjs-setup)
12. [File Structure](#file-structure)
13. [Security Architecture](#security-architecture)
14. [How to Change Things](#how-to-change-things)

---

## What Is This?

A HIPAA-conscious, two-factor authenticated patient portal hosted on GitHub Pages. After logging in with email, password, and a one-time code sent to their inbox, staff can:

- **Upload** new patient files (Excel, PDF, Word, CSV) to secure cloud storage
- **Browse** files already in storage and load them instantly
- **Chat with files** using AI — ask questions about patient records across one or many files
- **Get exact, instant answers on CSV/Excel data** — questions like "how many patients have HbA1c > 13?" run as real SQL against the file via DuckDB instead of the AI reading and estimating from raw text
- **Send SMS bill reminders** to patients from a patient Excel file — and receive two-way AI-powered replies

No backend server, no managed database for the web app, no AI framework. Everything runs on managed cloud services stitched together with clean, minimal code.

---

## Feature List

| # | Feature | How |
|---|---------|-----|
| 1 | User registration with email + password | Firebase Authentication |
| 2 | Email verification on sign-up | Firebase built-in |
| 3 | Two-factor login (password + OTP) | Firebase + EmailJS |
| 4 | Password reset via email | Firebase built-in |
| 5 | Secure session management | Browser sessionStorage |
| 6 | Mode selection — Upload or Load Stored | Vanilla JavaScript |
| 7 | Multi-file upload to AWS S3 | Pre-signed POST URLs via Lambda |
| 8 | Drag-and-drop file upload UI | Vanilla JavaScript |
| 9 | Load stored files with checkboxes | Lambda list_files + S3 list_objects_v2 |
| 10 | AI chat — Per File tab | s3-chat Lambda + OpenRouter + GPT-5.5 |
| 11 | Auto file summary when chat opens | Same Lambda, auto-triggered |
| 12 | Per-file independent conversation history | Browser memory (JavaScript) |
| 13 | Ask All Files — Combined Answer | All files merged in one Lambda call |
| 14 | Ask All Files — Ask Each File | Parallel per-file Lambda calls, each tries the fast SQL path first |
| 15 | Speech-to-text mic button | Browser Web Speech API |
| 16 | API key never exposed to browser | Lambda environment variable only |
| 17 | SMS bill reminders to patients | AWS End User Messaging via sms-send Lambda |
| 18 | Two-way SMS — AI replies to patient responses | sms-reply Lambda + GPT-5.5 |
| 19 | SMS Reminders tab in portal UI | dashboard.html SMS tab → s3-chat trigger_sms action |
| 20 | View patient replies in portal | dashboard.html → s3-chat get_sms_conversations → DynamoDB |
| 21 | Strict AI guardrails on SMS replies | Whitelist system prompt — redirects unknown questions to phone |
| 22 | Fast, exact SQL answers on CSV/Excel | `structured-query` Lambda — DuckDB + LLM-generated SQL |
| 23 | Large CSV/TXT files answered without downloading them | DuckDB reads straight from S3 via `httpfs` (streaming) |
| 24 | Silent fallback to full-text chat | If the SQL path fails for any reason, dashboard.html retries via `/chat` automatically |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Hosting | GitHub Pages | Serves all HTML/CSS/JS, free |
| Authentication | Firebase Auth | Stores and verifies email + hashed password |
| OTP Delivery | EmailJS | Sends 6-digit code to user's inbox |
| Email Transport | Gmail SMTP (via EmailJS) | Actual email delivery |
| Upload backend | AWS Lambda — `s3-upload-lambda` (Python 3.12) | Generates temporary S3 upload permissions |
| Chat + List backend | AWS Lambda — `s3-chat` (Python 3.12) | Reads files, extracts text, lists bucket, calls AI, triggers SMS, reads SMS conversations |
| Structured query backend | AWS Lambda — `structured-query` (Python 3.12), own **Function URL** | DuckDB SQL over CSV/TXT/Excel — exact answers, no context-window truncation |
| SMS sending | AWS Lambda — `sms-send` (Python 3.12) | Reads patient Excel, sends bill reminder SMS to each patient |
| SMS replies | AWS Lambda — `sms-reply` (Python 3.12) | Handles inbound patient SMS, calls GPT-5.5, sends AI reply |
| SMS routing | Amazon SNS | Routes inbound SMS from End User Messaging to sms-reply Lambda |
| SMS service | AWS End User Messaging (`pinpoint-sms-voice-v2`) | Two-way SMS — send and receive |
| SMS phone number | Toll-free number `+18557684735` | Registered in AWS End User Messaging |
| Conversation state | AWS DynamoDB — `sms-conversations` | Stores per-patient SMS conversation history |
| Python packages | AWS Lambda Layer — `s3-chat-layer` | openpyxl, pypdf, python-docx, xlrd |
| Python packages (structured query) | AWS Lambda Layer — `structured-query-deps` | duckdb, openpyxl, xlrd |
| API layer | AWS API Gateway (HTTP API) | HTTPS endpoints for auth/upload/chat |
| API layer (structured query) | AWS Lambda **Function URL** (no API Gateway) | Same reasoning as chat originally used API Gateway, but Function URLs have no 29s timeout ceiling |
| File storage | AWS S3 | All uploaded files stored under `uploads/` prefix |
| AI model | GPT-5.5 via OpenRouter | File chat + SMS reply AI |
| AI model (structured query) | `anthropic/claude-sonnet-4-5` via OpenRouter | Writes the SQL, then phrases the SQL result as an answer |
| Voice input | Browser Web Speech API | Speech-to-text, built into Chrome/Edge |
| Frontend | HTML, CSS, Vanilla JS | All UI and browser-side logic |

---

## System Architecture

```
                  +------------------------------------------+
                  |            GitHub Pages                  |
                  |          kanikayears.com                 |
                  |                                          |
                  |  index.html      --> verify.html         |
                  |  register.html                           |
                  |  forgot-password.html                    |
                  |  dashboard.html  <-- main page after login  |
                  |    Tab 1: Per File Chat                  |
                  |    Tab 2: Ask All Files                  |
                  |    Tab 3: SMS Reminders ← NEW            |
                  +-----+-----------------------------+------+
                        |                             |
          +-------------+----------+   +--------------+----------------------+
          |  Firebase + EmailJS    |   |  AWS API Gateway (HTTP API)         |
          |                        |   |  aoqop7lkph.execute-api.us-east-2   |
          |  - Auth (login/signup) |   |                                     |
          |  - OTP (email)         |   |  POST /get-upload-url               |
          |  - Password reset      |   |  POST /chat  (all actions)          |
          +------------------------+   +----+--------------------+-----------+
                                            |                    |
                               +------------+------+  +----------+----------+
                               |  s3-upload-lambda |  |  s3-chat Lambda     |
                               |                   |  |                     |
                               |  Generates        |  |  - list_files       |
                               |  pre-signed       |  |  - single file chat |
                               |  POST URL         |  |  - combined chat    |
                               +------------+------+  |  - trigger_sms  ←NEW|
                                            |         |  - get_sms_convs ←NEW|
                                            |         +----+--------+--------+
                                            |              |        |
                               +------------+--------------+--+     |
                               |         AWS S3               |     |
                               |  uploads/*.xlsx, *.pdf etc   |     |
                               +------------------------------+     |
                                                                    |
                                              +---------------------+--------+
                                              |      sms-send Lambda         |
                                              |  Reads patient Excel from S3 |
                                              |  Sends bill reminder per row  |
                                              +---------------------+--------+
                                                                    |
                                              +---------------------+--------+
                                              |  AWS End User Messaging      |
                                              |  Toll-free: +18557684735     |
                                              |  Two-way SMS                 |
                                              +---+---------+----------------+
                                                  |         |
                                          Outbound|         |Inbound replies
                                                  |         |
                                            Patient Phone   |
                                                            |
                                              +-------------+---------+
                                              |  Amazon SNS           |
                                              |  sms-inbound-replies  |
                                              +-------------+---------+
                                                            |
                                              +-------------+---------+
                                              |  sms-reply Lambda     |
                                              |  GPT-5.5 via OpenRtr  |
                                              |  Saves to DynamoDB    |
                                              +-------------+---------+
                                                            |
                                              +-------------+---------+
                                              |  DynamoDB             |
                                              |  sms-conversations    |
                                              |  (one row per patient)|
                                              +-----------------------+
```

> **Note:** `structured-query` isn't pictured above — it doesn't go through API Gateway at all. `dashboard.html` calls its **Function URL** directly (`https://dohvyhfsuxvkp76tncjg3lnjuu0xcaxc.lambda-url.us-east-2.on.aws/`) for CSV/TXT/Excel questions, and that Lambda reads straight from the same S3 bucket (streaming for CSV/TXT via DuckDB's `httpfs`, downloaded for Excel). If it fails for any reason, the frontend falls back to `POST /chat` as normal. See [How the AI Works](#how-the-ai-works) and [AWS Setup — Structured Query (DuckDB)](#aws-setup--structured-query-duckdb).

---

## User Journey

### Step 1 — Login with Two Factors

```
index.html
  User enters email + password
  → Firebase checks the password
  → JavaScript generates a random 6-digit OTP, stores it in browser tab only
  → EmailJS sends the code to the user's email via Gmail SMTP
  → User goes to verify.html

verify.html
  User types the 6-digit code
  → Browser checks: does it match? Is it within 10 minutes?
  → Yes: session saved, user goes to dashboard.html
  → No: user must log in again
```

**Non-technical:** It's a double lock. Your password is the first key. A one-time code sent to your email is the second. Even if someone steals your password, they can't get in without also accessing your email.

---

### Step 2 — Upload or Load Files

**Upload Files** — choose files from your computer. Supports Excel (.xlsx, .xls), PDF, Word (.docx), CSV, TXT. Multiple files at once with drag-and-drop.

**Load Stored Files** — browse every file already in S3 as a scrollable checklist with file size and upload date. Select any combination and click Load.

Both modes feed into the same chat interface. You can mix both in one session.

---

### Step 3 — Chat With Your Files

#### Per File Chat
Select one file. The AI automatically summarises it, then you ask follow-up questions. Conversation history is remembered per file independently.

For CSV, TXT, XLSX, or XLS files, every question first tries the fast **structured-query** path (real SQL via DuckDB) before falling back to full-text chat — see [How the AI Works](#how-the-ai-works).

#### Ask All Files
- **Combined Answer** — all files merged into one AI call. Best for cross-file questions. Always uses the full-text `/chat` path, since it needs to reason across mixed file types (PDF + CSV + DOCX together), which a single SQL query can't do.
- **Ask Each File** — same question sent to every file in parallel. Best for comparisons. Each file independently tries the structured-query fast path first, same as Per File Chat.

#### Voice Input
Every question box has a mic button. Click, speak, it types itself. Uses the browser's built-in speech recognition — no external service.

---

### Step 4 — SMS Bill Reminders (New)

The SMS Reminders tab (third tab in the chat section):

1. Load your patient Excel file from S3 (Load Stored Files)
2. Switch to the SMS Reminders tab — the Excel file auto-populates the dropdown
3. Click **Send Reminders** → each patient gets a personalised text:
   > *"Hi John Smith, you have an outstanding bill amount due of $150.00. Call 480-406-5664 at your convenience. Reply STOP to opt out."*
4. Patients who reply get an instant AI response (GPT-5.5)
5. Click **↻ Refresh** to see all patient replies in the table

---

## How the AI Works

There are two separate answer paths. Which one runs is decided automatically, per question — the user never picks.

```
Question asked about a file
        │
        ▼
Is the file CSV, TXT, XLSX, or XLS?
        │                              │
       YES                             NO
        │                              │
        ▼                              ▼
Try structured-query (fast path)   Go straight to s3-chat (general path)
        │
        ▼
Succeeded → exact answer shown. Done.
        │
        └─ Failed for any reason (bad SQL, network issue, anything)
                │
                ▼
        Silently fall back to s3-chat — the original, always-available path
```

### Structured Query — Fast DuckDB Path (New)

For CSV/TXT/Excel files, `dashboard.html` calls the `structured-query` Lambda's Function URL directly (not through API Gateway) before it ever calls `/chat`:

```
1. DuckDB loads the file into an in-memory table called `data`.
     - CSV/TXT: streamed straight from S3 via the `httpfs` extension —
       the file is never downloaded or held in memory in full.
     - XLSX/XLS: openpyxl (read-only streaming mode) downloads and
       converts to a temp CSV first — DuckDB has no native Excel reader.
2. DuckDB inspects its own table (DESCRIBE + 5 sample rows) and sends
   ONLY that schema + sample to the LLM — never the actual data.
3. The LLM writes one SQL SELECT query. It's checked against a keyword
   blocklist (no INSERT/UPDATE/DELETE/DROP/ATTACH/etc.) before running.
4. DuckDB executes that SQL locally, in-process — milliseconds, exact,
   not an estimate. One automatic retry if the SQL errors (the error
   is fed back to the LLM to self-correct).
5. The small result (a few rows) is sent to the LLM a second time,
   only to phrase it as a natural-language answer.
6. Response: { "answer": "...", "sql": "<the query that actually ran>" }
```

**Why this exists:** the general chat path below pastes the whole file into the AI's context window, capped at 60,000 characters — slow on large files and prone to the AI *estimating* counts from truncated text rather than computing them. Routing tabular questions through real SQL first fixes both: answers return in a few seconds and are exact, computed by DuckDB, not guessed by the model.

**Known limits** (falls back to `/chat` automatically when hit):
- No conversation memory — each question is answered independently, no prior chat turns are passed in. A follow-up like "and what about *his* cholesterol?" has no pronoun to resolve against.
- Single file only — can't join across multiple uploaded files (e.g. a medications file + a diagnosis file). Use Combined Answer for that.
- Needs the file to actually be tabular with a header row DuckDB can infer types from.

### File Chat — Three Steps, No Framework

```
1. boto3 s3.get_object()    → download file bytes from S3
2. extract_text()           → parse file to plain text
3. call_openrouter()        → send text + question to GPT-5.5, return answer
```

No LangChain, AutoGen, or AI agents framework. The intelligence comes from GPT-5.5. The Lambda is the plumbing.

### File Text Extraction

| File Type | Library | Notes |
|-----------|---------|-------|
| `.xlsx` | openpyxl | Pure Python, reads modern Excel format |
| `.xls` | xlrd | Fallback for old Excel 97–2003 binary format |
| `.pdf` | pypdf | Pure Python. pdfplumber tried first but has compiled C extensions that fail on Lambda |
| `.docx` | python-docx | Reads Word document XML |
| `.csv` / `.txt` | built-in | Decode bytes as UTF-8 |

Context limits: single file 60,000 chars. Combined mode 120,000 chars total split equally across files.

### Multi-Turn Conversation

Full conversation history is re-sent with every message. The model itself is stateless — context is rebuilt each call. History lives in browser memory per file.

### API Key Security

```
Browser → API Gateway → s3-chat Lambda → OpenRouter (key here only)
```

The OpenRouter key is a Lambda environment variable. It never appears in any HTML, JS, or GitHub file.

---

## SMS Bill Reminder System

### Overview

Two-way SMS using AWS End User Messaging (the AWS successor to Pinpoint SMS, supported beyond Oct 2026).

- **Outbound:** portal triggers `sms-send` Lambda → reads patient Excel → sends personalised bill reminder to each mobile number
- **Inbound:** patient replies → End User Messaging → SNS → `sms-reply` Lambda → GPT-5.5 generates response within the guardrails → sends reply back

### Patient Excel Format

| First Name | Last Name | Middle Name | DOB | Gender | DOS | Amount Due | Mobile Number | HomeNumber | Email |
|------------|-----------|-------------|-----|--------|-----|------------|---------------|------------|-------|

Mobile Number can be `4805551234`, `(480) 555-1234`, or `+14805551234` — the Lambda normalises all formats.

### DynamoDB — One Row Per Patient

Table: `sms-conversations` | Partition key: `phone_number` (String)

Each patient has exactly one row:

| Field | Content |
|-------|---------|
| `phone_number` | `+14805551234` (partition key) |
| `patient_name` | `John Smith` |
| `amount_due` | `150.00` |
| `last_outbound_message` | The bill reminder we sent |
| `conversation_history` | Full JSON array of all messages |
| `opt_out` | `true` / `false` |

When a patient replies, the Lambda loads their row, appends the new exchange to `conversation_history`, saves it back. 10 patients = 10 rows, fully independent.

### AI Guardrails on SMS Replies

The `sms-reply` Lambda uses a **whitelist system prompt** — GPT-5.5 can only answer from facts explicitly given to it. Anything outside that list → redirects to 480-406-5664. It is explicitly banned from speculating, guessing, or using words like "I believe" or "probably."

**What it knows:**
- Patient's own balance (from DynamoDB)
- Saturday hours: Chandler location 8 AM–12 Noon
- Office phone: 480-406-5664

**For everything else:** "For more information, please call us at 480-406-5664."

**To add more information the AI can answer** (e.g. weekday hours, payment methods, other locations): open `sms_reply_lambda.py`, add facts under the `FACTS YOU ARE ALLOWED TO SHARE` section in `SYSTEM_PROMPT`, paste into `sms-reply` Lambda, click Deploy. No code changes needed.

### How the UI Connects to SMS

The SMS tab in `dashboard.html` uses the **existing `/chat` API endpoint** — no new API Gateway routes:

| UI Action | Calls | Lambda handles via |
|-----------|-------|-------------------|
| Send Reminders | `POST /chat` `{ action: "trigger_sms" }` | s3-chat invokes sms-send async |
| ↻ Refresh replies | `POST /chat` `{ action: "get_sms_conversations" }` | s3-chat reads DynamoDB |

The `trigger_sms` action uses `InvocationType='Event'` (fire and forget) — the API returns instantly and sms-send runs in the background for as long as needed.

---

## AWS Setup — Auth & File Chat

### Resources

| AWS Resource | Name | Purpose |
|-------------|------|---------|
| S3 Bucket | `emr-lab-bucket-699092321120-us-east-2-an` | All uploaded files under `uploads/` prefix |
| Lambda | `s3-upload-lambda` | Generates pre-signed upload URLs |
| Lambda | `s3-chat` | Chat, file listing, combined queries, SMS trigger, SMS conversations |
| Lambda Layer | `s3-chat-layer` | openpyxl, pypdf, python-docx, xlrd |
| API Gateway | HTTP API | `aoqop7lkph.execute-api.us-east-2.amazonaws.com` |
| IAM Role | `s3-upload-lambda-role` | Permissions for both file Lambdas |

### S3 Bucket CORS Policy

```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["PUT", "POST"],
  "AllowedOrigins": ["https://kanikayears.com"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

### IAM Role — `s3-upload-lambda-role`

All policies are attached to this one role. Both file Lambdas use it.

**Inline Policy — `s3-put-emr-lab-bucket`**
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

**Inline Policy — `s3-read-list-emr-lab-bucket`**
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

> Note: `s3:GetObject` uses `/*` (targets objects inside bucket). `s3:ListBucket` uses no `/*` (targets the bucket itself). Both are required. Missing `s3:ListBucket` causes Load Stored Files to fail with 500 even though upload and chat work fine.

**AWS Managed Policy:** `AmazonDynamoDBFullAccess`

**Inline Policy — `Invoke_function`** (allows s3-chat to trigger sms-send)
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "lambda:InvokeFunction",
    "Resource": "arn:aws:lambda:us-east-2:699092321120:function:sms-send"
  }]
}
```

### Lambda Layer (s3-chat-layer)

Built in AWS CloudShell (must use CloudShell — Lambda runs Amazon Linux Python 3.12, packages with compiled extensions must be built on matching OS):

```bash
mkdir python
pip install openpyxl pypdf python-docx xlrd -t python/ --quiet
zip -r layer.zip python/
aws lambda publish-layer-version \
  --layer-name s3-chat-layer \
  --zip-file fileb://layer.zip \
  --compatible-runtimes python3.12
```

### Lambda Functions — File Chat

**`s3-upload-lambda`** (`lambda_function.py`)
- Runtime: Python 3.12 | Role: `s3-upload-lambda-role` | Timeout: 30s
- Env vars: `BUCKET_NAME`, `BUCKET_REGION`, `ALLOWED_ORIGINS`
- Files stored at `uploads/<filename>` (not bucket root)

**`s3-chat`** (`chat_lambda_function.py`)
- Runtime: Python 3.12 | Role: `s3-upload-lambda-role` | Layer: `s3-chat-layer` | Timeout: 5 min
- Env vars:

| Variable | Value |
|----------|-------|
| `BUCKET_NAME` | `emr-lab-bucket-699092321120-us-east-2-an` |
| `BUCKET_REGION` | `us-east-2` |
| `ALLOWED_ORIGINS` | `https://kanikayears.com` |
| `OPENROUTER_API_KEY` | `sk-or-...` — never put anywhere else |
| `DYNAMODB_TABLE` | `sms-conversations` |
| `SMS_SEND_FUNCTION` | `sms-send` |

Actions handled by s3-chat:

| `action` in request body | What it does |
|--------------------------|-------------|
| `list_files` | Lists all files in S3 uploads/ |
| *(none — has `s3_key`)* | Single file chat |
| *(none — has `s3_keys`)* | Combined multi-file chat |
| `trigger_sms` | Invokes sms-send Lambda asynchronously |
| `get_sms_conversations` | Reads all rows from DynamoDB |

### API Gateway Routes

| Route | Lambda | URL |
|-------|--------|-----|
| `POST /get-upload-url` | `s3-upload-lambda` | `https://aoqop7lkph.execute-api.us-east-2.amazonaws.com/get-upload-url` |
| `POST /chat` | `s3-chat` | `https://aoqop7lkph.execute-api.us-east-2.amazonaws.com/chat` |

---

## AWS Setup — SMS System

### Resources

| AWS Resource | Name / Value | Purpose |
|-------------|-------------|---------|
| DynamoDB Table | `sms-conversations` | Stores per-patient SMS conversation history |
| Lambda | `sms-send` | Reads patient Excel, sends bill reminders |
| Lambda | `sms-reply` | Handles inbound patient SMS, calls GPT-5.5 |
| SNS Topic | `sms-inbound-replies` | Routes inbound SMS to sms-reply Lambda |
| End User Messaging phone | `+18557684735` (toll-free) | Sends and receives SMS |
| IAM Role | `sms-lambda-role` | Permissions for sms-send and sms-reply |

### DynamoDB Table

- Table name: `sms-conversations`
- Partition key: `phone_number` (String)
- Capacity: On-demand
- Region: `us-east-2`

### IAM Role — `sms-lambda-role`

Attach these AWS managed policies:

| Policy | Why |
|--------|-----|
| `AmazonS3ReadOnlyAccess` | sms-send reads patient Excel from S3 |
| `AmazonDynamoDBFullAccess` | Both Lambdas read/write conversation history |
| `AmazonPinpointSMSVoiceV2FullAccess` | Sending SMS via End User Messaging |
| `AWSLambdaBasicExecutionRole` | CloudWatch logging |

### Lambda Functions — SMS

**`sms-send`** (`sms_send_lambda.py`)
- Runtime: Python 3.12 | Role: `sms-lambda-role` | Layer: `s3-chat-layer` | Timeout: 5 min
- Triggered manually via portal UI (or on a schedule)
- Env vars:

| Variable | Value |
|----------|-------|
| `BUCKET_NAME` | `emr-lab-bucket-699092321120-us-east-2-an` |
| `DYNAMODB_TABLE` | `sms-conversations` |
| `ORIGINATION_NUMBER` | `+18557684735` |

**`sms-reply`** (`sms_reply_lambda.py`)
- Runtime: Python 3.12 | Role: `sms-lambda-role` | Timeout: 30s
- Triggered by SNS topic `sms-inbound-replies`
- Env vars:

| Variable | Value |
|----------|-------|
| `DYNAMODB_TABLE` | `sms-conversations` |
| `ORIGINATION_NUMBER` | `+18557684735` |
| `OPENROUTER_API_KEY` | `sk-or-...` — never put anywhere else |

### End User Messaging Setup

1. **Request toll-free number** — End User Messaging → Phone numbers → Request originator → Toll-free → US → SMS
2. **Enable two-way SMS** — click the number → Edit → Two-way SMS → enable → SNS topic → select `sms-inbound-replies`
3. **Register the number** (toll-free verification form) — company name, website (kanikayears.com), use case (medical billing reminders), opt-in method (patient intake), sample message
4. **Wait for Active status** — typically 24–72 hours. Number accepts API calls while Pending but carrier does not deliver messages.

### SNS → Lambda Connection

In `sms-reply` Lambda → Configuration → Triggers → Add trigger → SNS → select `sms-inbound-replies`.

This means every patient reply automatically triggers sms-reply. No polling needed.

---

## AWS Setup — Structured Query (DuckDB)

### Resources

| AWS Resource | Name / Value | Purpose |
|-------------|-------------|---------|
| Lambda | `structured-query` | DuckDB SQL Q&A for CSV/TXT/Excel |
| Lambda Function URL | `https://dohvyhfsuxvkp76tncjg3lnjuu0xcaxc.lambda-url.us-east-2.on.aws/` | Direct HTTPS entry point — no API Gateway route, no 29s timeout ceiling |
| Lambda Layer | `structured-query-deps` | duckdb, openpyxl, xlrd |
| IAM Role | `structured-query-role-sstga4p0` | Auto-created when the function was made "from scratch" — separate from `s3-upload-lambda-role` |

### Lambda Layer — Build With the Correct Python ABI

Building this in CloudShell with a plain `pip install duckdb ...` can silently grab a wheel built for CloudShell's own Python version, not Lambda's Python 3.12 runtime — this fails at runtime with `No module named '_duckdb'` even though the layer attaches fine. Force the exact platform/version instead:

```bash
mkdir -p python
pip install \
  --platform manylinux2014_x86_64 \
  --target=python \
  --implementation cp \
  --python-version 3.12 \
  --only-binary=:all: \
  duckdb openpyxl xlrd

zip -r layer.zip python/
aws lambda publish-layer-version \
  --layer-name structured-query-deps \
  --zip-file fileb://layer.zip \
  --compatible-runtimes python3.12 \
  --compatible-architectures x86_64 \
  --region us-east-2
```

The function's **Configuration → General configuration → Architecture** must be `x86_64` to match.

### IAM — S3 Read Permission

The auto-created execution role has no S3 access by default. Add:

```bash
aws iam put-role-policy \
  --role-name structured-query-role-sstga4p0 \
  --policy-name s3-get-emr-lab-bucket \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::emr-lab-bucket-699092321120-us-east-2-an/*"
    }]
  }'
```

### Lambda Function — `structured-query`

- Runtime: Python 3.12 | Role: `structured-query-role-sstga4p0` | Layer: `structured-query-deps`
- Timeout: 1 min | Memory: 1024 MB | Ephemeral storage (/tmp): 2048 MB (Excel path only — CSV/TXT never touch disk)
- Env vars:

| Variable | Value |
|----------|-------|
| `BUCKET_NAME` | `emr-lab-bucket-699092321120-us-east-2-an` |
| `BUCKET_REGION` | `us-east-2` |
| `ALLOWED_ORIGINS` | `https://kanikayears.com` |
| `OPENROUTER_API_KEY` | `sk-or-...` — same key used elsewhere |
| `LLM_MODEL` | `anthropic/claude-sonnet-4-5` |

### Function URL & CORS — Important Gotcha

CORS is configured **only** on the Function URL itself (Configuration → Function URL → CORS: Allow origin `https://kanikayears.com`, Allow headers `content-type`, Allow methods `POST`). AWS injects the `Access-Control-Allow-*` headers automatically on every response once this is set — including real POST responses, not just the OPTIONS preflight.

**Do not also set these headers inside the Lambda code.** Doing so produces a browser error like:
> `Access-Control-Allow-Origin' header contains multiple values 'https://kanikayears.com, https://kanikayears.com', but only one is allowed`

`curl` won't catch this — it doesn't enforce CORS — so this only surfaces once the browser makes the real request. `resp()` in `structured_query_lambda_function.py` returns `headers: {}` on every response for exactly this reason.

### How dashboard.html Decides Which Path to Use

```javascript
var STRUCTURED_QUERY_ENDPOINT = "https://dohvyhfsuxvkp76tncjg3lnjuu0xcaxc.lambda-url.us-east-2.on.aws/";
var STRUCTURED_QUERY_EXTENSIONS = ["csv", "txt", "xlsx", "xls"];
```

`askQuestion(key, question, chatHistory)` tries `STRUCTURED_QUERY_ENDPOINT` first for those extensions, and falls back to `CHAT_ENDPOINT` on any failure — used by Per File Chat and Ask Each File. Combined Answer always uses `CHAT_ENDPOINT` directly (see [How the AI Works](#how-the-ai-works) for why).

Full step-by-step deployment walkthrough: `STRUCTURED_QUERY_SETUP.md`.

---

## Firebase & EmailJS Setup

### Firebase

Project: `hipaa-877ca`. Only Firebase Authentication is used — no Firestore.

**Authorized Domains** (Firebase Console → Authentication → Settings):
- `localhost`
- `ramanuja125.github.io`
- `kanikayears.com`

Firebase config in `auth.js` (apiKey, projectId etc.) is safe to be public — access is controlled by the Authorized Domains list, not by keeping config secret.

### EmailJS

| Value | ID |
|-------|-----|
| Account | kanikayears@gmail.com |
| Service ID | `service_xkqj0hk` |
| Template ID | `template_itledcu` |
| Public Key | `TTVqGUIKfCVoS2Sbz` |

Template variables: `{{to_email}}` and `{{otp_code}}`. Public Key is safe to expose — it only allows sending through your own templates.

---

## File Structure

```
/
├── index.html                   → Login page (email + password)
├── register.html                → New user registration
├── verify.html                  → OTP entry (2FA step)
├── dashboard.html               → Main page: upload, load stored, AI chat, SMS tab
├── forgot-password.html         → Password reset
├── success.html                 → Post-registration confirmation
├── styles.css                   → Shared styles (Inter font, sizing, all pages)
├── auth.js                      → Firebase + EmailJS logic
│
├── lambda_function.py           → s3-upload-lambda: pre-signed upload URLs
├── chat_lambda_function.py      → s3-chat: file chat, listing, SMS trigger, SMS conversations
├── structured_query_lambda_function.py → structured-query: DuckDB SQL Q&A for CSV/TXT/Excel
├── sms_send_lambda.py           → sms-send: reads Excel, sends bill reminder SMS
├── sms_reply_lambda.py          → sms-reply: handles inbound SMS, GPT-5.5 reply
│
├── cors_policy.json             → S3 bucket CORS configuration
├── sms_setup_guide.md           → Step-by-step SMS AWS setup reference
├── STRUCTURED_QUERY_SETUP.md    → Step-by-step DuckDB structured-query AWS setup reference
└── README.md                    → This file
```

---

## Security Architecture

| Concern | How It Is Handled |
|---------|------------------|
| AWS credentials in browser | Never — Lambda generates temporary upload URLs |
| OpenRouter API key in browser | Never — key lives only in Lambda environment variables |
| OpenRouter key in SMS Lambda | Same — only in sms-reply Lambda env vars, never in any file |
| Password storage | Firebase hashes passwords — plaintext never stored |
| OTP storage | Lives only in sessionStorage (browser tab), expires in 10 minutes |
| Session persistence | sessionStorage — clears when tab closes |
| Pre-signed URL abuse | Expires in 15 minutes, scoped to one file key |
| S3 files publicly readable | Block All Public Access enabled — files are private |
| Cross-origin attacks | CORS headers on Lambdas restrict to kanikayears.com only |
| Patient SMS data | Stored only in DynamoDB (AWS-managed, encrypted at rest by default) |
| SMS AI hallucination | Whitelist system prompt — AI can only answer from explicitly listed facts |
| Patient data in SMS | Only patient's own name and balance sent to GPT-5.5 for their reply |
| Structured-query SQL injection | LLM-generated SQL is checked against a keyword blocklist (no INSERT/UPDATE/DELETE/DROP/ATTACH/PRAGMA/etc.) and only the first statement is executed — no stacked queries |
| Structured-query IAM scope | Dedicated role (`structured-query-role-sstga4p0`) with only `s3:GetObject` — no write access, no other AWS resources reachable |

---

## How to Change Things

**Change the AI model (file chat, SMS, or structured query):**
- File chat: in `chat_lambda_function.py`, update `"model": "openai/gpt-5.5"` to any OpenRouter model. Redeploy s3-chat.
- SMS replies: in `sms_reply_lambda.py`, same field. Redeploy sms-reply.
- Structured query: update the `LLM_MODEL` env var on the `structured-query` Lambda — no code change needed.

**Add more file types to the structured-query fast path:**
- Currently CSV/TXT/XLSX/XLS only. Add the extension to `TABULAR_EXTENSIONS` and `STRUCTURED_QUERY_EXTENSIONS` (in `dashboard.html`), then add a loader branch in `structured_query_lambda_function.py` — DuckDB has no native reader for most other formats, so this usually means converting to CSV first, same as the Excel path.

**Give Combined Answer real SQL joins across files:**
- Not implemented — every selected file would need to be tabular and share a joinable column, and it can't help at all with mixed file types (PDF + CSV together). Currently Combined Answer always uses the full-text `/chat` path on purpose. Revisit only if cross-file structured questions become a frequent, all-tabular use case.

**Add more information the SMS AI can answer:**
- Open `sms_reply_lambda.py`
- Find the `FACTS YOU ARE ALLOWED TO SHARE` section in `SYSTEM_PROMPT`
- Add the new facts (e.g. weekday hours, accepted insurances, payment portal URL)
- Paste into sms-reply Lambda → Deploy. No code changes needed.

**Change the SMS phone number:**
- Update `ORIGINATION_NUMBER` env var on both `sms-send` and `sms-reply` Lambdas

**Change the S3 bucket:**
- Create new bucket, apply cors_policy.json, update IAM policy ARNs, update `BUCKET_NAME` on all Lambdas

**Rotate the OpenRouter API key:**
- openrouter.ai → Keys → new key → update `OPENROUTER_API_KEY` on `s3-chat` and `sms-reply`

**Rotate the EmailJS public key:**
- emailjs.com → Account → regenerate → update `EMAILJS_PUBLIC_KEY` in `auth.js`

**Add a new API Gateway route:**
- API Gateway → your HTTP API → Routes → Create → method + path → attach Lambda integration → auto-deploys

**Add a scheduled SMS blast (e.g. every Monday morning):**
- Lambda → sms-send → Add trigger → EventBridge (CloudWatch Events) → Schedule expression: `cron(0 14 ? * MON *)` (9 AM Arizona time = 14:00 UTC)
- Pass `{ "excel_key": "uploads/patients.xlsx" }` as the event
