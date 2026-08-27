import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import pg from 'pg'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { YoutubeTranscript } from 'youtube-transcript'
import { randomBytes } from 'crypto'
import { makeHub } from './hub.js'
import { mountDrive } from './drive.js'
import { mountGuide, ensureGuideTable, CATEGORIES } from './guide.js'
import { mountChat, logActivity } from './chat.js'
chromium.use(StealthPlugin())

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3016
const TWITCH_PARENT = process.env.TWITCH_PARENT || 'shelf.cmdward.xyz'

app.use(cors())
app.use(express.json())

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const hub = makeHub(pool)

// ── Identity ─────────────────────────────────────────────────────────────────

app.use(async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  if (!token) return next()
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE token=$1', [token])
    req.user = rows[0]
  } catch {}
  next()
})

const adminOnly = (req, res, next) =>
  req.user?.is_admin ? next() : res.status(403).json({ error: 'admin only' })

// A plain <a download> can't send a bearer header, so let the token ride as ?t=
// the way the drive's raw/thumb links already do.
const adminOrToken = async (req, res, next) => {
  if (req.user?.is_admin) return next()
  if (req.query.t) {
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE token=$1', [req.query.t])
    if (rows[0]?.is_admin) return next()
  }
  res.status(403).json({ error: 'admin only' })
}

async function initDb() {
  const schema = await readFile(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(schema)
  // Guides live in a module that owns its own migrations, but the FK back to
  // categories means this must run AFTER schema.sql, not on module mount.
  await ensureGuideTable(pool)
  // The PIN holder is a real user row so their posts carry a name like everyone else's
  await pool.query(
    "INSERT INTO users (username, token, is_admin) SELECT 'admin', $1, TRUE WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin)",
    [randomBytes(24).toString('hex')]
  )
}

async function fetchOEmbed(endpoint) {
  try {
    const res = await fetch(endpoint, { headers: { 'User-Agent': 'shelf-cmd/1.0' } })
    if (!res.ok) return {}
    return res.json()
  } catch {
    return {}
  }
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&#x2019;/g, '’').replace(/&#x201c;/g, '“').replace(/&#x201d;/g, '”')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

const OG_USER_AGENTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
]

async function fetchOpenGraph(url) {
  let html = ''
  for (const ua of OG_USER_AGENTS) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) continue
      html = await res.text()
      if (html.includes('og:title') || html.includes('og:image')) break
    } catch (e) { continue }
  }
  if (!html) return {}
  try {
    const get = (prop) => {
      const raw =
        html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`))?.[1] ||
        html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`))?.[1] ||
        html.match(new RegExp(`<meta[^>]+name="${prop}"[^>]+content="([^"]*)"`))?.[1] || ''
      return decodeHtmlEntities(raw)
    }
    let rawTitle = get('og:title') || get('twitter:title') || ''
    rawTitle = rawTitle.replace(/^.+\|\s*(How Things Work on Instagram|How Things Work on Facebook|Watch|Post):\s*/i, '')
    const title = rawTitle.length > 120
      ? (rawTitle.split(/[.!?\n]/)[0].slice(0, 120) || rawTitle.slice(0, 120))
      : rawTitle
    const image = decodeHtmlEntities(get('og:image') || get('twitter:image') || '') || null
    const description = get('og:description') || get('twitter:description') || null

    // Price — look in product:price, schema.org JSON-LD, or common price meta tags
    let price = get('product:price:amount') || get('og:price:amount') || null
    if (!price) {
      const ldPrice = html.match(/"price"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/)?.[1]
      if (ldPrice) price = ldPrice
    }
    const currency = get('product:price:currency') || get('og:price:currency') || 'USD'

    return { title, image, description, price, currency }
  } catch (e) {
    return {}
  }
}

async function followRedirect(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', method: 'GET' })
    return res.url
  } catch {
    return url
  }
}

function lmHeaders() {
  const key = process.env.LM_STUDIO_API_KEY
  return { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) }
}

const LM_URL = () => process.env.LM_STUDIO_URL || 'http://localhost:1234'

// Which model the server-side AI (descriptions, scrape, plans, guides, the
// legend classifier) uses. Env sets the default; picking one in the UI stores it
// and overrides, per instance — a collaborator running their own shelf shouldn't
// have to edit a .env to point at a model they actually have loaded.
// ponytail: the pick is republished into process.env rather than threaded
// through every call site, so the existing `process.env.LM_STUDIO_MODEL` reads
// here and in guide.js honour it unchanged. Ceiling: one model per process,
// which is exactly one instance. Upgrade path is passing it per call.
const ENV_LM_MODEL = process.env.LM_STUDIO_MODEL || ''

async function applyLmModel() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='lm_model'")
  process.env.LM_STUDIO_MODEL = rows[0]?.value || ENV_LM_MODEL
}

// Reasoning models leak their scratchpad into `content`, or spend the whole budget thinking
// and never answer. Treat anything that doesn't look like the 1-2 sentences we asked for as
// no answer at all, so callers fall back to the page's own description.
// ponytail: a marker/length heuristic, not a parser.
const REASONING_TELLS = /^\s*(<think>|thinking process|let me think|okay,? (so )?(the user|i need)|first,? i)/i

