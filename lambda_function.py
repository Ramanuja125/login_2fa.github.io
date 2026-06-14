import json
import boto3
import os
import re
from botocore.exceptions import ClientError

# ── CONFIG (set these as Lambda Environment Variables) ────────────
# BUCKET_NAME  = your S3 bucket name  (default: emr-lab-bucket)
# BUCKET_REGION = AWS region           (default: us-west-2)
# ALLOWED_ORIGIN = your GitHub Pages URL
# ─────────────────────────────────────────────────────────────────

BUCKET_NAME    = os.environ.get("BUCKET_NAME",    "emr-lab-bucket")
BUCKET_REGION  = os.environ.get("BUCKET_REGION",  "us-west-2")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://ramanuja125.github.io")

CORS_HEADERS = {
    "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}


def lambda_handler(event, context):
    # Handle CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        body     = json.loads(event.get("body") or "{}")
        filename = body.get("filename", "").strip()

        if not filename:
            return _response(400, {"error": "filename is required"})

        # Sanitise: keep letters, digits, dots, dashes, underscores
        safe_name = re.sub(r"[^a-zA-Z0-9.\-_]", "_", filename)

        s3 = boto3.client("s3", region_name=BUCKET_REGION)

        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key":    f"uploads/{safe_name}",
            },
            ExpiresIn=900,   # 15 minutes
        )

        return _response(200, {
            "upload_url": upload_url,
            "key":        f"uploads/{safe_name}",
        })

    except ClientError as e:
        print("ClientError:", e)
        return _response(500, {"error": "Could not generate upload URL", "detail": str(e)})

    except Exception as e:
        print("Unexpected error:", e)
        return _response(500, {"error": "Internal server error"})


def _response(status_code, body_dict):
    return {
        "statusCode": status_code,
        "headers":    CORS_HEADERS,
        "body":       json.dumps(body_dict),
    }
