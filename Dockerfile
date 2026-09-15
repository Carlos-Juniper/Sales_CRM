# ── Stage 1: build React ──────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/studio
COPY studio/package*.json ./
RUN npm ci
COPY studio/ ./
ARG VITE_ENTRA_CLIENT_ID
ARG VITE_ENTRA_TENANT_ID
# Company info baked into the frontend bundle (VITE_) and read by the backend
# renderer (proposal_validation.py) at runtime via os.environ.
ARG VITE_COMPANY_NAME
ARG VITE_COMPANY_PHONE
ARG VITE_COMPANY_EMAIL
ARG VITE_COMPANY_WEBSITE
ARG VITE_COMPANY_ADDRESS
RUN npm run build

# ── Stage 2: Python API ───────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install --with-deps chromium
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY db.py .
COPY api/ ./api/
COPY --from=frontend /app/studio/dist ./dist

# Re-declare the company ARGs from Stage 1 so they are in scope in Stage 2.
# These become runtime env vars consumed by proposal_validation.py (os.environ).
ARG VITE_COMPANY_NAME
ARG VITE_COMPANY_ADDRESS
ENV VITE_COMPANY_NAME=$VITE_COMPANY_NAME
ENV VITE_COMPANY_ADDRESS=$VITE_COMPANY_ADDRESS

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8080"]
