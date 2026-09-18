"""Deploy-config guard for the GCS intake-attachment feature.

api/attachments.py reads five env vars at import time. This test pins the
ops contract: every var must be documented in .env.example and set on the
Cloud Run deploy step in BOTH cloudbuild configs — otherwise a live upload
fails at runtime with an empty bucket name.

No network, no GCP — pure file parsing.
"""
from __future__ import annotations

import pathlib
import re

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]

GCS_ENV_VARS = [
    "GCS_ATTACHMENTS_BUCKET",
    "GCS_CREDENTIALS_BUCKET",
    "GCS_SIGNER_SA_EMAIL",
    "GCS_MAX_UPLOAD_BYTES",
    "GCS_SIGNED_URL_TTL_MIN",
    "CORS_EXTRA_ORIGINS",
]


def _deploy_env_vars(cloudbuild_path: pathlib.Path) -> dict[str, str]:
    """Return the KEY=VALUE map from the deploy step's --set-env-vars flag.

    Handles both the default comma delimiter and the ^SEP^ custom-delimiter
    syntax used by `gcloud run deploy` (e.g. `^##^KEY=val##KEY=val`).
    """
    doc = yaml.safe_load(cloudbuild_path.read_text())
    for step in doc["steps"]:
        args = step.get("args") or []
        if not any(a == "deploy" for a in args if isinstance(a, str)):
            continue
        for arg in args:
            if isinstance(arg, str) and arg.startswith("--set-env-vars="):
                blob = arg.split("=", 1)[1]
                # ^SEP^ prefix: delimiter is the string between the first two ^
                if blob.startswith("^"):
                    sep, _, blob = blob[1:].partition("^")
                else:
                    sep = ","
                pairs = blob.split(sep)
                return dict(p.split("=", 1) for p in pairs if "=" in p)
    raise AssertionError(f"no deploy step with --set-env-vars in {cloudbuild_path.name}")


def test_env_example_documents_all_gcs_vars():
    text = (REPO_ROOT / ".env.example").read_text()
    for var in GCS_ENV_VARS:
        assert re.search(rf"^{var}=", text, re.M), f"{var} missing from .env.example"


def test_cloudbuild_prod_sets_all_gcs_vars():
    env = _deploy_env_vars(REPO_ROOT / "cloudbuild.yaml")
    for var in GCS_ENV_VARS:
        assert var in env, f"{var} missing from cloudbuild.yaml --set-env-vars"
    assert env["GCS_ATTACHMENTS_BUCKET"], "prod bucket name must be non-empty"
    assert "staging" not in env["GCS_ATTACHMENTS_BUCKET"], "prod deploy must not use the staging bucket"


def test_cloudbuild_staging_sets_all_gcs_vars():
    env = _deploy_env_vars(REPO_ROOT / "cloudbuild.staging.yaml")
    for var in GCS_ENV_VARS:
        assert var in env, f"{var} missing from cloudbuild.staging.yaml --set-env-vars"
    assert env["GCS_ATTACHMENTS_BUCKET"], "staging bucket name must be non-empty"


def test_prod_and_staging_buckets_are_separate():
    prod = _deploy_env_vars(REPO_ROOT / "cloudbuild.yaml")["GCS_ATTACHMENTS_BUCKET"]
    staging = _deploy_env_vars(REPO_ROOT / "cloudbuild.staging.yaml")["GCS_ATTACHMENTS_BUCKET"]
    assert prod != staging, "prod and staging must not share an attachments bucket"


def test_credentials_bucket_is_prod_in_both_environments():
    """Both staging and prod must read/write credential documents from the prod bucket.

    This enforces the single-source-of-truth contract: update a license or insurance
    document once in the prod bucket and both environments immediately reflect it.
    """
    prod_env = _deploy_env_vars(REPO_ROOT / "cloudbuild.yaml")
    staging_env = _deploy_env_vars(REPO_ROOT / "cloudbuild.staging.yaml")
    prod_bucket = prod_env["GCS_ATTACHMENTS_BUCKET"]  # juniper-crm-attachments-prod

    assert prod_env["GCS_CREDENTIALS_BUCKET"] == prod_bucket, (
        "prod GCS_CREDENTIALS_BUCKET must equal GCS_ATTACHMENTS_BUCKET (the prod bucket)"
    )
    assert staging_env["GCS_CREDENTIALS_BUCKET"] == prod_bucket, (
        "staging GCS_CREDENTIALS_BUCKET must point to the prod bucket, not the staging bucket"
    )


def test_numeric_gcs_vars_parse_like_attachments_module():
    """api/attachments.py does int(...) on these at import — a bad value crashes the app."""
    for path in ("cloudbuild.yaml", "cloudbuild.staging.yaml"):
        env = _deploy_env_vars(REPO_ROOT / path)
        int(env["GCS_MAX_UPLOAD_BYTES"])
        int(env["GCS_SIGNED_URL_TTL_MIN"])
