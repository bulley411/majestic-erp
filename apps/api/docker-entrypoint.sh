#!/bin/sh
set -e

# Apply pending migrations before the API accepts traffic.
#
# `migrate deploy` only applies existing migration files — it never
# generates one and never asks a question, which is what makes it safe
# to run unattended. `migrate dev` must never run in production.
echo "Applying database migrations..."
cd /app/apps/api
npx prisma migrate deploy
cd /app

echo "Starting API..."
exec "$@"