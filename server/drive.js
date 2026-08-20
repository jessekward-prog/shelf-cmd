// The Drive: files stored on this box, shown on a shelf like cards.
// Wired onto the app by index.js so all the multer/sharp/fs weight stays here.
import multer from 'multer'
import sharp from 'sharp'
import { randomBytes } from 'crypto'
import { mkdirSync, createReadStream, existsSync } from 'fs'
import { unlink, readFile, stat } from 'fs/promises'
import { join, extname } from 'path'

const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads')
const THUMBS_DIR = join(UPLOADS_DIR, 'thumbs')
mkdirSync(THUMBS_DIR, { recursive: true })

const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 512) * 1024 * 1024

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.css', '.html', '.htm', '.xml', '.yml', '.yaml', '.sh', '.sql', '.log'])

// Read up to this much of a text file for the AI scan. HTML/markup is stripped
// to visible text first, so a big page still yields a meaningful excerpt.
const TEXT_SCAN_MAX = 8 * 1024 * 1024

function stripHtml(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function kindOf(name, mime = '') {
  const ext = extname(name).toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'].includes(ext)) return 'archive'
  if (TEXT_EXT.has(ext) || mime.startsWith('text/')) return 'doc'
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.pages'].includes(ext)) return 'doc'
  return 'other'
}

const KIND_GLYPH = { image: 'IMG', video: 'VID', audio: 'WAV', pdf: 'PDF', doc: 'DOC', archive: 'ZIP', other: 'BIN' }

function fmtBytes(b) {
  if (!b) return '0 B'
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), s.length - 1)
  return `${(b / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${s[i]}`
}

const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))

// A card thumbnail for anything that isn't an image: a phosphor plate with the
// file's kind and name. Rendered through sharp so every card has real artwork.
async function placeholderThumb(name, kind, destPath) {
  const glyph = KIND_GLYPH[kind] || 'BIN'
  const label = esc(name.length > 30 ? name.slice(0, 29) + '…' : name)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <rect width="600" height="400" fill="#140e00"/>
    <rect width="600" height="400" fill="none" stroke="#3d2e00" stroke-width="2"/>
    <text x="300" y="185" text-anchor="middle" font-family="monospace" font-weight="700" font-size="86" fill="#e8840a" letter-spacing="6">${glyph}</text>
    <text x="300" y="250" text-anchor="middle" font-family="monospace" font-size="20" fill="#8a6a1a" letter-spacing="4">FILE</text>
    <rect x="0" y="352" width="600" height="48" fill="#0e0a00"/>
    <text x="20" y="382" font-family="monospace" font-size="19" fill="#c8a060">${label}</text>
  </svg>`
  await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(destPath)
}

async function makeThumb(storedName, name, kind) {
  const dest = join(THUMBS_DIR, storedName + '.jpg')
  if (kind === 'image') {
    await sharp(join(UPLOADS_DIR, storedName)).rotate()
      .resize(600, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true }).toFile(dest)
  } else {
    await placeholderThumb(name, kind, dest)
  }
  return dest
}

// One-liner an uploader sees on the card, so a collaborator knows what a file is
// without downloading it. Scans text-like files; falls back to name + type.
async function makeBlurb(lmComplete, { path, name, kind, mime, size }) {
  let excerpt = ''
  const ext = extname(name).toLowerCase()
  const textLike = TEXT_EXT.has(ext) || (mime || '').startsWith('text/')
  if (textLike && size < TEXT_SCAN_MAX) {
    try {
      let raw = await readFile(path, 'utf8')
      if (ext === '.html' || ext === '.htm' || (mime || '').includes('html')) raw = stripHtml(raw)
      excerpt = raw.slice(0, 4000)
    } catch {}
  }
  const prompt = excerpt
    ? `In one plain sentence, say what this file is and what it's for, so a teammate can decide whether to open it. Filename: ${name}. Begins:\n\n${excerpt}\n\nReply with only the sentence, no preamble.`
    : `In one short plain sentence, describe what this file most likely is for a teammate, from its name and type only. Filename: ${name}. Type: ${mime || kind}, ${fmtBytes(size)}. Reply with only the sentence.`
  const out = await lmComplete([{ role: 'user', content: prompt }], { maxTokens: 500, temperature: 0.4, timeout: 90000 })
  return cleanBlurb(out) || null
}

