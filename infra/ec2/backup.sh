#!/usr/bin/env bash
# Nightly Postgres backup: pg_dump from the container, gzip to ./backups,
# keep 14 local copies, optionally copy to S3 (set S3_BUCKET in .env and
# attach the bucket policy to the instance role).
#
# Install (as the user that owns the compose stack):
#   crontab -e
#   15 8 * * * cd /home/ubuntu/agentic-dashboard/infra/ec2 && ./backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
set -a; source .env; set +a

mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="backups/agentic_dashboard_${STAMP}.sql.gz"

docker compose exec -T postgres pg_dump -U agentic agentic_dashboard | gzip > "$FILE"
echo "$(date -u +%FT%TZ) wrote $FILE ($(du -h "$FILE" | cut -f1))"

# Keep the newest 14 local dumps.
ls -1t backups/agentic_dashboard_*.sql.gz | tail -n +15 | xargs -r rm --

if [ -n "${S3_BUCKET:-}" ]; then
  aws s3 cp "$FILE" "s3://${S3_BUCKET}/backups/$(basename "$FILE")" --only-show-errors
  echo "$(date -u +%FT%TZ) copied to s3://${S3_BUCKET}/backups/ (30-day lifecycle)"
fi
