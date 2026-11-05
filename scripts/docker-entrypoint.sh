#!/bin/sh
set -e

echo "[Lifecycle] Starting Somerset Flood Telemetry container..."

# 1. Local Development & Standalone Fallback
# If Tigris S3 credentials are not configured, start Node.js directly in standalone mode.
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ] || [ -z "${BUCKET_NAME:-}" ]; then
  echo "[Lifecycle] Remote replication credentials (AWS_ACCESS_KEY_ID, BUCKET_NAME) not configured."
  echo "[Lifecycle] Starting Node.js in standalone local mode..."
  exec "$@"
fi

TARGET_DB="${DB_PATH:-/data/telemetry.db}"

# 2. Guarded Point-in-Time Database Restore
# If the local database is missing (e.g. clean volume, rebuild, disaster recovery),
# restore from Fly Tigris.
if [ ! -f "$TARGET_DB" ]; then
  echo "[Lifecycle] Local database $TARGET_DB not found on volume."
  echo "[Lifecycle] Restoring from Fly Tigris (if replica exists)..."

  # -if-replica-exists: Restores if a replica exists in Tigris; exits cleanly (0) if bucket has no replica yet (initial deployment).
  # -if-db-not-exists: Hardened defense ensuring an existing database is never overwritten.
  # If an existing replica fails to restore (e.g. network failure), this exits with non-zero
  # preventing the container from silently creating a divergent empty database!
  litestream restore -if-replica-exists -if-db-not-exists -config /etc/litestream.yml "$TARGET_DB"
  
  if [ -f "$TARGET_DB" ]; then
    echo "[Lifecycle] Successfully restored $TARGET_DB from Fly Tigris."
  else
    echo "[Lifecycle] No existing replica in Tigris. Fresh database will be initialized on boot."
  fi
else
  echo "[Lifecycle] Existing local database found at $TARGET_DB. Skipping restore."
fi

# 3. Supervised Execution with Continuous Replication
echo "[Lifecycle] Launching Litestream replication supervisor wrapping: $*"
exec litestream replicate -config /etc/litestream.yml -exec "$*"
