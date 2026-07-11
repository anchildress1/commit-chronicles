#!/usr/bin/env bash
#
# Build and deploy Commit Chronicles to Cloud Run.
#
# The project resources this expects (bucket, Artifact Registry repo, service accounts,
# Secret Manager entry, Cloud Tasks queue) are created once by `make gcp-bootstrap`.
#
# Secrets never appear here. SNOWFLAKE_PAT is mounted from Secret Manager at run time;
# .env is for local development only and is not read by this script.

set -euo pipefail

PROJECT="${PROJECT:-anchildress1}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-commit-chronicles}"
CARD_BUCKET="${CARD_BUCKET:-commit-chronicles-cards}"
TASKS_QUEUE="${TASKS_QUEUE:-commit-chronicles-gen}"
DAILY_GENERATION_CAP="${DAILY_GENERATION_CAP:-50}"
KEEP_REVISIONS="${KEEP_REVISIONS:-3}"

RUN_SA="commit-chronicles-run@${PROJECT}.iam.gserviceaccount.com"
TASKS_SA="commit-chronicles-tasks@${PROJECT}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/commit-chronicles/${SERVICE}"
TAG="$(git rev-parse --short HEAD)"

echo "==> building ${IMAGE}:${TAG}"
gcloud builds submit --tag "${IMAGE}:${TAG}" --project "${PROJECT}"

# The worker URL is the service's own address, which does not exist until the first
# deploy. Look it up if the service is already there; otherwise the first deploy runs
# without a queue and the update below wires it in.
WORKER_URL="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT}" --region "${REGION}" \
  --format 'value(status.url)' 2>/dev/null || true)"

# Cost shape, deliberately:
#   --min-instances 0      scale to zero; an idle day costs nothing
#   (no --no-cpu-throttling) generation runs inside a Cloud Tasks request, so CPU is
#                          billed only while work is actually happening
#   --max-instances 2      a viral card cannot outrun the wallet
#   --concurrency 80       the serving path is bucket reads; one instance absorbs a crowd
echo "==> deploying ${SERVICE}"
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --image "${IMAGE}:${TAG}" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "${RUN_SA}" \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 900 \
  --execution-environment gen2 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT},CARD_BUCKET=${CARD_BUCKET},DAILY_GENERATION_CAP=${DAILY_GENERATION_CAP},SNOWFLAKE_ACCOUNT=${SNOWFLAKE_ACCOUNT:?set SNOWFLAKE_ACCOUNT},SNOWFLAKE_USER=${SNOWFLAKE_USER:?set SNOWFLAKE_USER},TASKS_LOCATION=${REGION},TASKS_QUEUE=${TASKS_QUEUE},TASKS_INVOKER_SA=${TASKS_SA},WORKER_URL=${WORKER_URL:-https://placeholder.invalid}" \
  --set-secrets "SNOWFLAKE_PAT=SNOWFLAKE_PAT:latest"

SERVICE_URL="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT}" --region "${REGION}" --format 'value(status.url)')"

if [[ "${WORKER_URL}" != "${SERVICE_URL}" ]]; then
  echo "==> first deploy: pointing the queue at ${SERVICE_URL}"
  gcloud run services update "${SERVICE}" \
    --project "${PROJECT}" --region "${REGION}" \
    --update-env-vars "WORKER_URL=${SERVICE_URL},PUBLIC_ORIGIN=${SERVICE_URL}"
fi

# Inactive revisions are free, but they are also clutter and they pin the images the
# Artifact Registry cleanup policy would otherwise collect.
echo "==> pruning to the ${KEEP_REVISIONS} most recent revisions"
gcloud run revisions list \
  --service "${SERVICE}" --project "${PROJECT}" --region "${REGION}" \
  --sort-by '~metadata.creationTimestamp' \
  --format 'value(metadata.name)' \
  | tail -n "+$((KEEP_REVISIONS + 1))" \
  | while read -r revision; do
      echo "    deleting ${revision}"
      gcloud run revisions delete "${revision}" \
        --project "${PROJECT}" --region "${REGION}" --quiet || true
    done

echo "==> deployed: ${SERVICE_URL}"
