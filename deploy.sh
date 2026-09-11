#!/usr/bin/env bash
# Deploys Iudicium to Cloud Run in asia-south1 (Mumbai).
# Cloud Run's free quota (2M requests, 180k vCPU-sec, 360k GiB-sec/month)
# applies in this region at the same rate as the US, unlike Compute
# Engine's free VM, which only works in 3 US regions.
#
# Before running:
#   1. Install/auth the gcloud CLI: https://cloud.google.com/sdk/docs/install
#   2. Put ONLY your raw Gemini API key (no quotes, no newline issues) in
#      a local file, e.g. `echo -n "your-key" > gemini_key.txt`
#   3. Copy the accompanying .dockerignore into the project root (next to
#      the Dockerfile) so .env, .git, and old output/debug files never
#      get baked into the image.
#   4. Edit the variables below.

set -euo pipefail

PROJECT_ID="iudicium-508320"
REGION="asia-south1"              # Mumbai. asia-south2 (Delhi) is Tier-2 priced -- costs more once you exceed the free quota.
SERVICE_NAME="iudicium"
GEMINI_KEY_FILE="./gemini_key.txt"
SECRET_NAME="iudicium-gemini-key"

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com

# Store the LLM key in Secret Manager instead of an env var baked into
# the image or committed anywhere.
if gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  gcloud secrets versions add "$SECRET_NAME" --data-file="$GEMINI_KEY_FILE"
else
  gcloud secrets create "$SECRET_NAME" --data-file="$GEMINI_KEY_FILE"
fi

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --cpu 2 \
  --memory 2Gi \
  --no-cpu-throttling \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 80 \
  --timeout 3600 \
  --set-env-vars "SCRAPER_HEADLESS=true,LLM_PROVIDER=gemini,GEMINI_MODEL=gemini-3.6-flash,HOST=0.0.0.0" \
  --set-secrets "GEMINI_API_KEY=${SECRET_NAME}:latest"

echo
echo "Deployed. Service URL:"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)'