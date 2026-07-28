"""
Local development launcher.

Starts:
  1. Cloud SQL Auth Proxy (TCP on localhost:3306)
  2. FastAPI backend   (uvicorn, port 8000, --reload)
  3. Vite frontend     (port 5173)

Requirements:
  - cloud-sql-proxy installed (brew install cloud-sql-proxy)
  - .env file filled in at the repo root
  - studio/node_modules installed (npm install inside studio/)

Usage:
  python run_dev.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent

# ── Load .env ────────────────────────────────────────────────────────────────
env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())

# ── Config ───────────────────────────────────────────────────────────────────
CLOUD_SQL_INSTANCE = os.environ.get(
    "CLOUD_SQL_INSTANCE",
    "juniper-crm-498215-p5:us-central1:juniper-dev",
)
MYSQL_PORT    = os.environ.get("MYSQL_PORT", "3306")

VENV_PYTHON   = ROOT / ".venv" / "bin" / "python"
VENV_UVICORN  = ROOT / ".venv" / "bin" / "uvicorn"
STUDIO_DIR    = ROOT / "studio"

procs: list[subprocess.Popen] = []


def start(label: str, cmd: list[str], **kwargs) -> subprocess.Popen:
    print(f"[run_dev] starting {label}…")
    p = subprocess.Popen(cmd, **kwargs)
    procs.append(p)
    return p


try:
    # 1. Cloud SQL Auth Proxy
    proxy = start(
        "cloud-sql-proxy",
        ["cloud-sql-proxy", CLOUD_SQL_INSTANCE, f"--port={MYSQL_PORT}"],
    )
    time.sleep(2)  # give proxy a moment before the backend tries to connect

    # 2. FastAPI backend
    backend_env = {**os.environ}
    start(
        "uvicorn (API :8000)",
        [str(VENV_UVICORN), "api.server:app", "--reload", "--port", "8000"],
        cwd=str(ROOT),
        env=backend_env,
    )

    # 3. Vite frontend
    vite_bin = STUDIO_DIR / "node_modules" / ".bin" / "vite"
    start(
        "vite (frontend :5173)",
        [str(vite_bin)],
        cwd=str(STUDIO_DIR),
    )

    print("\n[run_dev] all services started")
    print("  Frontend → http://localhost:5173")
    print("  API      → http://localhost:8000")
    print("  Press Ctrl+C to stop all.\n")

    # Wait for any process to exit
    while True:
        for p in procs:
            if p.poll() is not None:
                print(f"[run_dev] a process exited (pid {p.pid}), shutting down")
                raise KeyboardInterrupt
        time.sleep(1)

except KeyboardInterrupt:
    print("\n[run_dev] stopping…")
    for p in procs:
        p.terminate()
    for p in procs:
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
    sys.exit(0)
