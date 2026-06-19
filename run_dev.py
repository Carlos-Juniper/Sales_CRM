"""
Dev startup wrapper: injects a fresh gcloud access token into the BigQuery
client before launching uvicorn, working around expired ADC credentials.
"""
import subprocess
import sys
import os

# Get a fresh token from the already-authenticated gcloud user
token = subprocess.check_output(
    ["gcloud", "auth", "print-access-token"], text=True
).strip()

# Patch the BQ client before the app module is imported
from google.oauth2.credentials import Credentials
from google.cloud import bigquery
import db
db._client = bigquery.Client(
    project=os.environ.get("GCP_PROJECT", "juniper-crm-498215-p5"),
    credentials=Credentials(token=token),
)

# Now start the ASGI app normally
import uvicorn
uvicorn.run("api.server:app", host="127.0.0.1", port=8000, reload=False)
