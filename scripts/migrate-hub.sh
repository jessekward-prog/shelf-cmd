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
# source-schema: which schema the SOURCE's tables live in — "hosted_hub" for
# an embedded hub, "public" (the default, so you can omit it) for a
# standalone shelf-hub.
#
# pg_dump always schema-qualifies COPY/ALTER TABLE/setval statements with
# whatever --schema you gave it (or "public" implicitly with none) — the
# destination's own copy of that table usually lives under a *different*
# schema name (a standalone hub's "public", an embedded hub's "hosted_hub",
# and critically, an embedded instance's "public" is its host app's own
# unrelated tables, e.g. shelf-cmd's admin/PIN users — writing hub rows
# straight into that would corrupt them). So every qualifier gets stripped
# down to an unqualified name before it reaches the destination, and that
# destination resolves it through its OWN search_path instead — pass a
# dest URL with ?options=-c%20search_path%3Dhosted_hub when the destination
# is an embedded hub (this is exactly what the Shelf Hubs page's
# hostedHubDbUrl already looks like).
#
# After this finishes, use the Shelf Hubs page's "repoint my shelves" action
# (or PUT /api/hub-migrate) so shelf-cmd instances actually start using the
# new address — this script only moves data, it doesn't repoint anyone.

set -euo pipefail

SOURCE_URL="${1:?usage: migrate-hub.sh <source-database-url> <dest-database-url> [source-schema]}"
DEST_URL="${2:?usage: migrate-hub.sh <source-database-url> <dest-database-url> [source-schema]}"
SOURCE_SCHEMA="${3:-public}"

echo "Dumping data from source..." >&2
pg_dump --data-only --no-owner --disable-triggers --schema="$SOURCE_SCHEMA" "$SOURCE_URL" \
  | sed -E "s/^(COPY|ALTER TABLE) ${SOURCE_SCHEMA}\./\1 /; s/^(SELECT pg_catalog\.setval\(')${SOURCE_SCHEMA}\./\1/; /^SELECT pg_catalog\.set_config\('search_path'/d" \
  | psql -v ON_ERROR_STOP=1 "$DEST_URL"
echo "Done. Now repoint shelves to the new address from the Shelf Hubs page." >&2
