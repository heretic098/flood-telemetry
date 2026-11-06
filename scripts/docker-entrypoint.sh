#!/bin/sh
set -e

echo "[Lifecycle] Starting Somerset Flood Telemetry container..."

TARGET_DB="${DB_PATH:-/data/telemetry.db}"
TARGET_DIR="$(dirname "$TARGET_DB")"

# 0. Pre-Flight Volume Writeability Probe ([RULE-INFRA-01])
# Persistent volume mounts (e.g. /data on Fly.io) can shadow build-time directory ownership
# or leave root-owned database files from prior containers. Fail fast with an actionable diagnostic.
if [ -d "$TARGET_DIR" ]; then
  # Use mktemp if available to eliminate symlink and predictable filename hazards
  if command -v mktemp >/dev/null 2>&1; then
    PROBE_FILE="$(mktemp "$TARGET_DIR/.probe_write_XXXXXX" 2>/dev/null || true)"
    if [ -z "$PROBE_FILE" ] || [ ! -f "$PROBE_FILE" ]; then
      echo "FATAL: Volume directory '$TARGET_DIR' is not writeable by UID $(id -u) ($(id -un)). Check volume mount ownership (root-shadowing)." >&2
      exit 1
    fi
  else
    PROBE_FILE="$TARGET_DIR/.probe_write_$$"
    if ! touch "$PROBE_FILE" 2>/dev/null; then
      echo "FATAL: Volume directory '$TARGET_DIR' is not writeable by UID $(id -u) ($(id -un)). Check volume mount ownership (root-shadowing)." >&2
      exit 1
    fi
  fi
  rm -f "$PROBE_FILE"

  # Check primary database file and active WAL / shared memory journals
  for check_file in "$TARGET_DB" "${TARGET_DB}-wal" "${TARGET_DB}-shm"; do
    if [ -f "$check_file" ] && [ ! -w "$check_file" ]; then
      echo "FATAL: Existing database file '$check_file' is not writeable by UID $(id -u) ($(id -un)). Reconcile file ownership (chown)." >&2
      exit 1
    fi
  done
fi

# 1. Local Development & Standalone Fallback
# If Tigris S3 credentials are not configured, start Node.js directly in standalone mode.
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ] || [ -z "${BUCKET_NAME:-}" ]; then
  echo "[Lifecycle] Remote replication credentials (AWS_ACCESS_KEY_ID, BUCKET_NAME) not configured."
  echo "[Lifecycle] Starting Node.js in standalone local mode..."
  exec "$@"
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "FATAL: Target database directory '$TARGET_DIR' does not exist." >&2
  exit 1
fi

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
