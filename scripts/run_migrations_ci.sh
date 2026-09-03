#!/usr/bin/env bash
# CI migration runner — called by cloudbuild.staging.yaml before gcloud run deploy.
#
# Starts cloud-sql-proxy on a local TCP port, waits for it to bind, then runs
# scripts/migrate.py.  Non-zero exit propagates to Cloud Build, blocking the
# deploy if migrations fail.
#
# Required env vars (injected via Cloud Build secretEnv):
#   MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
#
# Required env vars (set via Cloud Build step env):
#   CLOUDSQL_INSTANCE  e.g. juniper-crm-498215-p5:us-central1:juniper-dev
set -euo pipefail

: "${CLOUDSQL_INSTANCE:?CLOUDSQL_INSTANCE must be set}"
: "${MYSQL_USER:?MYSQL_USER must be set (secretEnv)}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD must be set (secretEnv)}"
: "${MYSQL_DB:?MYSQL_DB must be set (secretEnv)}"

MYSQL_PORT=3307
PROXY_VERSION=v2.14.2
PROXY_URL="https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/${PROXY_VERSION}/cloud-sql-proxy.linux.amd64"

echo "==> Installing pymysql"
# --break-system-packages: this container is disposable per-build (PEP 668
# blocks system-wide pip installs on the cloud-sdk image's Debian/Python 3.13
# base) — safe here since nothing else on the image depends on this env.
pip install --quiet --break-system-packages "pymysql==1.1.1"

echo "==> Downloading cloud-sql-proxy ${PROXY_VERSION}"
curl -fsSL -o /usr/local/bin/cloud-sql-proxy "${PROXY_URL}"
# SHA256 from https://github.com/GoogleCloudPlatform/cloud-sql-proxy/releases/tag/v2.14.2
echo "2f819e6e47e9026fa467cf55ca88eb674c698f8a93aecf940a364b4432c933f5  /usr/local/bin/cloud-sql-proxy" \
  | sha256sum --check --status || {
    echo "ERROR: cloud-sql-proxy binary failed SHA256 verification" >&2
    exit 1
  }
chmod +x /usr/local/bin/cloud-sql-proxy

echo "==> Starting cloud-sql-proxy for ${CLOUDSQL_INSTANCE} on port ${MYSQL_PORT}"
cloud-sql-proxy "--port=${MYSQL_PORT}" "${CLOUDSQL_INSTANCE}" &
PROXY_PID=$!

# Wait up to 20s for the proxy to be ready
READY=0
for i in $(seq 1 20); do
  sleep 1
  python3 -c "
import socket, sys
s = socket.socket()
s.settimeout(1)
try:
    s.connect(('127.0.0.1', ${MYSQL_PORT}))
    s.close()
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null && READY=1 && break
done

if [ "${READY}" -ne 1 ]; then
  echo "ERROR: cloud-sql-proxy did not bind on port ${MYSQL_PORT} within 20s" >&2
  kill "${PROXY_PID}" 2>/dev/null || true
  exit 1
fi

echo "==> Proxy ready — running migrations"
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT
# MYSQL_USER / MYSQL_PASSWORD / MYSQL_DB already in env from secretEnv
python3 -m scripts.migrate
MIGRATE_EXIT=$?

kill "${PROXY_PID}" 2>/dev/null || true
exit "${MIGRATE_EXIT}"
