#!/bin/sh
# Container entrypoint: apply the Prisma schema to the SQLite database, then start Next.js.
# Mount a persistent volume for the database and point DATABASE_URL at it,
# e.g. DATABASE_URL=file:/app/data/hub.db with a volume on /app/data.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set (e.g. file:/app/data/hub.db)" >&2
  exit 1
fi

./node_modules/.bin/prisma db push --skip-generate
exec node server.js
