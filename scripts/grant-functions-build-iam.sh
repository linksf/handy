#!/usr/bin/env bash
# Fix "missing permission on the build service account" when deploying 2nd-gen Cloud Functions.
# Requires: gcloud auth login, and Owner or IAM Admin on the project.
#
# Usage:
#   chmod +x scripts/grant-functions-build-iam.sh
#   ./scripts/grant-functions-build-iam.sh
#
# See: https://cloud.google.com/functions/docs/troubleshooting#build-service-account

set -euo pipefail

PROJECT_ID="${FIREBASE_PROJECT_ID:-handyjob-d3464}"
PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-236600149676}"

BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
GCF_SA="service-${PROJECT_NUMBER}@gcf-admin-robot.iam.gserviceaccount.com"

echo "Project: ${PROJECT_ID} (${PROJECT_NUMBER})"
gcloud config set project "${PROJECT_ID}"

grant_project_role() {
  local member="$1"
  local role="$2"
  echo "  + ${role} -> ${member}"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${member}" \
    --role="${role}" \
    --quiet >/dev/null
}

echo "Granting Cloud Build service account project roles..."
for ROLE in \
  roles/cloudbuild.builds.builder \
  roles/artifactregistry.writer \
  roles/logging.logWriter \
  roles/storage.objectViewer \
  roles/iam.serviceAccountUser; do
  grant_project_role "${BUILD_SA}" "${ROLE}"
done

echo "Granting Cloud Functions service agent build role..."
grant_project_role "${GCF_SA}" "roles/cloudbuild.builds.builder"

echo "Granting Cloud Build SA permission to act as Compute default runtime SA..."
gcloud iam service-accounts add-iam-policy-binding "${COMPUTE_SA}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --quiet >/dev/null

echo ""
echo "Done. Wait ~1 minute, then:"
echo "  cd functions && npm run build && cd .."
echo "  firebase deploy --only functions"
