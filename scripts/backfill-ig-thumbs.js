// One-off: re-cache Instagram/Facebook card thumbnails locally.
// Their stored cdninstagram/fbcdn URLs are expired signed links (403), so this
// re-fetches a fresh OG image per card and downloads it to /thumbs. Idempotent:
// cards already on a /thumbs/ path are skipped, so it is safe to re-run.
//   docker exec <shelf-app-container> node scripts/backfill-ig-thumbs.js
import pg from 'pg'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'

const UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
const THUMBS_DIR = join(process.env.UPLOADS_DIR || join(process.cwd(), 'uploads'), 'thumbs')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function ogImage(postUrl) {
  const res = await fetch(postUrl, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000) })
  if (!res.ok) return null
  const html = await res.text()
  const m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/) || html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:image"/)
  return m ? m[1].replace(/&amp;/g, '&') : null
}

async function download(imageUrl) {
  const res = await fetch(imageUrl, { headers: { 'User-Agent': UA, 'Referer': 'https://www.instagram.com/' }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) return null
  const name = createHash('md5').update(imageUrl).digest('hex') + '.jpg'
  await mkdir(THUMBS_DIR, { recursive: true })
  await writeFile(join(THUMBS_DIR, name), Buffer.from(await res.arrayBuffer()))
  return `/thumbs/${name}`
}

const { rows } = await pool.query(
  `SELECT id, url, thumbnail_url FROM cards
   WHERE type IN ('instagram','facebook') AND url IS NOT NULL
     AND (thumbnail_url IS NULL OR thumbnail_url NOT LIKE '/thumbs/%')`
)
console.log(`${rows.length} card(s) to re-cache`)
let ok = 0
for (const card of rows) {
  try {
    const img = await ogImage(card.url)
    if (!img) { console.log(`  #${card.id} no og:image`); continue }
    const local = await download(img)
    if (!local) { console.log(`  #${card.id} download failed`); continue }
    await pool.query('UPDATE cards SET thumbnail_url=$1 WHERE id=$2', [local, card.id])
    console.log(`  #${card.id} -> ${local}`)
    ok++
  } catch (e) { console.log(`  #${card.id} ${e.message}`) }
}
console.log(`done: ${ok}/${rows.length} re-cached`)
await pool.end()
