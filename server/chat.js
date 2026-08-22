// The floating per-shelf chat/activity panel's server side. "Man" mode is
// member-to-member messages; "machine" mode is an auto-generated activity log
// (see logActivity, called from index.js/drive.js/guide.js wherever something
// on a shelf changes). Both mirror through the hub the same way guides do —
// see hub.js — this module is just the local REST surface plus the SSE bridge
// that turns the hub's live socket events into something the browser can
// subscribe to without needing to know sockets exist at all.

// Called from wherever a card/file/guide gets created or deleted. Local-first:
// the activity always gets logged here even for a private, unshared shelf (it
// still doubles as a personal "what changed" log), and only pushed to the hub
// when the shelf is actually collaborative.
export async function logActivity(pool, hub, categoryId, kind, summary) {
  let hubActivityId = null
  if (await hub.linkedShelf(categoryId)) {
    try {
      const remote = await hub.postActivity(categoryId, kind, summary)
      hubActivityId = remote.id
    } catch { /* queued, or offline — still log locally below */ }
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO shelf_activity (category_id, hub_activity_id, kind, summary) VALUES ($1,$2,$3,$4) RETURNING *',
      [categoryId, hubActivityId, kind, summary]
    )
    // Push to this box's own open chat panels right away — a linked shelf
    // will *also* get this event back through the hub socket, but the ON
    // CONFLICT upsert there makes that a no-op, and an unlinked (private)
    // shelf has no hub round trip at all, so this is the only delivery it gets.
    hub.events.emit('activity', { categoryId, row: rows[0] })
  } catch (e) { console.error('activity log:', e.message) }
}

export function mountChat({ app, pool, adminOnly, adminOrToken, hub }) {
  app.get('/api/categories/:id/messages', adminOnly, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT m.*, hu.username AS username
         FROM shelf_messages m
         LEFT JOIN hub_users hu ON hu.id = m.hub_user_id
        WHERE m.category_id=$1 ORDER BY m.created_at`,
      [req.params.id]
    )
    res.json(rows)
  })

  app.post('/api/categories/:id/messages', adminOnly, async (req, res) => {
    const categoryId = Number(req.params.id)
    const body = String(req.body.body || '').trim().slice(0, 2000)
    if (!body) return res.status(400).json({ error: 'empty message' })
    if (!await hub.linkedShelf(categoryId)) {
      return res.status(400).json({ error: 'share this shelf first — chat only works between members' })
    }
    try {
      const remote = await hub.postMessage(categoryId, body)
      const { rows } = await pool.query(
        `INSERT INTO shelf_messages (category_id, hub_message_id, hub_user_id, body, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (hub_message_id) WHERE hub_message_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [categoryId, remote.id, remote.user_id, remote.body, remote.created_at]
      )
      const out = { ...(rows[0] || remote), username: remote.username }
      // Don't wait on the hub socket relay to hear our own message back.
      hub.events.emit('message', { categoryId, row: out })
      res.json(out)
    } catch (err) {
      // Queued for the outbox — still tell the browser it landed, just not live yet.
      res.status(err.queued ? 202 : 500).json({ error: err.message, queued: !!err.queued })
    }
  })

  app.get('/api/categories/:id/activity', adminOnly, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM shelf_activity WHERE category_id=$1 ORDER BY created_at DESC LIMIT 200',
      [req.params.id]
    )
    res.json(rows)
  })

  // Server-Sent Events: the browser holds this connection open while the chat
  // panel is on screen. Turns hub.js's socket relay into something a plain
  // EventSource can consume, so the frontend never has to know sockets exist.
  // EventSource can't set an Authorization header, so this one route (like
  // downloads) takes the token as ?t= instead.
  app.get('/api/categories/:id/chat/stream', adminOrToken, async (req, res) => {
    const categoryId = Number(req.params.id)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write(': connected\n\n')

    hub.joinShelfRoom(categoryId).catch(() => {})

    const onMessage = ({ categoryId: cid, row }) => {
      if (cid === categoryId) res.write(`event: message\ndata: ${JSON.stringify(row)}\n\n`)
    }
    const onActivity = ({ categoryId: cid, row }) => {
      if (cid === categoryId) res.write(`event: activity\ndata: ${JSON.stringify(row)}\n\n`)
    }
    hub.events.on('message', onMessage)
    hub.events.on('activity', onActivity)

    // Proxies/browsers will silently drop an idle connection; a comment frame
    // every 20s is enough to keep it open without meaning anything to the client.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000)

    req.on('close', () => {
      clearInterval(heartbeat)
      hub.events.off('message', onMessage)
      hub.events.off('activity', onActivity)
    })
  })
}
