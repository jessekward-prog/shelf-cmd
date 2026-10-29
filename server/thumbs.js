// A card's thumbnail used to be whatever remote URL the page advertised. For
// Instagram and Facebook that is a short-lived signed CDN URL that 403s once
// the signature expires, leaving a broken image; everywhere else it means the
// viewer's browser fetches an image straight from a retailer, and the card
// breaks if that URL is ever rotated. So download the bytes once and serve our
// own copy from /thumbs. Any failure falls back to the raw URL, which is no
// worse than what was stored before.
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

// Thumbnails are small. Anything much past this is a full-size asset that does
// not belong in a cache keyed by card, so leave it remote rather than fill the
// volume with it.
const MAX_BYTES = 5 * 1024 * 1024

// express.static types the response from the extension, so a WebP saved as
// .jpg goes out as image/jpeg. Browsers sniff images and render it anyway, but
// only Instagram and Facebook were ever cached here and both serve JPEG — now
// that any host can be, the name has to tell the truth.
const EXT_FOR = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif'
}
const EXTS = ['jpg', 'png', 'webp', 'gif', 'avif']

export async function cacheThumb(imageUrl) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return imageUrl
  // Already ours (a hub sync replays cards that were cached on another pass).
  if (imageUrl.startsWith('/thumbs/')) return imageUrl
  const isMeta = /cdninstagram\.com|fbcdn\.net/.test(imageUrl)
  // The name is derived from the URL, so the same card resolves to the same
  // file every time. The hub replays a linked shelf's cards on every pull, and
  // without this check that's a fresh download per card per sync — and once a
  // signature dies the fetch fails and the card falls back to a dead URL even
  // though the bytes are sitting on disk. Probing each extension rather than
  // re-fetching also keeps the files cached before this, which all assumed one.
  const base = createHash('md5').update(imageUrl).digest('hex')
  for (const ext of EXTS) {
    try { await access(join(THUMBS_DIR, `${base}.${ext}`)); return `/thumbs/${base}.${ext}` } catch {}
  }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': UA,
        // Meta's CDN serves the bytes to a referrer it recognises; sending a
        // instagram.com referer anywhere else is just wrong.
        ...(isMeta && { Referer: 'https://www.instagram.com/' })
      },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return imageUrl
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!/^image\//.test(type)) return imageUrl
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_BYTES) return imageUrl
    const buf = Buffer.from(await res.arrayBuffer())
    // content-length is advisory, so check what actually arrived too.
    if (buf.length > MAX_BYTES) return imageUrl
    const name = `${base}.${EXT_FOR[type] || 'jpg'}`
    await mkdir(THUMBS_DIR, { recursive: true })
    await writeFile(join(THUMBS_DIR, name), buf)
    return `/thumbs/${name}`
  } catch { return imageUrl }
}
