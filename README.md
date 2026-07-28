# juniper-crm-app

## Cloud SQL / Local Development

### Cloud SQL Instance Connection Strings

| Environment | Connection Name |
|-------------|----------------|
| Production  | `juniper-crm-498215-p5:us-central1:juniper-prod` |
| Staging     | `juniper-crm-498215-p5:us-central1:juniper-dev` |

### Required Secret Manager Secrets

**Production** (Secret Manager secrets in `juniper-crm-498215-p5`):
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DB`

**Staging** (Secret Manager secrets in `juniper-crm-498215-p5`):
- `MYSQL_USER_STAGING`
- `MYSQL_PASSWORD_STAGING`
- `MYSQL_DB_STAGING`

These secrets must be provisioned manually in Secret Manager before deploying. Cloud Build injects them into Cloud Run at deploy time via `--set-secrets`.

### Running Locally

The app connects to Cloud SQL via a Unix socket in Cloud Run. For local development, use the Cloud SQL Auth Proxy to expose the instance over TCP on port 3306.

**1. Start the proxy (staging/dev instance — do not develop against prod):**

```bash
cloud-sql-proxy juniper-crm-498215-p5:us-central1:juniper-dev --port 3306
```

**2. Set environment variables in `.env`:**

```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=...
MYSQL_PASSWORD=...
MYSQL_DB=crm
```

**3. Start the API server:**

```bash
uvicorn api.server:app --reload --port 8000
```

> Note: `run_dev.py` has been removed. It was only needed for BigQuery ADC token injection, which is not required for MySQL. Use `uvicorn` directly as shown above.
