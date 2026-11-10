#!/usr/bin/env bash
# Phase 20-K (§5(j)): Release-directory deploy script with backup gate, pinned Prisma migrate deploy
# as erp_owner, symlink swap, and rolling health-gated PM2 reload (erp-a -> 5011/ready -> erp-b -> 5012/ready).
set -euo pipefail

SHA="${1:?Usage: deploy-release.sh <git-sha> <tarball-path>}"
TARBALL="${2:?Usage: deploy-release.sh <git-sha> <tarball-path>}"
BASE_DIR="/app/sawant-erp"
RELEASE_DIR="${BASE_DIR}/releases/${SHA}"
CURRENT_LINK="${BASE_DIR}/current"

if [[ -z "${MIGRATION_DATABASE_URL:-}" ]]; then
  echo "ERROR: MIGRATION_DATABASE_URL (erp_owner role) must be exported." >&2
  exit 1
fi

if [[ "${PRE_SNAPSHOT_VERIFIED:-false}" != "true" ]]; then
  echo "ERROR: Take an RDS manual snapshot pre-${SHA} first, then export PRE_SNAPSHOT_VERIFIED=true." >&2
  exit 1
fi

echo "--- 1. Unpack release ${SHA} ---"
mkdir -p "${RELEASE_DIR}"
tar -xzf "${TARBALL}" -C "${RELEASE_DIR}"
cd "${RELEASE_DIR}/apps/api"

echo "--- 2. Install production dependencies & generate Prisma Client ---"
npm ci --omit=dev
PRISMA_VERSION=$(node -p "require('./package.json').devDependencies.prisma")
npx --yes "prisma@${PRISMA_VERSION}" generate

echo "--- 3. Run expand-only migrations as erp_owner ---"
DATABASE_URL="${MIGRATION_DATABASE_URL}" npx --yes "prisma@${PRISMA_VERSION}" migrate deploy

echo "--- 4. Swap symlink cleanly ---"
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

wait_ready() {
  local port="$1"
  for i in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${port}/api/v1/health/ready" | grep -q '"ready"'; then
      echo "Worker :${port} READY"
      return 0
    fi
    sleep 2
  done
  echo "ERROR: Worker :${port} failed /health/ready" >&2
  return 1
}

echo "--- 5. Rolling reload erp-a (:5011) -> erp-b (:5012) ---"
pm2 reload "${RELEASE_DIR}/infra/pm2/ecosystem.config.cjs" --only erp-a --update-env
wait_ready 5011
pm2 reload "${RELEASE_DIR}/infra/pm2/ecosystem.config.cjs" --only erp-b --update-env
wait_ready 5012

echo "--- 6. Prune releases beyond latest 5 ---"
ls -1dt "${BASE_DIR}/releases/"* | tail -n +6 | xargs -r rm -rf

echo "=== Release ${SHA} deployed and healthy on both workers ==="