function usableDescription(text) {
  const stripped = (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (!stripped || REASONING_TELLS.test(stripped) || stripped.length > 400) return null
  return stripped
}

async function generateDescription(title, url) {
  const lmUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234'
  const model = process.env.LM_STUDIO_MODEL || ''
  try {
    const res = await fetch(`${lmUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: lmHeaders(),
      body: JSON.stringify({
        model: model || undefined,
        messages: [
          { role: 'system', content: 'You write short, punchy card descriptions (1-2 sentences max). No fluff. Just what it is and why it\'s worth saving. Answer directly with the description and nothing else.' },
          { role: 'user', content: `Write a card description for: "${title}"\nURL: ${url}` }
        ],
        max_tokens: 200,
        temperature: 0.7
      })
    })
    if (!res.ok) return null
    const data = await res.json()
    return usableDescription(data.choices?.[0]?.message?.content)
  } catch {
    return null
  }
}

function cleanFacebookTitle(title) {
  if (!title) return ''
  // "1.4M views · 35K reactions | <content>" → keep content
  title = title.replace(/^[\d.,]+[KMBkmb]*\+?\s+\w+\s*[·•]\s*[\d.,]+[KMBkmb]*\+?\s+\w+\s*\|\s*/i, '')
  // Strip trailing " | Facebook" branding
  title = title.replace(/\s*\|\s*(?:Facebook|Watch on Facebook)\s*$/i, '')
  return title.trim()
}

// ── Platform detection ───────────────────────────────────────────────────────

async function resolvePlatform(rawUrl) {
  const url = rawUrl.trim()

  // YouTube
  if (/youtube\.com|youtu\.be/.test(url)) {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
    const id = m?.[1]
    if (!id) return null
    const meta = await fetchOEmbed(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    return {
      type: 'youtube', media_id: id,
      title: meta.title || '',
      thumbnail_url: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      embed_url: `https://www.youtube.com/embed/${id}?autoplay=1`,
      aspect: '16:9'
    }
  }

  // TikTok (including short urls)
  if (/tiktok\.com/.test(url)) {
    const resolved = /vm\.tiktok\.com|vt\.tiktok\.com/.test(url) ? await followRedirect(url) : url
    const m = resolved.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/)
    const id = m?.[1]
    const meta = await fetchOEmbed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(resolved || url)}`)
    return {
      type: 'tiktok', media_id: id || null,
      title: meta.title || '',
      thumbnail_url: meta.thumbnail_url || null,
      embed_url: id ? `https://www.tiktok.com/embed/v2/${id}` : null,
      aspect: '9:16'
    }
  }

  // Vimeo
  if (/vimeo\.com/.test(url)) {
    const meta = await fetchOEmbed(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`)
    const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1]
    return {
      type: 'vimeo', media_id: id || null,
      title: meta.title || '',
      thumbnail_url: meta.thumbnail_url || null,
      embed_url: id ? `https://player.vimeo.com/video/${id}?autoplay=1` : null,
      aspect: '16:9'
    }
  }

  // Spotify
  if (/open\.spotify\.com/.test(url)) {
    const m = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/)
    if (!m) return null
    const [, kind, id] = m
    const isAudio = kind === 'track' || kind === 'episode'
    return {
      type: 'spotify', media_id: id,
      title: '',
      thumbnail_url: null,
      embed_url: `https://open.spotify.com/embed/${kind}/${id}`,
      aspect: isAudio ? 'audio' : '16:9'
    }
  }

  // SoundCloud
  if (/soundcloud\.com/.test(url)) {
    const meta = await fetchOEmbed(`https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    return {
      type: 'soundcloud', media_id: null,
      title: meta.title || '',
      thumbnail_url: meta.thumbnail_url || null,
      embed_url: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23e8840a&auto_play=false&show_artwork=true`,
      aspect: 'audio'
    }
  }

  // Twitch clips
  if (/twitch\.tv|clips\.twitch\.tv/.test(url)) {
    const clipM = url.match(/twitch\.tv\/[^/]+\/clip\/([A-Za-z0-9_-]+)/) || url.match(/clips\.twitch\.tv\/([A-Za-z0-9_-]+)/)
    const vodM = url.match(/twitch\.tv\/videos\/(\d+)/)
    if (clipM) {
      return {
        type: 'twitch', media_id: clipM[1],
        title: '', thumbnail_url: null,
        embed_url: `https://clips.twitch.tv/embed?clip=${clipM[1]}&parent=${TWITCH_PARENT}`,
        aspect: '16:9'
      }
    }
    if (vodM) {
      return {
        type: 'twitch', media_id: vodM[1],
        title: '', thumbnail_url: null,
        embed_url: `https://player.twitch.tv/?video=${vodM[1]}&parent=${TWITCH_PARENT}`,
        aspect: '16:9'
      }
    }
    return null
  }

  // Instagram — OG tags for title/thumbnail, official /embed/ path for player
  if (/instagram\.com/.test(url)) {
    const m = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)
    const code = m?.[1]
    const isReel = url.includes('/reel/')
    const og = await fetchOpenGraph(url)
    return {
      type: 'instagram', media_id: code || null,
      title: og.title || '',
      thumbnail_url: og.image || null,
      og_description: og.description || null,
      embed_url: code ? `https://www.instagram.com/p/${code}/embed/` : null,
      aspect: isReel ? '9:16' : '1:1'
    }
  }

  // Twitter / X
  if (/twitter\.com|x\.com/.test(url)) {
    const meta = await fetchOEmbed(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`)
    return {
      type: 'twitter', media_id: url.match(/status\/(\d+)/)?.[1] || null,
      title: meta.author_name ? `@${meta.author_name}` : '',
      thumbnail_url: null, embed_url: null, aspect: null
    }
  }

  // Pinterest
  if (/pinterest\.com|pin\.it/.test(url)) {
    const resolved = /pin\.it/.test(url) ? await followRedirect(url) : url
    const meta = await fetchOEmbed(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(resolved || url)}`)
    return {
      type: 'pinterest', media_id: null,
      title: meta.title || '', thumbnail_url: meta.thumbnail_url || null,
      embed_url: null, aspect: null
    }
  }

  // Reddit
  if (/reddit\.com/.test(url)) {
    const meta = await fetchOEmbed(`https://www.reddit.com/oembed?url=${encodeURIComponent(url)}`)
    return {
      type: 'reddit', media_id: null,
      title: meta.title || '', thumbnail_url: meta.thumbnail_url || null,
      embed_url: null, aspect: null
    }
  }

  // Snapchat
  if (/snapchat\.com/.test(url)) {
    const meta = await fetchOEmbed(`https://www.snapchat.com/oembed?url=${encodeURIComponent(url)}`)
    return {
      type: 'snapchat', media_id: null,
      title: meta.title || '', thumbnail_url: meta.thumbnail_url || null,
      embed_url: null, aspect: null
    }
  }

  // Facebook — OG tags + video/reel plugin embed
  if (/facebook\.com|fb\.watch/.test(url)) {
    const isReel  = /\/reel\//.test(url)
    const isVideo = /\/videos\/|fb\.watch/.test(url) || isReel
    const og = await fetchOpenGraph(url)
    const embedUrl = isVideo
      ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&width=560`
      : null
    return {
      type: 'facebook', media_id: null,
      title: cleanFacebookTitle(og.title),
      thumbnail_url: og.image || null,
      embed_url: embedUrl,
      aspect: isReel ? '9:16' : isVideo ? '16:9' : null
    }
  }

  // Generic website — scrape Open Graph tags
  const og = await fetchOpenGraph(url)
  return {
    type: 'link', media_id: null,
    title: og.title || '',
    thumbnail_url: og.image || null,
    og_description: og.description || null,
    price: og.price || null,
    currency: og.currency || null,
    embed_url: null, aspect: null
  }
}

// ── AI image extraction from pasted HTML ─────────────────────────────────────

app.post('/api/extract-image', adminOnly, async (req, res) => {
  try {
    const { html, page_url } = req.body
    if (!html) return res.json({ image_url: null })

    // Pull candidate image URLs from the HTML without sending the whole thing to the model
    const candidates = new Set()

    // 1. OG / twitter image meta tags (best signal)
    const ogImgs = [...html.matchAll(/property="og:image"[^>]*content="([^"]+)"|content="([^"]+)"[^>]*property="og:image"/g)]
    ogImgs.forEach(m => { const u = m[1] || m[2]; if (u?.startsWith('http')) candidates.add(u) })

    // 2. JSON-LD "image" fields
    const ldImgs = [...html.matchAll(/"image"\s*:\s*"(https?:[^"]+)"/g)]
    ldImgs.forEach(m => candidates.add(m[1]))

    // 3. <img> tags with http src that look like product photos (skip icons/logos)
    const imgTags = [...html.matchAll(/<img[^>]+src="(https?:[^"]+)"/gi)]
    imgTags.forEach(([, src]) => {
      if (/\.(jpg|jpeg|png|webp)/i.test(src) && !/icon|logo|sprite|pixel|tracking|beacon/i.test(src)) {
        candidates.add(src)
      }
    })

    const list = [...candidates].slice(0, 30)
    if (list.length === 0) return res.json({ image_url: null })

    // If OG image exists, trust it directly — no need to ask the model
    const ogDirect = ogImgs[0]?.[1] || ogImgs[0]?.[2]
    if (ogDirect) return res.json({ image_url: decodeHtmlEntities(ogDirect) })

    // Ask Qwen to pick the best one from the candidate list
    const lmUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234'
    const model = process.env.LM_STUDIO_MODEL || ''
    const prompt = `Page URL: ${page_url || 'unknown'}\n\nImage URLs found on this page:\n${list.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n\nWhich number is the main product/item photo? Reply with ONLY the number.`

    const lmRes = await fetch(`${lmUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: lmHeaders(),
      body: JSON.stringify({
        model: model || undefined,
        messages: [
          { role: 'system', content: 'You identify the main product image from a list of image URLs. Reply with only the number.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 5,
        temperature: 0
      }),
      signal: AbortSignal.timeout(10000)
    })

    if (lmRes.ok) {
      const data = await lmRes.json()
      const answer = data.choices?.[0]?.message?.content?.trim()
      const idx = parseInt(answer) - 1
      if (!isNaN(idx) && list[idx]) return res.json({ image_url: decodeHtmlEntities(list[idx]) })
    }

    // Fallback: return the first candidate
    res.json({ image_url: decodeHtmlEntities(list[0]) })
  } catch (err) {
    console.error('extract-image error:', err.message)
    res.json({ image_url: null })
  }
})