// Local LLMs are often reasoning models that dump their working into the answer
// ("<think>…</think>" or "Thinking Process: 1. …"). The blurb is the conclusion,
// so strip the thinking and keep the last real sentence. See the reasoning-model
// latency lesson: instruct models are better for this, but we can't assume one.
function cleanBlurb(raw) {
  let t = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim()
  const paras = t.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  // If it reasoned, the answer is the last paragraph; otherwise there's just one.
  const looksLikeThinking = /^(thinking|reasoning|analysis|let me|okay|first,|step \d)/i.test(t) || /thinking process/i.test(t)
  let s = (looksLikeThinking && paras.length > 1) ? paras[paras.length - 1] : (paras[0] || t)
  s = s.replace(/^["']+|["']+$/g, '')
       .replace(/^\**\s*(final answer|answer|blurb|description|here'?s?[^:]*)\s*[:*-]*\s*/i, '')
       .replace(/^[-*•\d.)\s]+/, '')
       .replace(/\s+/g, ' ')
       .trim()
  // A leftover multi-sentence dump: keep the first sentence.
  if (s.length > 240) s = s.slice(0, s.indexOf('. ') > 40 ? s.indexOf('. ') + 1 : 240)
  return s.trim()
}

export function mountDrive({ app, pool, adminOnly, lmComplete }) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, randomBytes(16).toString('hex') + extname(file.originalname).slice(0, 12))
  })
  const upload = multer({ storage, limits: { fileSize: MAX_BYTES } })

  // Build thumbnail + AI blurb after the row exists, then flip to ready.
  async function process(id, path) {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [id])
    const f = rows[0]
    if (!f) return
    let hasThumb = false, blurb = null
    try { await makeThumb(f.stored_name, f.name, f.kind); hasThumb = true } catch (e) { console.error('thumb:', e.message) }
    try { blurb = await makeBlurb(lmComplete, { path, name: f.name, kind: f.kind, mime: f.mime_type, size: Number(f.size) }) }
    catch (e) { console.error('blurb:', e.message) }
    await pool.query('UPDATE files SET has_thumb=$1, blurb=$2, status=$3 WHERE id=$4', [hasThumb, blurb, 'ready', id])
  }

  app.post('/api/categories/:id/files', adminOnly, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'no file' })
      const catId = Number(req.params.id)
      const subId = req.body.subcategory_id ? Number(req.body.subcategory_id) : null
      const name = req.file.originalname
      const kind = kindOf(name, req.file.mimetype)
      const { rows } = await pool.query(
        `INSERT INTO files (category_id, subcategory_id, user_id, name, stored_name, mime_type, kind, size, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`,
        [catId, subId, req.user.id, name, req.file.filename, req.file.mimetype, kind, req.file.size]
      )
      const file = rows[0]
      res.json(file)
      process(file.id, req.file.path).catch(e => console.error('process:', e.message))
    } catch (err) {
      console.error('upload:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/categories/:id/files', adminOnly, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM files WHERE category_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json(rows)
  })

  app.get('/api/files/:id', adminOnly, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json(rows[0])
  })

  app.delete('/api/files/:id', adminOnly, async (req, res) => {
    const { rows } = await pool.query('DELETE FROM files WHERE id=$1 RETURNING stored_name', [req.params.id])
    if (rows[0]) {
      await unlink(join(UPLOADS_DIR, rows[0].stored_name)).catch(() => {})
      await unlink(join(THUMBS_DIR, rows[0].stored_name + '.jpg')).catch(() => {})
    }
    res.json({ ok: true })
  })

  // Auth-gated bytes for the owner's own UI. <img>/<a> can't send a bearer
  // header, so these also accept the admin token as ?t= (unguessable capability).
  async function ownerOrToken(req, res, next) {
    if (req.user?.is_admin) return next()
    if (req.query.t) {
      const { rows } = await pool.query('SELECT is_admin FROM users WHERE token=$1', [req.query.t])
      if (rows[0]?.is_admin) return next()
    }
    res.status(403).json({ error: 'admin only' })
  }
  app.get('/api/files/:id/raw', ownerOrToken, (req, res) => sendFile(res, req.params.id, req.query.dl === '1'))
  app.get('/api/files/:id/thumb', ownerOrToken, (req, res) => sendThumb(res, req.params.id))

  app.post('/api/files/:id/share', adminOnly, async (req, res) => {
    const { rows: have } = await pool.query('SELECT token FROM file_share_tokens WHERE file_id=$1 LIMIT 1', [req.params.id])
    if (have[0]) return res.json({ token: have[0].token })
    const token = randomBytes(18).toString('hex')
    await pool.query('INSERT INTO file_share_tokens (token, file_id) VALUES ($1,$2)', [token, req.params.id])
    res.json({ token })
  })

  // Public download by share token — no auth, this is the shareable link.
  app.get('/s/:token', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT f.* FROM file_share_tokens t JOIN files f ON f.id=t.file_id WHERE t.token=$1', [req.params.token])
    if (!rows[0]) return res.status(404).send('This link has expired or was revoked.')
    streamFile(res, rows[0], req.query.dl === '1')
  })

  async function sendFile(res, id, download) {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    streamFile(res, rows[0], download)
  }
  async function sendThumb(res, id) {
    const { rows } = await pool.query('SELECT stored_name, has_thumb FROM files WHERE id=$1', [id])
    const p = rows[0] && join(THUMBS_DIR, rows[0].stored_name + '.jpg')
    if (!p || !existsSync(p)) return res.status(404).end()
    res.type('image/jpeg'); createReadStream(p).pipe(res)
  }
  function streamFile(res, f, download) {
    const p = join(UPLOADS_DIR, f.stored_name)
    if (!existsSync(p)) return res.status(404).send('File is no longer available.')
    if (f.mime_type) res.type(f.mime_type)
    res.setHeader('Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`)
    createReadStream(p).pipe(res)
  }
}
