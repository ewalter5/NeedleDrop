#!/bin/sh
set -eu
: "${RESTORE_DATABASE_URL:?Set a NEW, EMPTY isolated Postgres database URL}"
: "${1:?Pass the backup path}"
# Does not drop or overwrite existing objects. Never point this at production.
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-privileges --exit-on-error "$1"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS quizzes FROM quizzes; SELECT count(*) AS submissions FROM submissions; SELECT count(*) AS grades FROM grades;'
