# ── Stage 1: build React ──────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/studio
COPY studio/package*.json ./
RUN npm ci
COPY studio/ ./
RUN npm run build

# ── Stage 2: Python API ───────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./api/
COPY --from=frontend /app/studio/dist ./dist

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8080"]
