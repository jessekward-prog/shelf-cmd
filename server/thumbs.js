// Instagram/Facebook OG images are short-lived signed CDN URLs (cdninstagram /
// fbcdn) that 403 once the signature expires, so a stored card renders a broken
// image. Download the bytes while the signature is still fresh and serve our own
// copy from /thumbs. Any other host, or any failure, falls back to the raw URL.
//
// Lives in its own module because both paths that write a thumbnail need it:
// index.js (adding and scraping a card) and hub.js (syncing one in from a hub,
// which hands back whatever raw URL the posting instance recorded).
import { createHash } from 'crypto'
import { mkdir, writeFile, access } from 'fs/promises'
import { join } from 'path'

// Same default drive.js uses, so cached thumbs land in the one persistent volume.
export const THUMBS_DIR = join(process.env.UPLOADS_DIR || join(process.cwd(), 'uploads'), 'thumbs')

const UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

export async function cacheThumb(imageUrl) {
  if (!imageUrl || !/cdninstagram\.com|fbcdn\.net/.test(imageUrl)) return imageUrl
  // The name is derived from the URL, so the same card resolves to the same
  // file every time. The hub replays a linked shelf's cards on every pull, and
  // without this check that's a fresh download per card per sync — and once the
  // signature dies the fetch fails and the card falls back to a dead URL even
  // though the bytes are sitting on disk.
  const name = createHash('md5').update(imageUrl).digest('hex') + '.jpg'
  const path = join(THUMBS_DIR, name)
  try { await access(path); return `/thumbs/${name}` } catch {}
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://www.instagram.com/' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return imageUrl
    await mkdir(THUMBS_DIR, { recursive: true })
    await writeFile(path, Buffer.from(await res.arrayBuffer()))
    return `/thumbs/${name}`
  } catch { return imageUrl }
}
