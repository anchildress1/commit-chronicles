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
MAX_INSTANCES="${MAX_INSTANCES:-1}"

RUN_SA="commit-chronicles-run@${PROJECT}.iam.gserviceaccount.com"
TASKS_SA="commit-chronicles-tasks@${PROJECT}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/commit-chronicles/${SERVICE}"
TAG="$(git rev-parse --short HEAD)"

echo "==> building ${IMAGE}:${TAG}"
gcloud builds submit --tag "${IMAGE}:${TAG}" --project "${PROJECT}"

# The worker URL is the service's own address, which does not exist until the first deploy.
WORKER_URL="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT}" --region "${REGION}" \
  --format 'value(status.url)' 2>/dev/null || true)"

# Cost shape, deliberately. Cloud Run never serves a card — the public bucket does — so the
# only thing billed here is the page shell and the generation itself.
#
#   --min-instances 0        scale to zero; an idle day costs nothing. Any minimum instance
#                            is billed around the clock at the idle rate.
#   (no --no-cpu-throttling) request-based billing: CPU is charged only while a request is
#                            actually in flight, not for the life of the instance.
#   --no-cpu-boost           startup boost bills at DOUBLE CPU through startup. gcloud leaves
#                            it "unspecified" on new services, so it is pinned off here.
#   --execution-environment gen1
#                            same price as gen2, but faster cold starts — and a service that
#                            scales to zero cold-starts constantly.
#   --cpu 1 / --concurrency 80
#                            CPU below 1 forces concurrency to 1, so every visitor would need
#                            an instance of their own. One vCPU is both cheaper and faster.
#   --max-instances 1        one instance, ever. At concurrency 80 it still absorbs a crowd,
#                            and the serving path is a static shell — the bucket serves the
#                            cards. Nothing here can fan out into a surprise bill.
#   --timeout 600            bounds the worst case: a generation wedged on Snowflake bills
#                            until it is killed. The page stops waiting at five minutes.
echo "==> deploying ${SERVICE}"
ENV_VARS="GOOGLE_CLOUD_PROJECT=${PROJECT},CARD_BUCKET=${CARD_BUCKET},DAILY_GENERATION_CAP=${DAILY_GENERATION_CAP},SNOWFLAKE_ACCOUNT=${SNOWFLAKE_ACCOUNT:?set SNOWFLAKE_ACCOUNT},SNOWFLAKE_USER=${SNOWFLAKE_USER:?set SNOWFLAKE_USER}"

# A new service has no URL yet. Its bootstrap revision stays private until the queue is wired;
# otherwise a request in that gap would start detached inline work after request CPU stops.
AUTH_FLAG="--allow-unauthenticated"
if [[ -n "${WORKER_URL}" ]]; then
  ENV_VARS="${ENV_VARS},TASKS_LOCATION=${REGION},TASKS_QUEUE=${TASKS_QUEUE},TASKS_INVOKER_SA=${TASKS_SA},WORKER_URL=${WORKER_URL},PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-${WORKER_URL}}"
else
  AUTH_FLAG="--no-allow-unauthenticated"
  echo "    first deploy: keeping the bootstrap revision private until the queue is wired"
fi

gcloud run deploy "${SERVICE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --image "${IMAGE}:${TAG}" \
  --platform managed \
  "${AUTH_FLAG}" \
  --service-account "${RUN_SA}" \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances "${MAX_INSTANCES}" \
  --timeout 600 \
  --no-cpu-boost \
  --execution-environment gen1 \
  --set-env-vars "${ENV_VARS}" \
  --set-secrets "SNOWFLAKE_PAT=SNOWFLAKE_PAT:latest"

SERVICE_URL="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT}" --region "${REGION}" --format 'value(status.url)')"

if [[ -z "${WORKER_URL}" ]]; then
  echo "==> wiring the queue to ${SERVICE_URL}"
  gcloud run services update "${SERVICE}" \
    --project "${PROJECT}" --region "${REGION}" \
    --update-env-vars "TASKS_LOCATION=${REGION},TASKS_QUEUE=${TASKS_QUEUE},TASKS_INVOKER_SA=${TASKS_SA},WORKER_URL=${SERVICE_URL},PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-${SERVICE_URL}}"

  echo "==> opening the queue-configured service"
  gcloud run services add-iam-policy-binding "${SERVICE}" \
    --project "${PROJECT}" --region "${REGION}" \
    --member=allUsers --role=roles/run.invoker >/dev/null
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
