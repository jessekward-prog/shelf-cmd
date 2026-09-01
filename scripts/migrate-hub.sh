#!/usr/bin/env bash
# Moves a hub's data from one Postgres database to another — the actual
# transfer behind the "migrate this hub" flow on the Shelf Hubs page. Works
# either direction: an embedded hosted-hub (this app's own DATABASE_URL, with
# the hosted_hub schema) to a standalone shelf-hub's own database, or back.
#
# Both hub flavors run the identical table schema (server/hosted-hub-schema.sql
# and shelf-hub/schema.sql are kept in sync by hand) and both always recreate
# their own (empty) tables on boot, so this only ever needs to move rows —
# never table definitions — which is what --data-only is for.
#
# Usage:
#   ./scripts/migrate-hub.sh <source-database-url> <dest-database-url> [source-schema]
#
# source-schema: pass "hosted_hub" when the source is an embedded hub (its
# tables live in that schema, not public). Omit for a standalone shelf-hub.
#
# After this finishes, use the Shelf Hubs page's "repoint my shelves" action
# (or PUT /api/hub-migrate) so shelf-cmd instances actually start using the
# new address — this script only moves data, it doesn't repoint anyone.

set -euo pipefail

SOURCE_URL="${1:?usage: migrate-hub.sh <source-database-url> <dest-database-url> [source-schema]}"
DEST_URL="${2:?usage: migrate-hub.sh <source-database-url> <dest-database-url> [source-schema]}"
SOURCE_SCHEMA="${3:-}"

DUMP_ARGS=(--data-only --no-owner --disable-triggers)
if [ -n "$SOURCE_SCHEMA" ]; then
  DUMP_ARGS+=(--schema="$SOURCE_SCHEMA")
fi

echo "Dumping data from source..." >&2
pg_dump "${DUMP_ARGS[@]}" "$SOURCE_URL" | psql -v ON_ERROR_STOP=1 "$DEST_URL"
echo "Done. Now repoint shelves to the new address from the Shelf Hubs page." >&2
