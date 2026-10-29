// One-off: re-title Instagram/Facebook cards saved before the og:title split.
// Their stored title is the whole post — `<author> on Instagram: "<caption>"` —
// so the card repeats its own description back at itself, clamped on a dangling
// quote. This re-runs the app's own scrape endpoint per card, which re-reads the
// page with the fixed parser and pushes the result to the hub, so a shared shelf
// gets the clean title too instead of having it overwritten on the next sync.
// Idempotent: a card whose title no longer matches the pattern is skipped.
//   docker exec <shelf-app-container> node scripts/backfill-social-titles.js
import pg from 'pg'

const SOCIAL_TITLE = /^.{1,80}?\s+on\s+(?:Instagram|Facebook|Threads)\s*:\s*["“]/
const PORT = process.env.PORT || 3016
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const { rows: admin } = await pool.query('SELECT token FROM users WHERE is_admin=TRUE LIMIT 1')
if (!admin[0]) { console.error('no admin user to authenticate as'); process.exit(1) }

const { rows } = await pool.query(
  `SELECT id, title FROM cards WHERE type IN ('instagram','facebook') AND url IS NOT NULL ORDER BY id`
)
const stale = rows.filter(c => SOCIAL_TITLE.test(c.title || ''))
console.log(`${stale.length} of ${rows.length} social card(s) still titled with the raw post`)

let ok = 0
for (const card of stale) {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/cards/${card.id}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin[0].token}` }
    })
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`)
    const updated = await res.json()
    console.log(`  ${card.id}: ${JSON.stringify((updated.title || '').slice(0, 70))}`)
    ok++
  } catch (err) {
    console.error(`  ${card.id}: failed — ${err.message}`)
  }
}
console.log(`${ok}/${stale.length} re-titled`)
await pool.end()
