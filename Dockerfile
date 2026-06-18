# ── Stage 1: build React ──────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/studio
COPY studio/package*.json ./
RUN npm ci
COPY studio/ ./
ARG VITE_ENTRA_CLIENT_ID
ARG VITE_ENTRA_TENANT_ID
RUN npm run build

# ── Stage 2: Python API ───────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN --mount=type=secret,id=github_token \
    TOKEN=$(cat /run/secrets/github_token) \
    && pip install --no-cache-dir \
        "juniper-crm-shared @ git+https://${TOKEN}@github.com/juniperlandscaping/juniper-crm-shared.git@main" \
        -r requirements.txt

COPY api/ ./api/
COPY --from=frontend /app/studio/dist ./dist

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8080"]
