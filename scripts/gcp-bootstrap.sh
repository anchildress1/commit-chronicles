#!/usr/bin/env bash
#
# One-off project setup. Idempotent — safe to re-run.
#
# Everything `deploy.sh` assumes exists is created here: the public cards bucket, the
# image repo and its cleanup policy, the two service accounts, the Snowflake PAT in
# Secret Manager, and the generation queue.
#
# The PAT is read from .env and piped straight into Secret Manager. It is never echoed,
# never written to a file, and never baked into an image.

set -euo pipefail

PROJECT="${PROJECT:-anchildress1}"
REGION="${REGION:-us-east1}"
CARD_BUCKET="${CARD_BUCKET:-commit-chronicles-cards}"
TASKS_QUEUE="${TASKS_QUEUE:-commit-chronicles-gen}"

RUN_SA="commit-chronicles-run@${PROJECT}.iam.gserviceaccount.com"
TASKS_SA="commit-chronicles-tasks@${PROJECT}.iam.gserviceaccount.com"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${SNOWFLAKE_PAT:?SNOWFLAKE_PAT must be set (put it in .env — see docs/snowflake-setup.md)}"

echo "==> APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  --project "${PROJECT}"

echo "==> cards bucket"
gcloud storage buckets create "gs://${CARD_BUCKET}" \
  --project "${PROJECT}" --location "${REGION}" --uniform-bucket-level-access \
  2>/dev/null || echo "    exists"

# The cards are hotlinked from READMEs and social cards. Public read is the product.
# Cloud Run remains the only writer.
gcloud storage buckets add-iam-policy-binding "gs://${CARD_BUCKET}" \
  --member=allUsers --role=roles/storage.objectViewer --project "${PROJECT}" >/dev/null

# Quota counters are one tiny object per day and are worthless the moment the day ends.
cat >/tmp/cc-lifecycle.json <<'JSON'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":30,"matchesPrefix":["meta/quota/"]}}]}
JSON
gcloud storage buckets update "gs://${CARD_BUCKET}" \
  --lifecycle-file=/tmp/cc-lifecycle.json --project "${PROJECT}" >/dev/null
rm -f /tmp/cc-lifecycle.json

echo "==> image repo"
gcloud artifacts repositories create commit-chronicles \
  --repository-format=docker --location="${REGION}" --project="${PROJECT}" \
  --description="Commit Chronicles images" 2>/dev/null || echo "    exists"

# Keep three images. Untagged layers are orphaned the moment a tag is rebuilt, and
# paying to store them is paying for nothing.
cat >/tmp/cc-ar-cleanup.json <<'JSON'
[
  {"name":"delete-untagged","action":{"type":"Delete"},
   "condition":{"tagState":"UNTAGGED","olderThan":"1d"}},
  {"name":"keep-recent-3","action":{"type":"Keep"},
   "mostRecentVersions":{"keepCount":3}},
  {"name":"delete-old","action":{"type":"Delete"},
   "condition":{"tagState":"ANY","olderThan":"7d"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies commit-chronicles \
  --location="${REGION}" --project="${PROJECT}" \
  --policy=/tmp/cc-ar-cleanup.json --no-dry-run >/dev/null
rm -f /tmp/cc-ar-cleanup.json

echo "==> service accounts"
gcloud iam service-accounts create commit-chronicles-run \
  --project "${PROJECT}" --display-name "Commit Chronicles runtime" 2>/dev/null || echo "    run SA exists"
gcloud iam service-accounts create commit-chronicles-tasks \
  --project "${PROJECT}" --display-name "Commit Chronicles queue invoker" 2>/dev/null || echo "    tasks SA exists"

echo "==> IAM"
gcloud storage buckets add-iam-policy-binding "gs://${CARD_BUCKET}" \
  --member="serviceAccount:${RUN_SA}" --role=roles/storage.objectAdmin \
  --project "${PROJECT}" >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${RUN_SA}" --role=roles/cloudtasks.enqueuer \
  --condition=None >/dev/null

# The runtime signs each task as the invoker SA, so it must be allowed to act as it.
gcloud iam service-accounts add-iam-policy-binding "${TASKS_SA}" \
  --member="serviceAccount:${RUN_SA}" --role=roles/iam.serviceAccountUser \
  --project "${PROJECT}" >/dev/null

echo "==> secret"
if gcloud secrets describe SNOWFLAKE_PAT --project "${PROJECT}" >/dev/null 2>&1; then
  printf '%s' "${SNOWFLAKE_PAT}" \
    | gcloud secrets versions add SNOWFLAKE_PAT --data-file=- --project "${PROJECT}" >/dev/null
  echo "    new version added"
else
  printf '%s' "${SNOWFLAKE_PAT}" \
    | gcloud secrets create SNOWFLAKE_PAT --data-file=- \
        --replication-policy=automatic --project "${PROJECT}" >/dev/null
fi

gcloud secrets add-iam-policy-binding SNOWFLAKE_PAT \
  --member="serviceAccount:${RUN_SA}" \
  --role=roles/secretmanager.secretAccessor --project "${PROJECT}" >/dev/null

# max-concurrent-dispatches is the real ceiling on Cortex spend rate: at most two repos
# can be in the warehouse at once, whatever the front page is doing.
echo "==> queue"
gcloud tasks queues create "${TASKS_QUEUE}" \
  --location "${REGION}" --project "${PROJECT}" \
  --max-concurrent-dispatches=2 \
  --max-dispatches-per-second=1 \
  --max-attempts=3 \
  --min-backoff=10s \
  --max-backoff=300s 2>/dev/null || echo "    exists"

echo "==> done. now run: make deploy"