// ── PIN ─────────────────────────────────────────────────────────────────────

app.get('/api/pin', async (req, res) => {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='pin_hash'")
  res.json({ set: rows.length > 0 })
})

async function adminUser() {
  const { rows } = await pool.query('SELECT * FROM users WHERE is_admin ORDER BY id LIMIT 1')
  return rows[0]
}

app.post('/api/pin/set', async (req, res) => {
  const { hash } = req.body
  if (!hash) return res.status(400).json({ error: 'missing hash' })
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('pin_hash', $1) ON CONFLICT (key) DO UPDATE SET value=$1",
    [hash]
  )
  const admin = await adminUser()
  res.json({ ok: true, token: admin.token, username: admin.username })
})

app.post('/api/pin/verify', async (req, res) => {
  const { hash } = req.body
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='pin_hash'")
  if (!rows.length) return res.json({ ok: false })
  if (rows[0].value !== hash) return res.json({ ok: false })
  const admin = await adminUser()
  res.json({ ok: true, token: admin.token, username: admin.username })
})

// ── Server-side AI model ─────────────────────────────────────────────────────

// Lists what this instance's own endpoint actually has loaded, so the picker
// offers real ids instead of asking someone to type one from memory.
app.get('/api/lm', adminOnly, async (req, res) => {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='lm_model'")
  const out = { url: LM_URL(), selected: rows[0]?.value || '', env_default: ENV_LM_MODEL, models: [] }
  try {
    const r = await fetch(`${LM_URL()}/v1/models`, { headers: lmHeaders(), signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`endpoint returned ${r.status}`)
    const data = await r.json()
    out.models = (data.data || []).map(m => m.id).filter(Boolean)
  } catch (err) {
    out.error = err.message
  }
  res.json(out)
})

app.put('/api/lm', adminOnly, async (req, res) => {
  const model = (req.body.model || '').trim()
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('lm_model', $1) ON CONFLICT (key) DO UPDATE SET value=$1",
    [model]
  )
  await applyLmModel()
  res.json({ selected: process.env.LM_STUDIO_MODEL || '' })
})

// ── Users, invites, membership ───────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'no session' })
  const { id, username, is_admin } = req.user
  res.json({ id, username, is_admin })
})

