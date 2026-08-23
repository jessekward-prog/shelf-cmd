// The Drive: files stored on this box, shown on a shelf like cards.
// Wired onto the app by index.js so all the multer/sharp/fs weight stays here.
import multer from 'multer'
import sharp from 'sharp'
import archiver from 'archiver'
import { randomBytes } from 'crypto'
import { mkdirSync, createReadStream, existsSync } from 'fs'
import { unlink, readFile, stat } from 'fs/promises'
import { Readable } from 'stream'
import { join, extname } from 'path'
import { logActivity } from './chat.js'

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
// Internal plumbing from an uploaded folder (.git objects, node_modules, lockfiles).
// A blurb for these is meaningless, and a repo drop would otherwise queue one slow
// model call per object.
function isInternalPath(name) {
  return /(^|\/)(\.git|node_modules|\.next|dist|\.cache|__pycache__)\//.test(name)
}

async function makeBlurb(lmComplete, { path, name, kind, mime, size }) {
  if (isInternalPath(name)) return null
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
  // Room for reasoning models to think and still land the sentence.
  const out = await lmComplete([{ role: 'user', content: prompt }], { maxTokens: 800, temperature: 0.4, timeout: 90000 })
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

export function mountDrive({ app, pool, adminOnly, adminOrToken, lmComplete, hub }) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, randomBytes(16).toString('hex') + extname(file.originalname).slice(0, 12))
  })
  const upload = multer({ storage, limits: { fileSize: MAX_BYTES } })

  // multer errors (e.g. oversize) otherwise fall through to the HTML error page;
  // turn them into the JSON the client expects.
  const uploadOne = (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `file too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB)` : err.message
      return res.status(400).json({ error: msg })
    }
    next()
  })

  // Build thumbnail + AI blurb after the row exists, then flip to ready.
  async function processFile(id, path) {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [id])
    const f = rows[0]
    if (!f) return
    let hasThumb = false, blurb = null
    try { await makeThumb(f.stored_name, f.name, f.kind); hasThumb = true } catch (e) { console.error('thumb:', e.message) }
    try { blurb = await makeBlurb(lmComplete, { path, name: f.name, kind: f.kind, mime: f.mime_type, size: Number(f.size) }) }
    catch (e) { console.error('blurb:', e.message) }
    await pool.query('UPDATE files SET has_thumb=$1, blurb=$2, status=$3 WHERE id=$4', [hasThumb, blurb, 'ready', id])
  }

  // A restart mid-scan (e.g. a redeploy while a slow blurb runs) would otherwise
  // leave a file spinning on 'pending' forever. Re-run those on boot.
  pool.query("SELECT id, stored_name FROM files WHERE status='pending'")
    .then(({ rows }) => rows.forEach(f =>
      processFile(f.id, join(UPLOADS_DIR, f.stored_name)).catch(e => console.error('resume:', e.message))))
    .catch(() => {})

  app.post('/api/categories/:id/files', adminOnly, uploadOne, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'no file' })
      const catId = Number(req.params.id)
      const subId = req.body.subcategory_id ? Number(req.body.subcategory_id) : null
      // A folder upload sends the file's path (e.g. "trip/day1/img.jpg") as name,
      // so the card keeps that context even though the drive itself is flat.
      const name = (req.body.name || req.file.originalname || 'file').slice(0, 400)
      const kind = kindOf(name, req.file.mimetype)
      const { rows } = await pool.query(
        `INSERT INTO files (category_id, subcategory_id, user_id, name, stored_name, mime_type, kind, size, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`,
        [catId, subId, req.user.id, name, req.file.filename, req.file.mimetype, kind, req.file.size]
      )
      const file = rows[0]
      res.json(file)
      processFile(file.id, req.file.path).catch(e => console.error('process:', e.message))
      logActivity(pool, hub, catId, 'file_added', `uploaded a file: ${name}`).catch(() => {})
    } catch (err) {
      console.error('upload:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  // A shelf you joined shows the owner's drive, not your own empty one. The
  // files stay on their machine; only the listing crosses the wire.
  app.get('/api/categories/:id/files', adminOnly, async (req, res) => {
    const catId = Number(req.params.id)
    const remote = await remoteShelf(catId)
    if (remote) {
      try {
        const files = await remoteCall(catId, '/files')
        return res.json(files.map(f => ({
          ...f,
          remote: true,
          thumb_url: f.has_thumb ? `/api/categories/${catId}/remote/${f.id}/thumb` : null,
          raw_url: `/api/categories/${catId}/remote/${f.id}/raw`
        })))
      } catch (err) {
        // Their box being off is ordinary, not a failure. Keep the array
        // contract the client expects and say so in a header instead.
        res.setHeader('X-Drive-Unreachable', err.message.slice(0, 120))
        return res.json([])
      }
    }
    const { rows } = await pool.query(
      'SELECT * FROM files WHERE category_id=$1 ORDER BY created_at DESC',
      [catId]
    )
    res.json(rows)
  })

  // ── Reading another instance's drive (member side) ────────────────────────

  async function remoteShelf(categoryId) {
    const { rows } = await pool.query(
      'SELECT * FROM linked_shelves WHERE category_id=$1 AND is_owner=FALSE', [categoryId])
    return rows[0] || null
  }

  // Fetch from the owner's box with a fresh ticket. Tickets are cheap and
  // short-lived, so we mint one per request rather than caching a stale one.
  async function remoteFetch(categoryId, path, { stream = false } = {}) {
    const { ticket, origin, hubShelfId } = await hub.ticketFor(categoryId)
    const url = `${origin}/api/shared/${hubShelfId}${path}`
    const sep = url.includes('?') ? '&' : '?'
    const r = await fetch(url + sep + 'ticket=' + encodeURIComponent(ticket),
      { signal: AbortSignal.timeout(stream ? 120000 : 15000) })
    if (!r.ok) throw new Error(`owner's shelf returned ${r.status}`)
    return r
  }

  const remoteCall = async (categoryId, path) => (await remoteFetch(categoryId, path)).json()

  // Proxy the bytes rather than redirecting: the browser holds no ticket, and
  // this keeps the owner's address out of the page.
  async function remoteStream(req, res, path) {
    const catId = Number(req.params.id)
    if (!await remoteShelf(catId)) return res.status(404).json({ error: 'not a joined shelf' })
    try {
      const r = await remoteFetch(catId, path, { stream: true })
      for (const h of ['content-type', 'content-length', 'content-disposition']) {
        const v = r.headers.get(h)
        if (v) res.setHeader(h, v)
      }
      Readable.fromWeb(r.body).pipe(res)
    } catch (err) {
      res.status(502).json({ error: err.message })
    }
  }

  app.get('/api/categories/:id/remote/:fileId/raw', adminOrToken, (req, res) =>
    remoteStream(req, res, `/files/${Number(req.params.fileId)}/raw${req.query.dl === '1' ? '?dl=1' : ''}`))
  app.get('/api/categories/:id/remote/:fileId/thumb', adminOrToken, (req, res) =>
    remoteStream(req, res, `/files/${Number(req.params.fileId)}/thumb`))

  // ── Serving this instance's drive to members (owner side) ─────────────────

  // Redeeming costs a hub round trip, so hold the answer for the ticket's life.
  const seen = new Map()
  async function ticketGate(req, res, next) {
    const ticket = String(req.query.ticket || '')
    if (!ticket) return res.status(401).json({ error: 'ticket required' })
    try {
      let who = seen.get(ticket)
      if (!who) {
        who = await hub.redeemTicket(ticket)
        seen.set(ticket, who)
        setTimeout(() => seen.delete(ticket), 5 * 60 * 1000).unref?.()
      }
      if (who.shelf_id !== Number(req.params.shelfId)) {
        return res.status(403).json({ error: 'ticket is for another shelf' })
      }
      const { rows } = await pool.query(
        'SELECT category_id FROM linked_shelves WHERE hub_shelf_id=$1 AND is_owner=TRUE', [who.shelf_id])
      if (!rows[0]) return res.status(404).json({ error: 'shelf not published here' })
      req.sharedCategoryId = rows[0].category_id
      next()
    } catch (err) {
      res.status(403).json({ error: err.message })
    }
  }

  // Scoped to the shared category on purpose: a ticket for one shelf must never
  // reach a file sitting on a different one.
  async function sharedFile(req) {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1 AND category_id=$2',
      [Number(req.params.fileId), req.sharedCategoryId])
    return rows[0] || null
  }

  app.get('/api/shared/:shelfId/files', ticketGate, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, mime_type, kind, size, has_thumb, blurb, status, created_at
         FROM files WHERE category_id=$1 ORDER BY created_at DESC`,
      [req.sharedCategoryId]
    )
    res.json(rows)
  })

  app.get('/api/shared/:shelfId/files/:fileId/raw', ticketGate, async (req, res) => {
    const f = await sharedFile(req)
    if (!f) return res.status(404).json({ error: 'not found' })
    streamFile(res, f, req.query.dl === '1')
  })

  app.get('/api/shared/:shelfId/files/:fileId/thumb', ticketGate, async (req, res) => {
    const f = await sharedFile(req)
    if (!f) return res.status(404).end()
    sendThumb(res, f.id)
  })

  app.get('/api/files/:id', adminOnly, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json(rows[0])
  })

  app.delete('/api/files/:id', adminOnly, async (req, res) => {
    const { rows } = await pool.query('DELETE FROM files WHERE id=$1 RETURNING stored_name, category_id, name', [req.params.id])
    if (rows[0]) {
      await unlink(join(UPLOADS_DIR, rows[0].stored_name)).catch(() => {})
      await unlink(join(THUMBS_DIR, rows[0].stored_name + '.jpg')).catch(() => {})
      logActivity(pool, hub, rows[0].category_id, 'file_removed', `removed a file: ${rows[0].name}`).catch(() => {})
    }
    res.json({ ok: true })
  })

  // ── Folders ───────────────────────────────────────────────────────────────
  // A folder isn't a row: it's the path prefix carried in files.name. That means
  // anything already uploaded groups up without a migration.

  // LIKE-escape, so a folder literally named "a_b" doesn't match "axb".
  const likePrefix = (p) => p.replace(/([\\%_])/g, '\\$1') + '/%'

  async function folderFiles(categoryId, prefix) {
    const { rows } = await pool.query(
      `SELECT * FROM files WHERE category_id=$1 AND name LIKE $2 ESCAPE '\\' ORDER BY name`,
      [categoryId, likePrefix(prefix)]
    )
    return rows
  }

  app.delete('/api/categories/:id/folder', adminOnly, async (req, res) => {
    const prefix = String(req.query.prefix || '')
    if (!prefix) return res.status(400).json({ error: 'prefix required' })
    const files = await folderFiles(req.params.id, prefix)
    if (!files.length) return res.status(404).json({ error: 'no such folder' })
    await pool.query(
      `DELETE FROM files WHERE category_id=$1 AND name LIKE $2 ESCAPE '\\'`,
      [req.params.id, likePrefix(prefix)]
    )
    for (const f of files) {
      await unlink(join(UPLOADS_DIR, f.stored_name)).catch(() => {})
      await unlink(join(THUMBS_DIR, f.stored_name + '.jpg')).catch(() => {})
    }
    res.json({ ok: true, deleted: files.length })
  })

  app.post('/api/categories/:id/folder/share', adminOnly, async (req, res) => {
    const prefix = String(req.body?.prefix || '')
    if (!prefix) return res.status(400).json({ error: 'prefix required' })
    const key = `${req.params.id}:${prefix}`
    const { rows: have } = await pool.query(
      'SELECT token FROM folder_share_tokens WHERE folder_key=$1 LIMIT 1', [key])
    if (have[0]) return res.json({ token: have[0].token })
    const token = randomBytes(18).toString('hex')
    await pool.query(
      'INSERT INTO folder_share_tokens (token, folder_key, category_id, prefix) VALUES ($1,$2,$3,$4)',
      [token, key, req.params.id, prefix])
    res.json({ token })
  })

  // Zip a folder subtree. Used by the owner's download and the public share link.
  // A folder on a joined (non-owned) shelf has no local files rows or bytes —
  // its content only exists on the owner's box — so it has to go through the
  // same ticket proxy the single-file remote routes use.
  async function streamZip(res, categoryId, prefix) {
    // Everything that can fail before a byte is written happens up front, so a
    // dead hub/owner box gets a real error response instead of a hung request
    // (neither caller of streamZip awaits it or catches a rejection).
    let remote, files, ticket, origin, hubShelfId
    try {
      remote = await remoteShelf(categoryId)
      files = remote
        ? (await remoteCall(categoryId, '/files')).filter(f => f.name.startsWith(prefix + '/'))
        : await folderFiles(categoryId, prefix)
      if (remote && files.length) ({ ticket, origin, hubShelfId } = await hub.ticketFor(categoryId))
    } catch (err) {
      return res.status(502).send(`could not reach the owner's shelf — ${err.message}`)
    }
    if (!files.length) return res.status(404).send('Folder is empty or no longer available.')
    const base = prefix.split('/').pop() || 'folder'
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition',
      `attachment; filename="${encodeURIComponent(base)}.zip"`)
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', () => res.destroy())
    archive.pipe(res)
    if (remote) {
      // One ticket for the whole zip, not one per file — the owner's box caches
      // a redeemed ticket for 5 minutes for exactly this reason (see ticketGate).
      for (const f of files) {
        try {
          const r = await fetch(`${origin}/api/shared/${hubShelfId}/files/${f.id}/raw?ticket=${encodeURIComponent(ticket)}`,
            { signal: AbortSignal.timeout(120000) })
          if (!r.ok) throw new Error(`owner's shelf returned ${r.status}`)
          archive.append(Readable.fromWeb(r.body), { name: f.name.slice(prefix.length + 1) })
        } catch { /* owner's box unreachable for this file — skip it, zip the rest */ }
      }
    } else {
      for (const f of files) {
        const p = join(UPLOADS_DIR, f.stored_name)
        if (existsSync(p)) archive.file(p, { name: f.name.slice(prefix.length + 1) })
      }
    }
    archive.finalize()
  }

  app.get('/api/categories/:id/folder/zip', adminOrToken, (req, res) =>
    streamZip(res, req.params.id, String(req.query.prefix || '')))

  app.get('/s/f/:token', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT category_id, prefix FROM folder_share_tokens WHERE token=$1', [req.params.token])
    if (!rows[0]) return res.status(404).send('This link has expired or was revoked.')
    streamZip(res, rows[0].category_id, rows[0].prefix)
  })

  // adminOrToken (passed in) covers the owner's own UI too: <img>/<a> can't
  // send a bearer header, so it also accepts the admin token as ?t=.
  app.get('/api/files/:id/raw', adminOrToken, (req, res) => sendFile(res, req.params.id, req.query.dl === '1'))
  app.get('/api/files/:id/thumb', adminOrToken, (req, res) => sendThumb(res, req.params.id))

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
