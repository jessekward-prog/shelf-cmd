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
  let hubUserId = null
  let username = null
  if (await hub.linkedShelf(categoryId)) {
    try {
      const remote = await hub.postActivity(categoryId, kind, summary)
      hubActivityId = remote.id
      hubUserId = remote.user_id
      username = remote.username
    } catch { /* queued, or offline — still log locally below */ }
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO shelf_activity (category_id, hub_activity_id, hub_user_id, kind, summary) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [categoryId, hubActivityId, hubUserId, kind, summary]
    )
    // Push to this box's own open chat panels right away — a linked shelf
    // will *also* get this event back through the hub socket, but the ON
    // CONFLICT upsert there makes that a no-op, and an unlinked (private)
    // shelf has no hub round trip at all, so this is the only delivery it gets.
    hub.events.emit('activity', { categoryId, row: { ...rows[0], username } })
  } catch (e) { console.error('activity log:', e.message) }
}

// Same scrubbing guide.js's writer uses — gemma leaks a <think> scratchpad.
function stripReasoning(text) {
  let t = text || ''
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const close = t.lastIndexOf('</think>')
  if (close !== -1) t = t.slice(close + 8)
  const open = t.indexOf('<think>')
  if (open !== -1) t = t.slice(0, open)
  t = t.replace(/<\/?think>/gi, '')
  t = t.replace(/<\/?s>|<\|?(?:end_of_turn|eot_id|eos|im_(?:start|end)|turn|assistant|user)\|?>/gi, '')
  return t.trim()
}

export function mountChat({ app, pool, adminOnly, adminOrToken, hub, lmComplete }) {
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
      `SELECT a.*, hu.username AS username
         FROM shelf_activity a
         LEFT JOIN hub_users hu ON hu.id = a.hub_user_id
        WHERE a.category_id=$1 ORDER BY a.created_at DESC LIMIT 200`,
      [req.params.id]
    )
    res.json(rows)
  })

  // MACHINE tab: answer a free-text question about the shelf's history using
  // the activity log (already carries who/what/when) plus what's currently on
  // the shelf. No vector DB — a shelf's whole history is at most a few hundred
  // rows, so it's cheaper and more accurate to just stuff it in the prompt.
  app.post('/api/categories/:id/ask', adminOnly, async (req, res) => {
    const categoryId = Number(req.params.id)
    const question = String(req.body.question || '').trim().slice(0, 500)
    if (!question) return res.status(400).json({ error: 'empty question' })

    const [activity, cards, files, guides] = await Promise.all([
      pool.query(
        `SELECT a.kind, a.summary, a.created_at, hu.username
           FROM shelf_activity a LEFT JOIN hub_users hu ON hu.id = a.hub_user_id
          WHERE a.category_id=$1 ORDER BY a.created_at DESC LIMIT 200`,
        [categoryId]
      ),
      pool.query('SELECT title, created_at FROM cards WHERE category_id=$1 ORDER BY created_at DESC LIMIT 100', [categoryId]),
      pool.query('SELECT name, created_at FROM files WHERE category_id=$1 ORDER BY created_at DESC LIMIT 100', [categoryId]),
      pool.query('SELECT title, created_at FROM guides WHERE category_id=$1 ORDER BY created_at DESC LIMIT 50', [categoryId])
    ])

    const fmt = (rows, pick) => rows.map(pick).join('\n') || '(none)'
    const context = [
      `Today's date: ${new Date().toISOString().slice(0, 10)}`,
      `\nActivity log (newest first):`,
      fmt(activity.rows, a => `${a.created_at.toISOString().slice(0, 10)} — ${a.username || 'someone'}: ${a.summary}`),
      `\nCards currently on the shelf:`,
      fmt(cards.rows, c => `${c.created_at.toISOString().slice(0, 10)} — ${c.title || '(untitled)'}`),
      `\nFiles currently on the shelf:`,
      fmt(files.rows, f => `${f.created_at.toISOString().slice(0, 10)} — ${f.name}`),
      `\nGuides currently on the shelf:`,
      fmt(guides.rows, g => `${g.created_at.toISOString().slice(0, 10)} — ${g.title}`)
    ].join('\n')

    try {
      const raw = await lmComplete([
        { role: 'system', content: 'You answer questions about the history and contents of a shared bookmark shelf, using only the data given below. Be concise — a sentence or two, or a short list. If the data doesn\'t answer the question, say so plainly instead of guessing.\n\n' + context },
        { role: 'user', content: question }
      ], { maxTokens: 500 })
      res.json({ answer: stripReasoning(raw) || "couldn't find an answer to that." })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
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
