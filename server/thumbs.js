// Instagram/Facebook OG images are short-lived signed CDN URLs (cdninstagram /
// fbcdn) that 403 once the signature expires, so a stored card renders a broken
// image. Download the bytes while the signature is still fresh and serve our own
// copy from /thumbs. Any other host, or any failure, falls back to the raw URL.
//
// Lives in its own module because both paths that write a thumbnail need it:
// index.js (adding and scraping a card) and hub.js (syncing one in from a hub,
// which hands back whatever raw URL the posting instance recorded).
import { createHash } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

// Same default drive.js uses, so cached thumbs land in the one persistent volume.
export const THUMBS_DIR = join(process.env.UPLOADS_DIR || join(process.cwd(), 'uploads'), 'thumbs')

const UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

export async function cacheThumb(imageUrl) {
  if (!imageUrl || !/cdninstagram\.com|fbcdn\.net/.test(imageUrl)) return imageUrl
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://www.instagram.com/' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return imageUrl
    const name = createHash('md5').update(imageUrl).digest('hex') + '.jpg'
    await mkdir(THUMBS_DIR, { recursive: true })
    await writeFile(join(THUMBS_DIR, name), Buffer.from(await res.arrayBuffer()))
    return `/thumbs/${name}`
  } catch { return imageUrl }
}
