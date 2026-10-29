// One-off: pull every card's thumbnail onto local disk.
// Instagram and Facebook stored short-lived signed CDN URLs that 403 once the
// signature expires; every other host stored a remote URL that makes the
// viewer's browser fetch straight from a retailer and breaks if that URL is
// ever rotated. cacheThumb now handles all of them, so this just replays it
// over the rows written before it did.
//
// Uses the app's own cacheThumb rather than its own copy of the download, so
// the naming, size cap and content-type check can't drift from the live path.
// Idempotent: a card already on /thumbs/ is skipped, and a host that refuses
// leaves the existing URL alone.
//   docker exec <shelf-app-container> node scripts/backfill-thumbs.js
import pg from 'pg'
import { cacheThumb } from '../server/thumbs.js'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const { rows } = await pool.query(
  `SELECT id, type, thumbnail_url FROM cards
   WHERE thumbnail_url IS NOT NULL AND thumbnail_url NOT LIKE '/thumbs/%'
   ORDER BY id`
)
console.log(`${rows.length} card(s) holding a remote thumbnail`)

let cached = 0, left = 0
for (const card of rows) {
  const local = await cacheThumb(card.thumbnail_url)
  if (local === card.thumbnail_url) {
    left++
    console.log(`  ${card.id} (${card.type}): left remote — ${card.thumbnail_url.slice(0, 60)}`)
    continue
  }
  await pool.query('UPDATE cards SET thumbnail_url=$1 WHERE id=$2', [local, card.id])
  cached++
  console.log(`  ${card.id} (${card.type}): ${local}`)
}
console.log(`${cached} cached, ${left} left remote`)
await pool.end()
