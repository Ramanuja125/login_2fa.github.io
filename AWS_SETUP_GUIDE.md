# AWS Setup Guide — S3 File Upload

Everything you need to connect your login portal to S3.

---

## Overview

After login, users land on `upload.html`. When they upload a file:

1. The browser calls your **API Gateway** endpoint
2. API Gateway triggers a **Lambda** function
3. Lambda generates a **pre-signed S3 URL** (valid 15 min)
4. The browser uploads the file **directly to S3** using that URL

Your AWS credentials are never exposed to the browser.

---

## Step 1 — Create the S3 Bucket

1. Go to [https://s3.console.aws.amazon.com](https://s3.console.aws.amazon.com)
2. Click **Create bucket**
3. Settings:
   - **Bucket name**: `emr-lab-bucket`
   - **Region**: `us-west-2`
   - **Block all public access**: ✅ ON (keep private)
   - Everything else: leave as default
4. Click **Create bucket**

---

## Step 2 — Add CORS to the Bucket

1. Open the bucket → **Permissions** tab
2. Scroll to **Cross-origin resource sharing (CORS)**
3. Click **Edit** and paste the contents of `cors_policy.json`:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT"],
    "AllowedOrigins": ["https://ramanuja125.github.io"],
    "ExposeHeaders":  ["ETag"],
    "MaxAgeSeconds":  3000
  }
]
```

4. Click **Save changes**

---

## Step 3 — Create the Lambda Execution Role

This is the role Lambda will use to access S3.

1. Go to [https://console.aws.amazon.com/iam](https://console.aws.amazon.com/iam)
2. Left menu → **Roles** → **Create role**
3. **Trusted entity**: AWS service → **Lambda** → Next
4. Search and attach: `AWSLambdaBasicExecutionRole` → Next
5. **Role name**: `s3-upload-lambda-role`
6. Click **Create role**

Now add the S3 permission:

7. Open the role you just created
8. **Add permissions** → **Create inline policy**
9. Switch to the **JSON** tab and paste the contents of `iam_policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid":      "AllowS3Upload",
      "Effect":   "Allow",
      "Action":   "s3:PutObject",
      "Resource": "arn:aws:s3:::emr-lab-bucket/*"
    }
  ]
}
```

10. **Policy name**: `s3-put-emr-lab-bucket`
11. Click **Create policy**

---

## Step 4 — Create the Lambda Function

1. Go to [https://console.aws.amazon.com/lambda](https://console.aws.amazon.com/lambda)
2. Click **Create function**
3. Settings:
   - **Author from scratch**
   - **Function name**: `s3-presigned-upload`
   - **Runtime**: `Python 3.12`
   - **Execution role**: Use an existing role → `s3-upload-lambda-role`
4. Click **Create function**

Upload the code:

5. Scroll down to **Code source**
6. Click the file `lambda_function.py` in the editor
7. Select all the existing code and delete it
8. Paste the entire contents of `lambda_function.py` from this folder
9. Click **Deploy**

Set environment variables:

10. Go to **Configuration** tab → **Environment variables** → **Edit**
11. Add these three variables:

| Key             | Value                                  |
|-----------------|----------------------------------------|
| BUCKET_NAME     | emr-lab-bucket                         |
| BUCKET_REGION   | us-west-2                              |
| ALLOWED_ORIGIN  | https://ramanuja125.github.io          |

12. Click **Save**

---

## Step 5 — Create the API Gateway

1. Go to [https://console.aws.amazon.com/apigateway](https://console.aws.amazon.com/apigateway)
2. Click **Create API** → **HTTP API** → **Build**
3. **Add integration**: Lambda → select `s3-presigned-upload`
4. **API name**: `upload-api`
5. Click **Next**

Configure routes:

6. **Method**: POST
7. **Resource path**: `/get-upload-url`
8. Click **Next** → **Next** → **Create**

Enable CORS:

9. Open your new API → left menu → **CORS**
10. Click **Configure**
11. Settings:
    - **Access-Control-Allow-Origin**: `https://ramanuja125.github.io`
    - **Access-Control-Allow-Headers**: `Content-Type`
    - **Access-Control-Allow-Methods**: `POST, OPTIONS`
12. Click **Save**

Get your endpoint URL:

13. Left menu → **Stages**
14. Copy the **Invoke URL** — it looks like:
    `https://abc123xyz.execute-api.us-west-2.amazonaws.com`

Your full endpoint is:
`https://abc123xyz.execute-api.us-west-2.amazonaws.com/get-upload-url`

---

## Step 6 — Wire It Into upload.html

1. Open `upload.html`
2. Find this line near the top of the `<script>` block:

```javascript
const API_ENDPOINT = "https://YOUR_API_GATEWAY_URL/prod/get-upload-url";
```

3. Replace it with your actual URL:

```javascript
const API_ENDPOINT = "https://abc123xyz.execute-api.us-west-2.amazonaws.com/get-upload-url";
```

4. Save the file and push to GitHub

---

## Step 7 — Test It

1. Go to your login page and sign in
2. Complete 2FA
3. On the upload page, pick any file and click **Upload**
4. If it works: you'll see a green success message
5. Verify in S3: open `emr-lab-bucket` → `uploads/` folder → your file should be there

---

## How to Change the Bucket Later

To point uploads to a different bucket:

1. **Create** the new bucket in S3 (repeat Step 1 with the new name)
2. **Apply CORS** to the new bucket (repeat Step 2)
3. **Update IAM policy**: open `iam_policy.json`, change `emr-lab-bucket` to the new name, re-paste into the Lambda role's inline policy
4. **Update Lambda env variable**: Lambda → Configuration → Environment variables → change `BUCKET_NAME`
5. **Nothing to change** in `upload.html` or any other frontend file

---

## Troubleshooting

| Problem | Check |
|---|---|
| "Could not get upload URL" | API Gateway URL in upload.html is wrong or missing |
| "Upload to S3 failed" | CORS policy on the bucket — verify AllowedOrigins matches exactly |
| Files not appearing in bucket | Check Lambda logs in CloudWatch (Lambda → Monitor → View logs) |
| CORS preflight error in browser | API Gateway CORS settings — make sure OPTIONS method is allowed |
| Lambda permission error | IAM inline policy — verify the bucket ARN matches exactly |
