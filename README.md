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

## GCS Intake Attachments (Handoff 26)

`api/attachments.py` stores estimating intake PDFs in GCS (browser PUTs bytes
directly via a backend-minted resumable session; downloads use v4 signed URLs
via IAM signBlob). It reads five env vars, all documented in `.env.example` and
set on both Cloud Run deploys via `--set-env-vars` in `cloudbuild.yaml` /
`cloudbuild.staging.yaml`:

| Var | Prod | Staging |
|-----|------|---------|
| `GCS_ATTACHMENTS_BUCKET` | `juniper-crm-attachments-prod` | `juniper-crm-attachments-staging` |
| `GCS_SIGNER_SA_EMAIL` | Cloud Run runtime SA (default compute SA) | same |
| `GCS_MAX_UPLOAD_BYTES` | `2147483648` (2 GiB) | same |
| `GCS_SIGNED_URL_TTL_MIN` | `10` | same |
| `CORS_EXTRA_ORIGINS` | prod Cloud Run URL | staging Cloud Run URL |

None of these are secrets, so they follow the repo's plain `--set-env-vars`
convention (Secret Manager is only used for credentials).

### One-time provisioning (run once per environment, needs GCP admin)

```bash
./scripts/provision_gcs_attachments.sh staging
./scripts/provision_gcs_attachments.sh prod
```

This creates the bucket (uniform access, public-access prevention), sets bucket
CORS for the app origins + localhost dev ports, grants the runtime SA
`roles/storage.objectAdmin` on the bucket and `roles/iam.serviceAccountTokenCreator`
on itself (required for signed URLs per `api/attachments.py`), and enables
`iamcredentials.googleapis.com`.

If the Cloud Run service is ever moved to a dedicated service account, update
`GCS_SIGNER_SA_EMAIL` in the cloudbuild files and re-run the provisioning script.
If a custom domain is added, append it to `CORS_EXTRA_ORIGINS` in the cloudbuild
files **and** to the bucket CORS config (re-run the script after editing it).

### Staging end-to-end check

After deploying staging with the vars set:

```bash
API_BASE=https://juniper-crm-staging-<project-number>.us-central1.run.app \
AUTH_TOKEN=<staging jwt> \
ESTIMATE_ID=<existing staging estimate id> \
./scripts/verify_gcs_attachments_staging.sh
```

This exercises presign → PUT-to-GCS → confirm → signed download URL and
byte-compares the round-trip. Deploy-config drift is guarded by
`tests/test_gcs_deploy_config.py`.
