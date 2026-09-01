// Ported from shelf-hub/server.js — this instance acting as a hub for OTHER
// people's shelf-cmd instances to share through, toggleable from the Shelf
// Hubs page. Same protocol, same rate-limiting, same tables — just mounted
// under /relay on this app's own server instead of running as its own
// process, and gated live on a settings flag instead of on/off at boot.
//
// Keep this in sync with shelf-hub/server.js by hand — no shared package
// between the two repos, and that's fine at this size; the two have already
// drifted once (reply threading, reactions) and porting the diff each time
// is cheaper than the machinery to avoid it.

import express from 'express'
import pg from 'pg'
import { Server } from 'socket.io'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const newToken = () => randomBytes(24).toString('hex')

export function mountHostedHub({ app, httpServer, mainPool }) {
  // Isolated schema, isolated pool — every query here is unqualified (just
  // like shelf-hub's own) and resolves against hosted_hub because that's
  // this pool's default search_path, not because the SQL says so.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c search_path=hosted_hub,public'
  })

  async function initDb() {
    await pool.query(await readFile(join(__dirname, 'hosted-hub-schema.sql'), 'utf8'))
  }

  async function hostedHubEnabled() {
    const { rows } = await mainPool.query("SELECT value FROM settings WHERE key='hosted_hub_enabled'")
    return rows[0]?.value === 'true'
  }

  async function role(userId, shelfId) {
    const { rows } = await pool.query(
      `SELECT s.owner_user_id = $1 AS is_owner,
              EXISTS (SELECT 1 FROM shelf_members m WHERE m.shelf_id=s.id AND m.user_id=$1) AS is_member
         FROM shelves s WHERE s.id=$2`,
      [userId, shelfId]
    )
    return rows[0] || { is_owner: false, is_member: false }
  }

  async function nextSeq(client, shelfId) {
    const { rows } = await client.query(
      'UPDATE shelves SET seq = seq + 1 WHERE id=$1 RETURNING seq',
      [shelfId]
    )
    return rows[0].seq
  }

  async function tx(fn) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const out = await fn(client)
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // ── Rate limiting — identical to shelf-hub's own ──────────────────────────
  const hits = new Map()
  function rateLimit(key, max, windowMs) {
    const now = Date.now()
    const rec = hits.get(key)
    if (!rec || now > rec.reset) {
      hits.set(key, { n: 1, reset: now + windowMs })
      return true
    }
    rec.n += 1
    return rec.n <= max
  }
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k)
  }, 60_000).unref()

  // ── Router ─────────────────────────────────────────────────────────────
  // cors()/express.json() are already applied globally by index.js.
  const router = express.Router()

  router.use(async (req, res, next) => {
    if (!(await hostedHubEnabled())) return res.status(503).json({ error: 'hub not enabled on this instance' })
    next()
  })

  router.use(async (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    if (!token) return next()
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE token=$1', [token])
      req.user = rows[0]
    } catch { /* fall through unauthenticated */ }
    next()
  })

  const requireUser = (req, res, next) =>
    req.user ? next() : res.status(401).json({ error: 'user token required' })

  router.get('/me', requireUser, (req, res) => {
    res.json({ id: req.user.id, username: req.user.username })
  })

  router.put('/me', requireUser, async (req, res) => {
    const username = req.body.username?.trim()
    if (!username) return res.status(400).json({ error: 'username required' })
    const { rows } = await pool.query(
      'UPDATE users SET username=$1 WHERE id=$2 RETURNING id, username',
      [username.slice(0, 32), req.user.id]
    )
    res.json(rows[0])
  })

  router.post('/shelves', async (req, res) => {
    try {
      const { name, icon = null, tabs = [], cards = [] } = req.body
      if (!name?.trim()) return res.status(400).json({ error: 'name required' })

      let user = req.user
      if (!user) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip
        if (!rateLimit(`newuser:${ip}`, 10, 3_600_000)) {
          return res.status(429).json({ error: 'too many new accounts from this address, try later' })
        }
        const username = req.body.username?.trim()
        if (!username) return res.status(400).json({ error: 'username required' })
        const { rows } = await pool.query(
          'INSERT INTO users (username, token) VALUES ($1,$2) RETURNING *',
          [username.slice(0, 32), newToken()]
        )
        user = rows[0]
      }

      const out = await tx(async (client) => {
        const { rows: s } = await client.query(
          'INSERT INTO shelves (name, icon, owner_user_id) VALUES ($1,$2,$3) RETURNING *',
          [name.trim(), icon, user.id]
        )
        const shelf = s[0]
        await client.query(
          'INSERT INTO shelf_members (shelf_id, user_id) VALUES ($1,$2)',
          [shelf.id, user.id]
        )

        const tabMap = {}
        for (const t of tabs) {
          const { rows } = await client.query(
            'INSERT INTO shelf_tabs (shelf_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id',
            [shelf.id, t.name, t.sort_order || 0]
          )
          tabMap[t.local_id ?? t.name] = rows[0].id
        }

        for (const c of cards) {
          const seq = await nextSeq(client, shelf.id)
          await client.query(
            `INSERT INTO cards (shelf_id, tab_id, user_id, type, url, title, description,
                                thumbnail_url, media_id, notes, metadata, category, seq)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [shelf.id, tabMap[c.tab_local_id] || null, user.id, c.type || 'link', c.url,
             c.title, c.description, c.thumbnail_url, c.media_id, c.notes,
             JSON.stringify(c.metadata || {}), c.category || null, seq]
          )
        }

        const { rows: fresh } = await client.query('SELECT seq FROM shelves WHERE id=$1', [shelf.id])
        return { ...shelf, seq: fresh[0].seq, tab_map: tabMap }
      })

      res.json({ shelf: out, token: user.token, user: { id: user.id, username: user.username } })
    } catch (err) {
      console.error('hosted-hub POST /shelves', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/shelves/:id/invite', requireUser, async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_owner } = await role(req.user.id, shelfId)
    if (!is_owner) return res.status(403).json({ error: 'owner only' })

    const { expires_in_days = 30, max_redemptions = 20 } = req.body
    const { rows: existing } = await pool.query(
      `SELECT code FROM invites
        WHERE shelf_id=$1 AND (expires_at IS NULL OR expires_at > NOW())
          AND (max_redemptions IS NULL OR redemptions < max_redemptions)`,
      [shelfId]
    )
    if (existing[0]) return res.json({ code: existing[0].code })

    for (let i = 0; i < 20; i++) {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      const { rows } = await pool.query(
        `INSERT INTO invites (code, shelf_id, created_by, expires_at, max_redemptions)
         VALUES ($1,$2,$3, NOW() + ($4 || ' days')::interval, $5)
         ON CONFLICT DO NOTHING RETURNING code`,
        [code, shelfId, req.user.id, String(expires_in_days), max_redemptions]
      )
      if (rows[0]) return res.json({ code: rows[0].code })
    }
    res.status(500).json({ error: 'could not allocate a code' })
  })

  router.post('/join', async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip
    if (!rateLimit(`join:${ip}`, 10, 60_000)) {
      return res.status(429).json({ error: 'too many attempts, wait a minute' })
    }

    const code = String(req.body.code || '').trim()
    const username = req.body.username?.trim()
    if (!username && !req.user) return res.status(400).json({ error: 'username required' })

    const { rows: inv } = await pool.query(
      `SELECT * FROM invites
        WHERE code=$1 AND (expires_at IS NULL OR expires_at > NOW())
          AND (max_redemptions IS NULL OR redemptions < max_redemptions)`,
      [code]
    )
    if (!inv[0]) return res.status(404).json({ error: 'invalid or expired code' })

    let user = req.user
    if (!user) {
      const { rows } = await pool.query(
        'INSERT INTO users (username, token) VALUES ($1,$2) RETURNING *',
        [username.slice(0, 32), newToken()]
      )
      user = rows[0]
    }

    const { rowCount } = await pool.query(
      'INSERT INTO shelf_members (shelf_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [inv[0].shelf_id, user.id]
    )
    if (rowCount) {
      await pool.query('UPDATE invites SET redemptions = redemptions + 1 WHERE code=$1', [code])
    }

    const { rows: shelf } = await pool.query('SELECT id, name, icon, seq FROM shelves WHERE id=$1', [inv[0].shelf_id])
    res.json({ token: user.token, user: { id: user.id, username: user.username }, shelf: shelf[0] })
  })

  router.get('/my-shelves', requireUser, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.icon, s.seq, s.owner_user_id = $1 AS is_owner
         FROM shelf_members m JOIN shelves s ON s.id = m.shelf_id
        WHERE m.user_id=$1 ORDER BY s.id`,
      [req.user.id]
    )
    res.json(rows)
  })

  router.get('/shelves/:id', requireUser, async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_member } = await role(req.user.id, shelfId)
    if (!is_member) return res.status(403).json({ error: 'not a member' })
    const { rows: s } = await pool.query('SELECT id, name, icon, seq, owner_user_id, origin FROM shelves WHERE id=$1', [shelfId])
    const { rows: tabs } = await pool.query('SELECT id, name, sort_order FROM shelf_tabs WHERE shelf_id=$1 ORDER BY sort_order, id', [shelfId])
    res.json({ ...s[0], tabs })
  })

  router.get('/shelves/:id/members', requireUser, async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_member } = await role(req.user.id, shelfId)
    if (!is_member) return res.status(403).json({ error: 'not a member' })
    const { rows } = await pool.query(
      `SELECT u.id, u.username, (u.id = s.owner_user_id) AS is_owner
         FROM shelf_members m
         JOIN users u ON u.id = m.user_id
         JOIN shelves s ON s.id = m.shelf_id
        WHERE m.shelf_id=$1 ORDER BY is_owner DESC, m.joined_at`,
      [shelfId]
    )
    res.json(rows)
  })

  router.get('/shelves/:id/cards', requireUser, async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_member } = await role(req.user.id, shelfId)
    if (!is_member) return res.status(403).json({ error: 'not a member' })

    const since = Number(req.query.since || 0)
    const { rows } = await pool.query(
      `SELECT c.*, u.username AS author
         FROM cards c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.shelf_id=$1 AND c.seq > $2
        ORDER BY c.seq LIMIT 500`,
      [shelfId, since]
    )
    const { rows: s } = await pool.query('SELECT seq FROM shelves WHERE id=$1', [shelfId])
    res.json({ cards: rows, seq: rows.length ? rows[rows.length - 1].seq : since, shelf_seq: s[0].seq })
  })

  router.post('/cards', requireUser, async (req, res) => {
    try {
      const { shelf_id, tab_id = null } = req.body
      const { is_member } = await role(req.user.id, shelf_id)
      if (!is_member) return res.status(403).json({ error: 'not a member' })

      const card = await tx(async (client) => {
        const seq = await nextSeq(client, shelf_id)
        const { rows } = await client.query(
          `INSERT INTO cards (shelf_id, tab_id, user_id, type, url, title, description,
                              thumbnail_url, media_id, notes, metadata, category, seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [shelf_id, tab_id, req.user.id, req.body.type || 'link', req.body.url,
           req.body.title, req.body.description, req.body.thumbnail_url,
           req.body.media_id, req.body.notes, JSON.stringify(req.body.metadata || {}),
           req.body.category || null, seq]
        )
        return rows[0]
      })
      res.json({ ...card, author: req.user.username })
    } catch (err) {
      console.error('hosted-hub POST /cards', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  async function cardRole(req, cardId) {
    const { rows } = await pool.query(
      `SELECT c.*, s.owner_user_id FROM cards c JOIN shelves s ON s.id = c.shelf_id WHERE c.id=$1`,
      [cardId]
    )
    if (!rows[0]) return null
    const c = rows[0]
    const { is_member } = await role(req.user.id, c.shelf_id)
    return { card: c, is_member, allowed: c.user_id === req.user.id || c.owner_user_id === req.user.id }
  }

  router.patch('/cards/:id', requireUser, async (req, res) => {
    const found = await cardRole(req, Number(req.params.id))
    if (!found) return res.status(404).json({ error: 'not found' })
    if (!found.allowed && !found.is_member) return res.status(403).json({ error: 'not yours' })

    const { title, description, notes, category, thumbnail_url, metadata } = req.body
    const card = await tx(async (client) => {
      const seq = await nextSeq(client, found.card.shelf_id)
      const { rows } = await client.query(
        `UPDATE cards SET title=COALESCE($1,title), description=COALESCE($2,description),
                          notes=COALESCE($3,notes), category=COALESCE($4,category),
                          thumbnail_url=COALESCE($5,thumbnail_url),
                          metadata=COALESCE($6,metadata), seq=$7, updated_at=NOW()
          WHERE id=$8 RETURNING *`,
        [title, description, notes, category, thumbnail_url,
         metadata ? JSON.stringify(metadata) : null, seq, found.card.id]
      )
      return rows[0]
    })
    res.json(card)
  })

  router.delete('/cards/:id', requireUser, async (req, res) => {
    const found = await cardRole(req, Number(req.params.id))
    if (!found) return res.status(404).json({ error: 'not found' })
    if (!found.allowed) return res.status(403).json({ error: 'not yours' })

    await tx(async (client) => {
      const seq = await nextSeq(client, found.card.shelf_id)
      await client.query(
        'UPDATE cards SET deleted_at=NOW(), seq=$1, updated_at=NOW() WHERE id=$2',
        [seq, found.card.id]
      )
    })
    res.json({ ok: true })
  })

  router.get('/shelves/:id/guides', requireUser, async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_member } = await role(req.user.id, shelfId)
    if (!is_member) return res.status(403).json({ error: 'not a member' })

    const since = Number(req.query.since || 0)
    const { rows } = await pool.query(
      `SELECT * FROM guides WHERE shelf_id=$1 AND seq > $2 ORDER BY seq LIMIT 200`,
      [shelfId, since]
    )
    const { rows: s } = await pool.query('SELECT seq FROM shelves WHERE id=$1', [shelfId])
    res.json({ guides: rows, seq: rows.length ? rows[rows.length - 1].seq : since, shelf_seq: s[0].seq })
  })

  router.post('/guides', requireUser, async (req, res) => {
    try {
      const { shelf_id } = req.body
      const { is_member } = await role(req.user.id, shelf_id)
      if (!is_member) return res.status(403).json({ error: 'not a member' })

      const guide = await tx(async (client) => {
        const seq = await nextSeq(client, shelf_id)
        const { rows } = await client.query(
          `INSERT INTO guides (shelf_id, title, source, filename, chapters, tagline, category, html, seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [shelf_id, req.body.title, req.body.source, req.body.filename, req.body.chapters || 0,
           req.body.tagline, req.body.category, req.body.html, seq]
        )
        return rows[0]
      })
      res.json(guide)
    } catch (err) {
      console.error('hosted-hub POST /guides', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.delete('/guides/:id', requireUser, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM guides WHERE id=$1', [Number(req.params.id)])
    const g = rows[0]
    if (!g) return res.status(404).json({ error: 'not found' })
    const { is_member } = await role(req.user.id, g.shelf_id)
    if (!is_member) return res.status(403).json({ error: 'not a member' })

    await tx(async (client) => {
      const seq = await nextSeq(client, g.shelf_id)
      await client.query('UPDATE guides SET deleted_at=NOW(), seq=$1 WHERE id=$2', [seq, g.id])
    })
    res.json({ ok: true })
  })

  router.get('/shelves/:id/messages', requireUser, async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_member } = await role(req.user.id, shelfId)
    if (!is_member) return res.status(403).json({ error: 'not a member' })
    const since = Number(req.query.since || 0)
    const { rows } = await pool.query(
      `SELECT m.*, u.username,
         COALESCE((SELECT json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id))
                     FROM shelf_message_reactions r WHERE r.message_id = m.id), '[]') AS reactions,
         CASE WHEN m.reply_to_id IS NULL THEN NULL ELSE (
           SELECT json_build_object('id', rm.id, 'user_id', rm.user_id, 'username', ru.username, 'body', rm.body)
           FROM shelf_messages rm JOIN users ru ON ru.id = rm.user_id WHERE rm.id = m.reply_to_id
         ) END AS reply_to
         FROM shelf_messages m JOIN users u ON u.id = m.user_id
        WHERE m.shelf_id=$1 AND m.seq > $2 ORDER BY m.seq LIMIT 500`,
      [shelfId, since]
    )
    res.json({ messages: rows, seq: rows.length ? rows[rows.length - 1].seq : since })
  })

  router.post('/messages/:id/reactions', requireUser, async (req, res) => {
    const messageId = Number(req.params.id)
    const { emoji } = req.body || {}
    if (!emoji || typeof emoji !== 'string') return res.status(400).json({ error: 'emoji required' })
    const { rows: msgRows } = await pool.query('SELECT shelf_id FROM shelf_messages WHERE id=$1', [messageId])
    const msg = msgRows[0]
    if (!msg) return res.status(404).json({ error: 'not found' })
    const { is_member } = await role(req.user.id, msg.shelf_id)
    if (!is_member) return res.status(403).json({ error: 'not a member' })

    const { rows: existing } = await pool.query(
      'SELECT id FROM shelf_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
      [messageId, req.user.id, emoji]
    )
    if (existing.length) {
      await pool.query('DELETE FROM shelf_message_reactions WHERE id=$1', [existing[0].id])
    } else {
      await pool.query('INSERT INTO shelf_message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)', [messageId, req.user.id, emoji])
    }
    const { rows: reactions } = await pool.query(
      'SELECT emoji, user_id FROM shelf_message_reactions WHERE message_id=$1',
      [messageId]
    )
    io.to(`shelf:${msg.shelf_id}`).emit('reaction:update', { message_id: messageId, shelf_id: msg.shelf_id, reactions })
    res.json({ reactions })
  })

  router.post('/messages', requireUser, async (req, res) => {
    try {
      const { shelf_id, body, reply_to_id } = req.body
      const { is_member } = await role(req.user.id, shelf_id)
      if (!is_member) return res.status(403).json({ error: 'not a member' })
      if (!body?.trim()) return res.status(400).json({ error: 'empty message' })

      let replyTo = null
      if (reply_to_id) {
        const { rows } = await pool.query(
          `SELECT rm.id, rm.user_id, rm.body, ru.username FROM shelf_messages rm
           JOIN users ru ON ru.id = rm.user_id WHERE rm.id=$1 AND rm.shelf_id=$2`,
          [reply_to_id, shelf_id]
        )
        if (!rows[0]) return res.status(400).json({ error: 'reply_to_id not found on this shelf' })
        replyTo = rows[0]
      }

      const row = await tx(async (client) => {
        const seq = await nextSeq(client, shelf_id)
        const { rows } = await client.query(
          `INSERT INTO shelf_messages (shelf_id, user_id, body, seq, reply_to_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [shelf_id, req.user.id, body.trim(), seq, replyTo?.id || null]
        )
        return rows[0]
      })
      const out = { ...row, username: req.user.username, reply_to: replyTo }
      io.to(`shelf:${shelf_id}`).emit('message:new', out)
      res.json(out)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/shelves/:id/activity', requireUser, async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_member } = await role(req.user.id, shelfId)
    if (!is_member) return res.status(403).json({ error: 'not a member' })
    const since = Number(req.query.since || 0)
    const { rows } = await pool.query(
      `SELECT a.*, u.username FROM shelf_activity a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.shelf_id=$1 AND a.seq > $2 ORDER BY a.seq LIMIT 500`,
      [shelfId, since]
    )
    res.json({ activity: rows, seq: rows.length ? rows[rows.length - 1].seq : since })
  })

  router.post('/activity', requireUser, async (req, res) => {
    try {
      const { shelf_id, kind, summary } = req.body
      const { is_member } = await role(req.user.id, shelf_id)
      if (!is_member) return res.status(403).json({ error: 'not a member' })

      const row = await tx(async (client) => {
        const seq = await nextSeq(client, shelf_id)
        const { rows } = await client.query(
          `INSERT INTO shelf_activity (shelf_id, user_id, kind, summary, seq) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [shelf_id, req.user.id, kind, summary, seq]
        )
        return rows[0]
      })
      const out = { ...row, username: req.user.username }
      io.to(`shelf:${shelf_id}`).emit('activity:new', out)
      res.json(out)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  const ownerOnly = (handler) => async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_owner } = await role(req.user.id, shelfId)
    if (!is_owner) return res.status(403).json({ error: 'owner only' })
    return handler(req, res, shelfId)
  }

  router.patch('/shelves/:id', requireUser, ownerOnly(async (req, res, shelfId) => {
    const { name, icon, origin } = req.body
    const { rows } = await pool.query(
      'UPDATE shelves SET name=COALESCE($1,name), icon=COALESCE($2,icon), origin=COALESCE($3,origin) WHERE id=$4 RETURNING id, name, icon, origin',
      [name, icon, origin, shelfId]
    )
    res.json(rows[0])
  }))

  const TICKET_TTL_MIN = 5

  router.post('/shelves/:id/ticket', requireUser, async (req, res) => {
    const shelfId = Number(req.params.id)
    const { is_member } = await role(req.user.id, shelfId)
    if (!is_member) return res.status(403).json({ error: 'not a member' })

    const ticket = newToken()
    await pool.query('DELETE FROM access_tickets WHERE expires_at < NOW()')
    await pool.query(
      `INSERT INTO access_tickets (ticket, shelf_id, user_id, expires_at)
       VALUES ($1,$2,$3, NOW() + ($4 || ' minutes')::interval)`,
      [ticket, shelfId, req.user.id, String(TICKET_TTL_MIN)]
    )
    const { rows } = await pool.query('SELECT origin FROM shelves WHERE id=$1', [shelfId])
    res.json({ ticket, origin: rows[0]?.origin || null, expires_in: TICKET_TTL_MIN * 60 })
  })

  router.get('/tickets/:ticket', requireUser, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.shelf_id, t.user_id, u.username, s.owner_user_id
         FROM access_tickets t
         JOIN users u ON u.id = t.user_id
         JOIN shelves s ON s.id = t.shelf_id
        WHERE t.ticket=$1 AND t.expires_at > NOW()`,
      [req.params.ticket]
    )
    if (!rows[0]) return res.status(404).json({ error: 'no such ticket' })
    if (rows[0].owner_user_id !== req.user.id) return res.status(403).json({ error: 'not the owner' })
    res.json({ shelf_id: rows[0].shelf_id, user_id: rows[0].user_id, username: rows[0].username })
  })

  router.post('/shelves/:id/tabs', requireUser, ownerOnly(async (req, res, shelfId) => {
    const { rows } = await pool.query(
      'INSERT INTO shelf_tabs (shelf_id, name, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [shelfId, req.body.name, req.body.sort_order || 0]
    )
    res.json(rows[0])
  }))

  router.delete('/shelves/:id/members/:userId', requireUser, ownerOnly(async (req, res, shelfId) => {
    const target = Number(req.params.userId)
    const { rows: s } = await pool.query('SELECT owner_user_id FROM shelves WHERE id=$1', [shelfId])
    if (s[0].owner_user_id === target) return res.status(400).json({ error: 'transfer ownership first' })
    await pool.query('DELETE FROM shelf_members WHERE shelf_id=$1 AND user_id=$2', [shelfId, target])
    res.json({ ok: true })
  }))

  router.post('/shelves/:id/rotate', requireUser, ownerOnly(async (req, res, shelfId) => {
    await pool.query('DELETE FROM invites WHERE shelf_id=$1', [shelfId])
    res.json({ ok: true })
  }))

  router.post('/shelves/:id/transfer', requireUser, ownerOnly(async (req, res, shelfId) => {
    const target = Number(req.body.user_id)
    const { rows: m } = await pool.query(
      'SELECT 1 FROM shelf_members WHERE shelf_id=$1 AND user_id=$2', [shelfId, target]
    )
    if (!m[0]) return res.status(400).json({ error: 'new owner must be a member' })
    await pool.query('UPDATE shelves SET owner_user_id=$1 WHERE id=$2', [target, shelfId])
    res.json({ ok: true })
  }))

  router.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1')
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  app.use('/relay', router)

  // ── Realtime — same server, distinct path so it can't collide with any
  // socket.io this app mounts in the future ────────────────────────────────
  const io = new Server(httpServer, { path: '/relay/socket.io', cors: { origin: '*' } })

  io.use(async (socket, next) => {
    if (!(await hostedHubEnabled())) return next(new Error('hub not enabled'))
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('token required'))
    const { rows } = await pool.query('SELECT * FROM users WHERE token=$1', [token])
    if (!rows[0]) return next(new Error('invalid token'))
    socket.user = rows[0]
    next()
  })

  io.on('connection', (socket) => {
    socket.on('shelf:join', async (shelfId, ack) => {
      const { is_member } = await role(socket.user.id, Number(shelfId))
      if (!is_member) return ack?.({ error: 'not a member' })
      socket.join(`shelf:${shelfId}`)
      ack?.({ ok: true })
    })

    socket.on('shelf:leave', (shelfId) => socket.leave(`shelf:${shelfId}`))

    socket.on('message:send', async ({ shelf_id, body }, ack) => {
      try {
        const { is_member } = await role(socket.user.id, Number(shelf_id))
        if (!is_member) return ack?.({ error: 'not a member' })
        if (!body?.trim()) return ack?.({ error: 'empty message' })

        const row = await tx(async (client) => {
          const seq = await nextSeq(client, shelf_id)
          const { rows } = await client.query(
            `INSERT INTO shelf_messages (shelf_id, user_id, body, seq) VALUES ($1,$2,$3,$4) RETURNING *`,
            [shelf_id, socket.user.id, body.trim(), seq]
          )
          return rows[0]
        })
        const out = { ...row, username: socket.user.username }
        io.to(`shelf:${shelf_id}`).emit('message:new', out)
        ack?.({ ok: true, message: out })
      } catch (err) {
        ack?.({ error: err.message })
      }
    })
  })

  initDb().catch(err => console.error('hosted-hub schema init:', err.message))
}