app.put('/api/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'no session' })
  const username = req.body.username?.trim()
  if (!username) return res.status(400).json({ error: 'username required' })
  const name = username.slice(0, 32)
  const { rows } = await pool.query(
    'UPDATE users SET username=$1 WHERE id=$2 RETURNING id, username, is_admin',
    [name, req.user.id]
  )
  // The instance owner's hub identity is the same person, so carry the rename up
  if (req.user.is_admin) await hub.setUsername(name).catch(err => console.error('hub rename:', err.message))
  res.json(rows[0])
})

// Sharing a category publishes it to the hub, which is what lets someone link it
// into their OWN instance rather than logging in to this one.
app.post('/api/categories/:id/invite', adminOnly, async (req, res) => {
  const categoryId = Number(req.params.id)
  try {
    if (!await hub.linkedShelf(categoryId)) {
      await hub.publish(categoryId, req.user.username)
    }
    const { code } = await hub.invite(categoryId)
    res.json({ code, hub: hub.url })
  } catch (err) {
    console.error('invite error:', err.message)
    res.status(502).json({ error: `could not reach the hub — ${err.message}` })
  }
})

// Link a shelf someone shared, into this instance, as a real local category.
app.post('/api/link', adminOnly, async (req, res) => {
  const code = String(req.body.code || '').trim()
  if (!/^[0-9]{6}$/.test(code)) return res.status(400).json({ error: 'six digits required' })
  try {
    const out = await hub.link(code, req.user.username)
    res.json(out)
  } catch (err) {
    const status = err.status === 404 ? 404 : 502
    res.status(status).json({ error: err.status === 404 ? 'invalid or expired code' : err.message })
  }
})

