#!/bin/sh
set -eu
: "${DATABASE_URL:?Set DATABASE_URL}"
umask 077
mkdir -p backups
output="backups/needle-drop-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Never print the connection string. Keep dumps encrypted and off the web server.
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --file="$output"
printf 'Backup saved to %s\n' "$output"