app.post('/api/categories/:id/sync', adminOnly, async (req, res) => {
  try {
    await hub.syncOne(Number(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/hub', adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.category_id, l.hub_shelf_id, l.last_seq, l.is_owner, l.synced_at, l.sync_error, c.name
       FROM linked_shelves l JOIN categories c ON c.id = l.category_id ORDER BY c.name`
  )
  const { rows: queued } = await pool.query('SELECT count(*)::int n FROM outbox')
  res.json({ url: hub.url, identity: await hub.identity(), shelves: rows, queued: queued[0].n })
})

app.get('/api/categories/:id/members', adminOnly, async (req, res) => {
  const categoryId = Number(req.params.id)
  // Membership lives on the hub — it spans instances, so there is nothing local to read.
  if (!await hub.linkedShelf(categoryId)) return res.json([])
  try {
    const me = await hub.identity()
    const members = await hub.members(categoryId)
    res.json(members.map(m => ({ ...m, is_me: String(m.id) === me.user_id })))
  } catch (err) {
    console.error('hub members:', err.message)
    res.status(502).json({ error: 'could not reach the hub' })
  }
})

// ── Categories ───────────────────────────────────────────────────────────────

app.get('/api/categories', adminOnly, async (req, res) => {
  // joined = someone else's shelf, so its drive is read-only and lives remotely
  const { rows } = await pool.query(
    `SELECT c.*, (l.category_id IS NOT NULL AND l.is_owner = FALSE) AS joined
       FROM categories c LEFT JOIN linked_shelves l ON l.category_id = c.id
      ORDER BY c.sort_order, c.id`)
  res.json(rows)
})

app.post('/api/categories', adminOnly, async (req, res) => {
  const { name, icon } = req.body
  const { rows } = await pool.query(
    'INSERT INTO categories (name, icon) VALUES ($1, $2) RETURNING *',
    [name, icon || '📁']
  )
  res.json(rows[0])
})

app.put('/api/categories/reorder', adminOnly, async (req, res) => {
  const { order } = req.body
  await Promise.all(order.map(({ id, sort_order }) =>
    pool.query('UPDATE categories SET sort_order=$1 WHERE id=$2', [sort_order, id])
  ))
  res.json({ ok: true })
})

app.put('/api/categories/:id', adminOnly, async (req, res) => {
  const { name, icon, archived } = req.body
  const { rows } = await pool.query(
    `UPDATE categories SET name=COALESCE($1,name), icon=COALESCE($2,icon),
                           archived=COALESCE($3,archived) WHERE id=$4 RETURNING *`,
    [name, icon, archived, req.params.id]
  )
  res.json(rows[0])
})

app.delete('/api/categories/:id', adminOnly, async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id])
  res.json({ ok: true })
})

// ── Subcategories ────────────────────────────────────────────────────────────

app.get('/api/categories/:id/subcategories', adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM subcategories WHERE category_id=$1 ORDER BY sort_order, id',
    [req.params.id]
  )
  res.json(rows)
})

app.post('/api/categories/:id/subcategories', adminOnly, async (req, res) => {
  const { name } = req.body
  const categoryId = Number(req.params.id)
  const { rows } = await pool.query(
    'INSERT INTO subcategories (category_id, name) VALUES ($1, $2) RETURNING *',
    [categoryId, name]
  )
  const sub = rows[0]

  // Same gap the card path had (see the note in processCard): without this,
  // a tab added after a shelf is shared stays invisible to every collaborator.
  if (await hub.linkedShelf(categoryId)) {
    try {
      const remote = await hub.postTab(categoryId, sub)
      if (remote) {
        await pool.query('UPDATE subcategories SET hub_tab_id=$1 WHERE id=$2', [remote.id, sub.id])
        sub.hub_tab_id = remote.id
      }
    } catch (err) {
      if (!err.queued) console.error('hub post tab failed:', err.message)
    }
  }

  logActivity(pool, hub, categoryId, 'tab_added', `added a tab: ${name}`).catch(() => {})
  res.json(sub)
})

app.put('/api/subcategories/reorder', adminOnly, async (req, res) => {
  const { order } = req.body
  await Promise.all(order.map(({ id, sort_order }) =>
    pool.query('UPDATE subcategories SET sort_order=$1 WHERE id=$2', [sort_order, id])
  ))
  res.json({ ok: true })
})

app.delete('/api/subcategories/:id', adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT category_id, name FROM subcategories WHERE id=$1', [req.params.id])
  await pool.query('DELETE FROM subcategories WHERE id=$1', [req.params.id])
  if (rows[0]) logActivity(pool, hub, rows[0].category_id, 'tab_removed', `removed a tab: ${rows[0].name}`).catch(() => {})
  res.json({ ok: true })
})

// ── Cards ────────────────────────────────────────────────────────────────────

app.get('/api/categories/:id/cards', adminOnly, async (req, res) => {
  const { subcategory_id } = req.query
  const me = await hub.identity()
  const shelf = await hub.linkedShelf(Number(req.params.id))
  // Only shared categories get a byline — your own cards stay unattributed.
  // hub_users covers people who posted from another instance.
  let query = `SELECT c.*, CASE WHEN cat.is_collab THEN COALESCE(u.username, hu.username) END AS author,
                      (c.hub_card_id IS NULL OR $2::boolean OR c.hub_user_id::text = $3) AS can_edit
               FROM cards c
               LEFT JOIN users u ON u.id = c.user_id
               LEFT JOIN hub_users hu ON hu.id = c.hub_user_id
               JOIN categories cat ON cat.id = c.category_id
               WHERE c.category_id=$1`
  const params = [req.params.id, !!shelf?.is_owner, me.user_id]
  if (subcategory_id) {
    query += ' AND c.subcategory_id=$4'
    params.push(subcategory_id)
  }
  query += ' ORDER BY c.created_at DESC'
  const { rows } = await pool.query(query, params)
  res.json(rows)
})

async function processCard(card) {
  const url = card.url
  let type = 'link', thumbnail_url = card.thumbnail_url, youtube_id = null
  let title = card.title || '', description = card.description
  let metadata = {}

  try {
    const platform = await resolvePlatform(url)
    if (platform) {
      type = platform.type
      youtube_id = platform.media_id
      if (!thumbnail_url) thumbnail_url = platform.thumbnail_url
      if (!title) title = platform.title || ''
      metadata = { embed_url: platform.embed_url, aspect: platform.aspect }
      if (platform.price) metadata.price = platform.price
      if (platform.currency) metadata.currency = platform.currency
      if (!description && (title || platform.og_description)) {
        description = await generateDescription(title || platform.og_description, url)
      }
    }
  } catch (err) {
    console.error('processCard error:', err.message)
  }

  const category = await classifyCard({ title, description, type })

  await pool.query(
    `UPDATE cards SET type=$1, title=$2, description=$3, thumbnail_url=$4, youtube_id=$5, metadata=$6, category=$7, status='ready' WHERE id=$8`,
    [type, title, description, thumbnail_url, youtube_id, JSON.stringify(metadata), category, card.id]
  )

  // On a linked shelf the hub is authoritative — push once the card is
  // finished, and adopt the id the hub hands back.
  if (!card.hub_card_id && await hub.linkedShelf(card.category_id)) {
    try {
      const remote = await hub.postCard(card.category_id, {
        subcategory_id: card.subcategory_id, type, url, title, description,
        thumbnail_url, youtube_id, notes: card.notes, metadata, category
      })
      await pool.query('UPDATE cards SET hub_card_id=$1 WHERE id=$2', [remote.id, card.id])
    } catch (err) {
      if (!err.queued) console.error('hub post failed:', err.message)
    }
  }
  logActivity(pool, hub, card.category_id, 'card_added', `added a card: ${title || url}`).catch(() => {})
}

async function applyPlanLinks(rawPlan, tools) {
  const resources = (await Promise.all(
    tools.map(async tool => {
      const url = await searchGitHub(tool) || await searchDDG(tool)
      return url ? { tool, url } : null
    })
  )).filter(Boolean)
  return resources.length ? injectLinks(rawPlan, resources) : rawPlan
}

app.post('/api/cards', async (req, res) => {
  try {
    const { subcategory_id, url } = req.body
    const { title = '', description = null, notes = null, thumbnail_url = null } = req.body

    // Derive the category from the tab so a collaborator can't write into an arbitrary one
    let category_id = req.body.category_id
    if (subcategory_id) {
      const { rows } = await pool.query('SELECT category_id FROM subcategories WHERE id=$1', [subcategory_id])
      if (!rows[0]) return res.status(404).json({ error: 'no such tab' })
      category_id = rows[0].category_id
    }

    const { rows: cat } = await pool.query('SELECT is_collab FROM categories WHERE id=$1', [category_id])
    if (!cat[0]) return res.status(404).json({ error: 'no such category' })
    const collab = cat[0].is_collab

    // One person owns this instance, so every write here is theirs
    if (!req.user?.is_admin) return res.status(403).json({ error: 'admin only' })

    const { rows } = await pool.query(
      `INSERT INTO cards (category_id, subcategory_id, url, title, description, notes, thumbnail_url, user_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`,
      [category_id, subcategory_id || null, url || null, title, description, notes, thumbnail_url, req.user.id]
    )
    const card = rows[0]
    res.json({ ...card, author: collab ? req.user.username : null })

    if (url) processCard(card).catch(err => console.error('processCard failed:', err.message))
  } catch (err) {
    console.error('POST /api/cards error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// On a linked shelf, a card belongs to whoever posted it — on whichever instance.
// Editing someone else's copy locally would silently diverge from the hub, which
// would reject the write anyway, so refuse it here.
//
// `enrich` is the exception: re-scraping or re-generating a plan makes a card
// better for the whole shelf rather than claiming it, so any member may do it
// to any card and the hub accepts the result (see cardRole in shelf-hub). The
// push back to the hub is what keeps it — the next pull would otherwise
// overwrite the improvement with the stale copy.
async function ownedCard(req, res, { enrich = false } = {}) {
  const { rows } = await pool.query(
    `SELECT c.*, CASE WHEN cat.is_collab THEN COALESCE(u.username, hu.username) END AS author
     FROM cards c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN hub_users hu ON hu.id = c.hub_user_id
     JOIN categories cat ON cat.id = c.category_id
     WHERE c.id=$1`,
    [req.params.id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'not found' }); return null }
  const card = rows[0]
  if (card.hub_card_id && !enrich) {
    const me = await hub.identity()
    const shelf = await hub.linkedShelf(card.category_id)
    const mine = card.hub_user_id != null && String(card.hub_user_id) === me.user_id
    if (!mine && !shelf?.is_owner) {
      res.status(403).json({ error: 'posted from another shelf' })
      return null
    }
  }
  return card
}

app.get('/api/cards/:id', async (req, res) => {
  const card = await ownedCard(req, res)
  if (card) res.json(card)
})

// Backfills the legend category on cards that predate the column (or came in
// through a path that skipped classification). Mirrors guide.js's own backfill.
app.post('/api/cards/backfill-categories', adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, title, description, type FROM cards WHERE category IS NULL AND status='ready'"
  )
  let updated = 0
  for (const row of rows) {
    const category = await classifyCard(row)
    if (!category) continue
    await pool.query('UPDATE cards SET category=$1 WHERE id=$2', [category, row.id])
    updated++
  }

  // Categories only started federating after this, so every card already on the
  // hub is up there with a null one — collaborators mirror it and get no tint.
  // hub_user_id IS NULL means this instance posted it, which is the only card a
  // member is allowed to PATCH anyway.
  const { rows: mine } = await pool.query(
    `SELECT c.* FROM cards c JOIN linked_shelves ls ON ls.category_id = c.category_id
      WHERE c.hub_card_id IS NOT NULL AND c.hub_user_id IS NULL AND c.category IS NOT NULL`
  )
  for (const row of mine) await hub.updateCard(row, { category: row.category }).catch(() => {})

  res.json({ checked: rows.length, updated, pushed: mine.length })
})

app.put('/api/cards/:id', async (req, res) => {
  const existing = await ownedCard(req, res)
  if (!existing) return
  const { title, description, notes } = req.body
  if (existing.hub_card_id) await hub.updateCard(existing, { title, description, notes }).catch(() => {})
  const { rows } = await pool.query(
    'UPDATE cards SET title=$1, description=$2, notes=$3 WHERE id=$4 RETURNING *',
    [title, description, notes, req.params.id]
  )
  // Notes autosave on every keystroke, so only log title/description changes —
  // otherwise the activity log would be mostly note-typing noise.
  if (title !== existing.title || description !== existing.description) {
    logActivity(pool, hub, existing.category_id, 'card_edited', `edited a card: ${title || existing.title}`).catch(() => {})
  }
  res.json(rows[0])
})

app.delete('/api/cards/:id', async (req, res) => {
  const card = await ownedCard(req, res)
  if (!card) return
  // Delete on the hub too, or every other instance keeps showing it
  if (card.hub_card_id) await hub.deleteCard(card).catch(() => {})
  await pool.query('DELETE FROM cards WHERE id=$1', [req.params.id])
  logActivity(pool, hub, card.category_id, 'card_removed', `removed a card: ${card.title || card.url}`).catch(() => {})
  res.json({ ok: true })
})

app.post('/api/cards/:id/share', async (req, res) => {
  const card = await ownedCard(req, res)
  if (!card) return
  const { rows: have } = await pool.query('SELECT token FROM card_share_tokens WHERE card_id=$1 LIMIT 1', [card.id])
  if (have[0]) return res.json({ token: have[0].token })
  const token = randomBytes(18).toString('hex')
  await pool.query('INSERT INTO card_share_tokens (token, card_id) VALUES ($1,$2)', [token, card.id])
  res.json({ token })
})

// Public read-only card page — no auth, this is the shareable link. The card
// itself has no bytes to stream (unlike a file share), so this renders a small
// standalone page instead, with OG tags so pasting the link shows a rich preview.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function renderSharedCard(card, shareUrl) {
  const price = card.metadata?.price
  const currency = card.metadata?.currency
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$'
  let hostFallback = 'Shared card'
  try { if (card.url) hostFallback = new URL(card.url).hostname } catch {}
  const title = card.title || hostFallback
  const desc = card.description || ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<meta property="og:title" content="${escHtml(title)}">
${desc ? `<meta property="og:description" content="${escHtml(desc)}">` : ''}
${card.thumbnail_url ? `<meta property="og:image" content="${escHtml(card.thumbnail_url)}">` : ''}
<meta property="og:url" content="${escHtml(shareUrl)}">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root { --bg:#0e0a00; --surface:#160f00; --border:#3d2e00; --amber:#e8840a; --amber-lit:#f0b458; --text-2:#c8a060; --text-3:#8a6a1a; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text-2); font-family:'JetBrains Mono',ui-monospace,monospace; min-height:100vh;
    display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:420px; background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  .card img { width:100%; max-height:260px; object-fit:cover; display:block; }
  .body { padding:18px; }
  h1 { font-size:18px; color:var(--amber-lit); line-height:1.35; margin-bottom:8px; }
  p { font-size:13px; line-height:1.6; color:var(--text-2); margin-bottom:16px; }
  .price { display:inline-block; font-weight:700; color:var(--amber-lit); margin-bottom:8px; }
  a.btn { display:inline-block; background:var(--amber); color:var(--bg); text-decoration:none; font-size:13px;
    font-weight:600; padding:9px 16px; border-radius:6px; }
  footer { text-align:center; font-size:11px; color:var(--text-3); margin-top:16px; letter-spacing:.04em; }
</style>
</head>
<body>
  <div>
    <div class="card">
      ${card.thumbnail_url ? `<img src="${escHtml(card.thumbnail_url)}" alt="">` : ''}
      <div class="body">
        <h1>${escHtml(title)}</h1>
        ${price ? `<div class="price">${symbol}${parseFloat(price).toFixed(2)}</div>` : ''}
        ${desc ? `<p>${escHtml(desc)}</p>` : ''}
        ${card.url ? `<a class="btn" href="${escHtml(card.url)}" target="_blank" rel="noreferrer">visit ↗</a>` : ''}
      </div>
    </div>
    <footer>shared via ShelfStation</footer>
  </div>
</body>
</html>`
}
app.get('/s/c/:token', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT c.* FROM card_share_tokens t JOIN cards c ON c.id = t.card_id WHERE t.token=$1', [req.params.token]
  )
  if (!rows[0]) return res.status(404).send('This link has expired or was revoked.')
  // Behind the cloudflared/Coolify proxy the raw socket is plain HTTP — trust
  // the forwarded header for the og:url tag rather than req.protocol.
  const proto = req.headers['x-forwarded-proto'] || req.protocol
  res.send(renderSharedCard(rows[0], `${proto}://${req.get('host')}${req.originalUrl}`))
})

function extractFromHtml(html) {
  const getMeta = (prop) =>
    html.match(new RegExp(`property="${prop}"[^>]*content="([^"]+)"`))?.[1] ||
    html.match(new RegExp(`content="([^"]+)"[^>]*property="${prop}"`))?.[1] ||
    html.match(new RegExp(`name="${prop}"[^>]*content="([^"]+)"`))?.[1] || ''

  let title = decodeHtmlEntities(getMeta('og:title') || getMeta('twitter:title') || '')
  if (!title) {
    const raw = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || ''
    title = decodeHtmlEntities(raw).replace(/\s*[-|:]\s*.{0,60}$/, '').trim()
  }

  let image = getMeta('og:image') || getMeta('twitter:image') || ''
  let price = null, currency = 'USD'
  const ogDescription = decodeHtmlEntities(getMeta('og:description') || getMeta('twitter:description') || '')

  const ldBlocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
  for (const [, block] of ldBlocks) {
    try {
      const data = JSON.parse(block)
      const items = Array.isArray(data) ? data : [data]
      const product = items.find(d => d['@type'] === 'Product' || d['@type'] === 'ItemPage')
      if (product) {
        if (!title && product.name) title = decodeHtmlEntities(String(product.name))
        if (!image) {
          const img = product.image
          image = Array.isArray(img) ? img[0] : (typeof img === 'string' ? img : img?.url || '')
        }
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers
        if (offer?.price) { price = String(offer.price); currency = offer.priceCurrency || 'USD' }
      }
    } catch {}
  }

  if (!price) {
    price = getMeta('product:price:amount') || getMeta('og:price:amount') ||
            html.match(/itemprop="price"[^>]*content="([^"]+)"/)?.[1] || null
    currency = getMeta('product:price:currency') || getMeta('og:price:currency') || 'USD'
  }

  const imgCandidates = [...new Set(
    [...html.matchAll(/<img[^>]+src="(https?:[^"]+)"/gi)]
      .map(m => m[1])
      .filter(s => /\.(jpg|jpeg|png|webp)/i.test(s) && !/icon|logo|sprite|pixel|tracking|beacon/i.test(s))
  )].slice(0, 25)

  return { title, image: image || null, price, currency, ogDescription, imgCandidates }
}

async function scrapeAndUpdate(card, html) {
  let { title, image, price, currency, ogDescription, imgCandidates } = extractFromHtml(html)
  if (/facebook\.com|fb\.watch/.test(card.url)) title = cleanFacebookTitle(title)

  const lmUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234'
  let finalImage = image
  let finalDescription = ogDescription

  // If no clear OG image, ask the model to pick from candidates
  if (!finalImage && imgCandidates.length > 0) {
    try {
      const lmRes = await fetch(`${lmUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: lmHeaders(),
        body: JSON.stringify({
          model: process.env.LM_STUDIO_MODEL || undefined,
          messages: [
            { role: 'system', content: 'You pick the main product image from a numbered list. Reply with only the number.' },
            { role: 'user', content: `Product: ${title || card.url}\n\n${imgCandidates.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n\nWhich is the main product photo?` }
          ],
          max_tokens: 5,
          temperature: 0
        }),
        signal: AbortSignal.timeout(15000)
      })
      if (lmRes.ok) {
        const data = await lmRes.json()
        const idx = parseInt(data.choices?.[0]?.message?.content?.trim()) - 1
        if (!isNaN(idx) && imgCandidates[idx]) finalImage = imgCandidates[idx]
      }
    } catch {}
    if (!finalImage) finalImage = imgCandidates[0]
  }

  // Always generate a punchy description with the model
  if (title) {
    finalDescription = await generateDescription(title, card.url) || ogDescription
  }

  const metadata = { ...(card.metadata || {}) }
  if (price) metadata.price = price
  if (currency) metadata.currency = currency

  return {
    title: title || card.title,
    thumbnail_url: finalImage || card.thumbnail_url,
    description: finalDescription,
    metadata
  }
}

app.post('/api/cards/:id/scrape', adminOnly, async (req, res) => {
  try {
    const card = await ownedCard(req, res, { enrich: true })
    if (!card) return
    if (!card.url) return res.status(400).json({ error: 'no url' })

    // Use a real headless Chromium browser — bypasses TLS fingerprinting and JS rendering
    let html = ''
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
      await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      // Wait a beat for JS-rendered content (prices, images)
      await page.waitForTimeout(2000)
      html = await page.content()
    } finally {
      await browser.close()
    }

    const updates = await scrapeAndUpdate(card, html)
    const { rows } = await pool.query(
      `UPDATE cards SET title=$1, thumbnail_url=$2, description=$3, metadata=$4 WHERE id=$5 RETURNING *`,
      [updates.title, updates.thumbnail_url, updates.description, JSON.stringify(updates.metadata), card.id]
    )
    if (card.hub_card_id) await hub.updateCard(card, updates).catch(() => {})
    res.json(rows[0])
  } catch (err) {
    console.error('scrape error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Plan generation ──────────────────────────────────────────────────────────

// strict: true never falls back to reasoning_content — for callers (like
// MACHINE's ask endpoint) where leaking the model's scratchpad to the user
// would be worse than an empty/short answer.
async function lmComplete(messages, { maxTokens = 800, temperature = 0.4, timeout = 180000, strict = false } = {}) {
  const lmUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234'
  const res = await fetch(`${lmUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: lmHeaders(),
    body: JSON.stringify({
      model: process.env.LM_STUDIO_MODEL || undefined,
      messages,
      max_tokens: maxTokens,
      temperature
    }),
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new Error(`LM Studio ${res.status}`)
  const data = await res.json()
  const msg = data.choices?.[0]?.message
  if (strict) return (msg?.content || '').trim()
  return (msg?.content?.trim() || msg?.reasoning_content?.trim() || '')
}

// Sorts a card into the same five buckets guides use (see guide.js's
// CATEGORIES), so the two features share one taxonomy and one legend instead
// of drifting into separate systems. Cheap and capped like guide.js's own
// writeBlurb — this only ever needs one word back.
async function classifyCard({ title, description, type }) {
  const user =
    `Title: ${title || '(none)'}\n` +
    `Type: ${type || 'link'}\n` +
    (description ? `Description: ${description}\n` : '') +
    '\nReply with exactly one word, no preamble: ' +
    'speed, thinking, design, tools, or reference — ' +
    'speed = performance/CLI/low-level utilities, thinking = AI/algorithms/data/logic, ' +
    'design = UI/CSS/visual/creative, tools = general dev libraries/frameworks/infra, ' +
    'reference = docs/curated lists/learning material.'
  try {
    const raw = await lmComplete([{ role: 'user', content: user }], { maxTokens: 400, temperature: 0.3, timeout: 45000 })
    const word = raw.trim().toLowerCase().match(/speed|thinking|design|tools|reference/)?.[0]
    return CATEGORIES.includes(word) ? word : 'reference'
  } catch {
    return null // LM Studio unreachable — leave uncategorized rather than guessing
  }
}

async function extractTools(plan) {
  try {
    const text = await lmComplete([
      { role: 'user', content: `Read this plan and list every tool, software, or app someone would need to download or find online. Output one name per line, nothing else:\n\n${plan}` }
    ], { maxTokens: 600, temperature: 0.3, timeout: 60000 })
    return text
      .split('\n')
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(l => l.length > 1 && l.length < 60)
      .slice(0, 10)
  } catch { return [] }
}

async function searchGitHub(query) {
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=3`,
      { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'shelf-cmd/1.0' }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const top = data.items?.[0]
    return top ? top.html_url : null
  } catch { return null }
}

async function searchDDG(query) {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'shelf-cmd/1.0' }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.AbstractURL || data.Results?.[0]?.FirstURL || null
  } catch { return null }
}

function injectLinks(plan, resources) {
  let out = plan
  for (const { tool, url } of resources) {
    // Match the tool name (case-insensitive, word boundary) on its first occurrence only
    const pattern = new RegExp(`(${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i')
    out = out.replace(pattern, `$1 [→ ${url}]`)
  }
  return out
}

app.post('/api/cards/:id/plan', adminOnly, async (req, res) => {
  try {
    const card = await ownedCard(req, res, { enrich: true })
    if (!card) return
    if (card.type !== 'youtube' || !card.youtube_id) return res.status(400).json({ error: 'not a youtube card' })

    const segments = await YoutubeTranscript.fetchTranscript(card.youtube_id)
    const transcript = segments.map(s => s.text).join(' ').slice(0, 10000)

    // Step 1 — generate plan from transcript
    const rawPlan = await lmComplete([
      {
        role: 'system',
        content: 'You are a technical assistant. You read tutorial transcripts and produce clean, actionable step-by-step plans. Output numbered markdown steps only — no preamble, no intro sentence, no sign-off.'
      },
      {
        role: 'user',
        content: `Tutorial: "${card.title || card.url}"\n\nTRANSCRIPT:\n${transcript}\n\n---\nRead this transcript carefully. Flag any steps that seem outdated, ambiguous, or potentially wrong — note corrections inline with [NOTE: ...]. Then output a numbered action plan someone (or an AI coding assistant like Claude Code) could follow right now to replicate this tutorial.`
      }
    ], { maxTokens: 1200, temperature: 0.4, timeout: 180000 })

    // Step 2 — extract tool names that need links
    const tools = await extractTools(rawPlan)
    console.log('plan tools identified:', tools)

    // Steps 3 & 4 — search GitHub + DDG for each tool, inject links on first mention
    const plan = await applyPlanLinks(rawPlan, tools)

    const metadata = { ...(card.metadata || {}), plan }
    const { rows } = await pool.query(
      'UPDATE cards SET metadata=$1 WHERE id=$2 RETURNING *',
      [JSON.stringify(metadata), card.id]
    )
    if (card.hub_card_id) await hub.updateCard(card, { metadata }).catch(() => {})
    logActivity(pool, hub, card.category_id, 'plan_regenerated', `generated a tutorial plan for: ${card.title || card.url}`).catch(() => {})
    res.json(rows[0])
  } catch (err) {
    console.error('plan error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Notes ────────────────────────────────────────────────────────────────────
app.get('/api/notes', adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM notes ORDER BY created_at DESC')
  res.json(rows)
})

app.post('/api/notes', adminOnly, async (req, res) => {
  const { content, label } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'content required' })
  const { rows } = await pool.query(
    'INSERT INTO notes (content, label) VALUES ($1, $2) RETURNING *',
    [content.trim(), label?.trim() || null]
  )
  res.json(rows[0])
})

app.delete('/api/notes/:id', adminOnly, async (req, res) => {
  await pool.query('DELETE FROM notes WHERE id=$1', [req.params.id])
  res.json({ ok: true })
})

// Drive: file storage per shelf. lmComplete is hoisted, so the blurb generator
// resolves fine even though it's defined further up.
mountDrive({ app, pool, adminOnly, adminOrToken, lmComplete, hub })
mountGuide({ app, pool, adminOnly, adminOrToken, hub })
mountChat({ app, pool, adminOnly, adminOrToken, hub, lmComplete })

// Unknown /api paths must not fall through to the SPA, or a stale client gets
// HTML where it expected JSON and fails with a parse error instead of a 404.
app.use('/api', (req, res) => res.status(404).json({ error: 'no such endpoint' }))

app.use(express.static(join(__dirname, '../dist')))
app.get('*', (req, res) => res.sendFile(join(__dirname, '../dist/index.html')))

initDb().then(async () => {
  await applyLmModel()
  app.listen(PORT, () => console.log(`shelf-cmd running on :${PORT}`))
  // Pull linked shelves and flush anything queued while the hub was unreachable
  if (process.env.HUB_SYNC !== 'off') hub.startLoop(Number(process.env.HUB_SYNC_MS) || 30000)
})
