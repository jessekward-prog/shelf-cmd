// Talking to shelf-hub, the always-online middle man that federated shelf-cmd
// instances share collab shelves through.
//
// Two rules shape everything here:
//   1. This instance authenticates to the hub as its own owner. There is no
//      separate instance credential — the box IS the person's server.
//   2. Every linked shelf is mirrored in full into the local database. The hub
//      is authoritative for ordering, but it holds no unique data, so a shelf
//      keeps rendering when the hub is down and can be rebuilt from any member.

import { io as ioClient } from 'socket.io-client'
import { EventEmitter } from 'events'

// Zero-config sharing is the actual point of the app — collaborators
// shouldn't need to know a hub exists, let alone configure one. So this stays
// a real default rather than requiring every instance to opt in by hand.
// What changed instead is on the hub's side: POST /shelves (the only
// unauthenticated route — it mints a fresh account) is now rate-limited, so
// a publicly-known default URL costs an abuser very little to hit but can't
// be turned into unlimited free accounts. See shelf-hub/server.js.
//
// Overridable live from the Shelf Hubs page (the `hub_url_override` setting,
// see getHubUrl below) — this env var is just the fallback when nothing's
// been picked in the UI.
const DEFAULT_HUB_URL = (process.env.HUB_URL || 'https://shelf-hub-production.up.railway.app').replace(/\/+$/, '')

// This instance's own address, published so members can reach its drive. Unset
// means the drive simply isn't offered — files are never mirrored, so there is
// no fallback route to them.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '')

export function makeHub(pool) {
  // ── Credentials ───────────────────────────────────────────────────────────

  async function getSetting(key) {
    const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key])
    return rows[0]?.value || null
  }

  async function setSetting(key, value) {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
      [key, value]
    )
  }

  async function getHubUrl() {
    const override = await getSetting('hub_url_override')
    return (override || DEFAULT_HUB_URL).replace(/\/+$/, '')
  }

  // Every credential this instance holds, keyed by which hub it's for — a
  // token minted on one hub's users table means nothing to another's.
  async function getIdentityFor(hubUrl) {
    const { rows } = await pool.query('SELECT * FROM hub_identities WHERE hub_url=$1', [hubUrl])
    if (rows[0]) return rows[0]
    // Lazy one-time migration: instances from before per-hub identity kept a
    // single flat one. Adopt it for the default hub so upgrading doesn't
    // strand an existing account — every OTHER hub still mints fresh, which
    // is correct, since a pre-upgrade instance only ever had one hub anyway.
    if (hubUrl === DEFAULT_HUB_URL) {
      const legacyToken = await getSetting('hub_token')
      if (legacyToken) {
        const legacyUserId = await getSetting('hub_user_id')
        const identity = {
          hub_url: hubUrl, token: legacyToken,
          user_id: legacyUserId ? Number(legacyUserId) : null,
          username: await getSetting('hub_username')
        }
        await pool.query(
          `INSERT INTO hub_identities (hub_url, token, user_id, username) VALUES ($1,$2,$3,$4)
           ON CONFLICT (hub_url) DO NOTHING`,
          [identity.hub_url, identity.token, identity.user_id, identity.username]
        )
        return identity
      }
    }
    return null
  }

  async function rememberIdentityFor(hubUrl, { token, user }) {
    if (!token) return
    await pool.query(
      `INSERT INTO hub_identities (hub_url, token, user_id, username) VALUES ($1,$2,$3,$4)
       ON CONFLICT (hub_url) DO UPDATE SET token=$2,
         user_id=COALESCE($3, hub_identities.user_id), username=COALESCE($4, hub_identities.username)`,
      [hubUrl, token, user?.id ?? null, user?.username ?? null]
    )
  }

  async function call(hubUrl, method, path, body, token) {
    const auth = token ?? (await getIdentityFor(hubUrl))?.token
    const res = await fetch(hubUrl + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(auth ? { Authorization: `Bearer ${auth}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    if (!res.ok) {
      const err = new Error(json?.error || `hub ${res.status}`)
      err.status = res.status
      throw err
    }
    return json
  }

  // The one place a shelf's own hub gets resolved — its pinned hub_url if it
  // has one, else whatever this instance's current default is. Every
  // per-shelf hub.js function goes through this instead of calling call()
  // directly, so a shelf never silently talks to the wrong hub after the
  // instance-wide default changes.
  async function callFor(categoryId, method, path, body, token) {
    const shelf = await linkedShelf(categoryId)
    const hubUrl = shelf?.hub_url || await getHubUrl()
    return call(hubUrl, method, path, body, token)
  }

  // ── Publishing a local category ───────────────────────────────────────────
  // Backfills tabs and existing cards, so sharing a shelf that already has
  // content behaves the way anyone would expect.

  async function publish(categoryId, username) {
    const { rows: cat } = await pool.query('SELECT * FROM categories WHERE id=$1', [categoryId])
    if (!cat[0]) throw new Error('no such category')

    const { rows: tabs } = await pool.query(
      'SELECT id, name, sort_order FROM subcategories WHERE category_id=$1 ORDER BY sort_order, id',
      [categoryId]
    )
    const { rows: cards } = await pool.query(
      "SELECT * FROM cards WHERE category_id=$1 AND status='ready' ORDER BY created_at",
      [categoryId]
    )

    // Resolved once, up front — this is the hub the shelf gets pinned to for
    // the rest of its life (see callFor), regardless of what the instance-wide
    // default becomes later.
    const hubUrl = await getHubUrl()
    const existing = await getIdentityFor(hubUrl)
    const payload = {
      name: cat[0].name,
      icon: cat[0].icon,
      tabs: tabs.map(t => ({ local_id: String(t.id), name: t.name, sort_order: t.sort_order })),
      cards: cards.map(c => ({
        tab_local_id: c.subcategory_id ? String(c.subcategory_id) : null,
        type: c.type, url: c.url, title: c.title, description: c.description,
        thumbnail_url: c.thumbnail_url, media_id: c.youtube_id, notes: c.notes,
        metadata: c.metadata || {}, category: c.category
      }))
    }
    if (!existing) payload.username = username?.trim() || 'shelf owner'

    const out = await call(hubUrl, 'POST', '/shelves', payload)
    await rememberIdentityFor(hubUrl, out)

    await pool.query('UPDATE categories SET is_collab=TRUE WHERE id=$1', [categoryId])
    // hub_url is deliberately absent from DO UPDATE SET — a re-run (the ON
    // CONFLICT path) must never re-pin an already-published shelf to whatever
    // the default happens to be today.
    await pool.query(
      `INSERT INTO linked_shelves (category_id, hub_shelf_id, hub_url, last_seq, is_owner, synced_at)
       VALUES ($1,$2,$3,$4,TRUE,NOW())
       ON CONFLICT (category_id) DO UPDATE SET hub_shelf_id=$2, last_seq=$4, is_owner=TRUE, synced_at=NOW()`,
      [categoryId, out.shelf.id, hubUrl, out.shelf.seq]
    )
    for (const [localId, hubTabId] of Object.entries(out.shelf.tab_map || {})) {
      await pool.query('UPDATE subcategories SET hub_tab_id=$1 WHERE id=$2', [hubTabId, Number(localId)])
    }
    // The hub assigned ids to the backfilled cards; adopt them so the puller
    // recognises our own rows instead of duplicating them on the next tick.
    await adoptBackfilled(categoryId, out.shelf.id, hubUrl)
    return out.shelf
  }

  async function adoptBackfilled(categoryId, hubShelfId, hubUrl) {
    const { cards } = await call(hubUrl, 'GET', `/shelves/${hubShelfId}/cards?since=0`)
    const { rows: local } = await pool.query(
      'SELECT id, url, title FROM cards WHERE category_id=$1 AND hub_card_id IS NULL',
      [categoryId]
    )
    for (const hc of cards) {
      const match = local.find(l => l.url === hc.url && l.title === hc.title)
      if (match) {
        await pool.query('UPDATE cards SET hub_card_id=$1 WHERE id=$2', [hc.id, match.id])
        local.splice(local.indexOf(match), 1)
      }
    }
  }

  // ── Linking someone else's shelf into this instance ───────────────────────

  async function link(code, username) {
    const hubUrl = await getHubUrl()
    const existing = await getIdentityFor(hubUrl)
    const out = await call(hubUrl, 'POST', '/join', {
      code,
      ...(existing ? {} : { username: username?.trim() || 'shelf owner' })
    })
    await rememberIdentityFor(hubUrl, out)

    // hub_shelf_id alone isn't globally unique — it's only unique within one
    // hub — so the dedup check has to confirm the hub matches too. NULL on an
    // old row means "was on the default when created," which is exactly what
    // $2 already is here, so COALESCE treats that as a match too.
    const { rows: already } = await pool.query(
      'SELECT category_id FROM linked_shelves WHERE hub_shelf_id=$1 AND COALESCE(hub_url, $2) = $2',
      [out.shelf.id, hubUrl]
    )
    if (already[0]) return { category_id: already[0].category_id, already_linked: true }

    const { rows: cat } = await pool.query(
      'INSERT INTO categories (name, icon, is_collab) VALUES ($1,$2,TRUE) RETURNING *',
      [out.shelf.name, out.shelf.icon || '📁']
    )
    await pool.query(
      'INSERT INTO linked_shelves (category_id, hub_shelf_id, hub_url, last_seq, is_owner) VALUES ($1,$2,$3,0,FALSE)',
      [cat[0].id, out.shelf.id, hubUrl]
    )
    await syncOne(cat[0].id)
    return { category_id: cat[0].id, already_linked: false }
  }

  // ── Pulling the changefeed ────────────────────────────────────────────────

  async function syncOne(categoryId) {
    const { rows: ls } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!ls[0]) return
    const shelf = ls[0]
    const hubUrl = shelf.hub_url || await getHubUrl()

    try {
      // Tabs and the shelf name are owner-controlled and live on the hub
      const meta = await call(hubUrl, 'GET', `/shelves/${shelf.hub_shelf_id}`)
      await pool.query('UPDATE categories SET name=$1, icon=COALESCE($2, icon) WHERE id=$3',
        [meta.name, meta.icon, categoryId])

      // The owner advertises where its drive can be reached; everyone else
      // records it, because that's the only way to the files.
      if (shelf.is_owner) {
        if (PUBLIC_URL && meta.origin !== PUBLIC_URL) {
          await call(hubUrl, 'PATCH', `/shelves/${shelf.hub_shelf_id}`, { origin: PUBLIC_URL })
        }
      } else if (meta.origin !== shelf.origin) {
        await pool.query('UPDATE linked_shelves SET origin=$1 WHERE category_id=$2',
          [meta.origin || null, categoryId])
      }
      for (const t of meta.tabs) {
        await pool.query(
          `INSERT INTO subcategories (category_id, name, sort_order, hub_tab_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (hub_tab_id) WHERE hub_tab_id IS NOT NULL
           DO UPDATE SET name=$2, sort_order=$3`,
          [categoryId, t.name, t.sort_order, t.id]
        )
      }

      // Refresh who's on this shelf so bylines resolve to current names. Doing
      // this every sync is what keeps a rename from leaving stale names behind
      // on cards that were mirrored before it happened.
      try {
        const people = await call(hubUrl, 'GET', `/shelves/${shelf.hub_shelf_id}/members`)
        for (const p of people) {
          await pool.query(
            'INSERT INTO hub_users (id, username) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET username=$2',
            [p.id, p.username]
          )
        }
      } catch { /* names go stale for a tick; cards still sync */ }

      const { cards, seq } = await call(hubUrl, 'GET', `/shelves/${shelf.hub_shelf_id}/cards?since=${shelf.last_seq}`)
      for (const c of cards) {
        if (c.deleted_at) {
          // Tombstone: the only way a mirror ever learns about a deletion
          await pool.query('DELETE FROM cards WHERE hub_card_id=$1', [c.id])
          continue
        }
        const { rows: tab } = await pool.query(
          'SELECT id FROM subcategories WHERE hub_tab_id=$1', [c.tab_id]
        )
        await pool.query(
          `INSERT INTO cards (category_id, subcategory_id, hub_card_id, hub_user_id, type, url, title,
                              description, thumbnail_url, youtube_id, notes, metadata, category, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ready')
           ON CONFLICT (hub_card_id) WHERE hub_card_id IS NOT NULL
           DO UPDATE SET subcategory_id=$2, hub_user_id=$4, title=$7, description=$8,
                         thumbnail_url=$9, notes=$11, metadata=$12,
                         category=COALESCE($13, cards.category)`,
          [categoryId, tab[0]?.id || null, c.id, c.user_id, c.type, c.url, c.title, c.description,
           c.thumbnail_url, c.media_id, c.notes, JSON.stringify(c.metadata || {}), c.category || null]
        )
      }

      // Guides share the shelf's card changefeed cursor — the two tables
      // advance the same underlying seq counter, so nothing needs a second
      // column, just folding both maxes into the one cursor below.
      const { guides, seq: guideSeq } = await call(hubUrl, 'GET', `/shelves/${shelf.hub_shelf_id}/guides?since=${shelf.last_seq}`)
      for (const g of guides) {
        if (g.deleted_at) {
          await pool.query('DELETE FROM guides WHERE hub_guide_id=$1', [g.id])
          continue
        }
        await pool.query(
          `INSERT INTO guides (category_id, hub_guide_id, title, source, filename, chapters, tagline, category, html)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (hub_guide_id) WHERE hub_guide_id IS NOT NULL
           DO UPDATE SET title=$3, tagline=$7, category=$8`,
          [categoryId, g.id, g.title, g.source, g.filename, g.chapters, g.tagline, g.category, g.html]
        )
      }

      // Live delivery is the socket above; this pull just backstops anything
      // missed while offline or before a chat panel was ever opened — it has
      // to emit the same way the socket does, or a chat panel that's open
      // right now never learns the backstop found something.
      const { messages, seq: msgSeq } = await call(hubUrl, 'GET', `/shelves/${shelf.hub_shelf_id}/messages?since=${shelf.last_seq}`)
      // Rows arrive ordered by seq, so a reply's target — if it's part of this
      // same batch — has already been inserted by the time we reach it.
      for (const m of messages) {
        const replyToId = m.reply_to_id ? await resolveLocalReplyId(m.reply_to_id) : null
        const { rows } = await pool.query(
          `INSERT INTO shelf_messages (category_id, hub_message_id, hub_user_id, body, created_at, reply_to_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (hub_message_id) WHERE hub_message_id IS NOT NULL DO NOTHING
           RETURNING *`,
          [categoryId, m.id, m.user_id, m.body, m.created_at, replyToId]
        )
        if (rows[0]) {
          await mirrorReactions(rows[0].id, m.reactions)
          const reactions = (m.reactions || []).map(r => ({ emoji: r.emoji, hub_user_id: r.user_id }))
          const reply_to = await resolveReplyPreview(replyToId)
          events.emit('message', { categoryId, row: { ...rows[0], username: m.username, reactions, reply_to } })
        }
      }

      const { activity, seq: actSeq } = await call(hubUrl, 'GET', `/shelves/${shelf.hub_shelf_id}/activity?since=${shelf.last_seq}`)
      for (const a of activity) {
        const { rows } = await pool.query(
          `INSERT INTO shelf_activity (category_id, hub_activity_id, hub_user_id, kind, summary, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (hub_activity_id) WHERE hub_activity_id IS NOT NULL DO NOTHING
           RETURNING *`,
          [categoryId, a.id, a.user_id, a.kind, a.summary, a.created_at]
        )
        if (rows[0]) events.emit('activity', { categoryId, row: { ...rows[0], username: a.username } })
      }

      await pool.query(
        'UPDATE linked_shelves SET last_seq=$1, synced_at=NOW(), sync_error=NULL WHERE category_id=$2',
        [Math.max(Number(seq), Number(guideSeq), Number(msgSeq), Number(actSeq), Number(shelf.last_seq)), categoryId]
      )
    } catch (err) {
      // A shelf that can't reach the hub keeps showing its mirror; it just goes stale.
      await pool.query('UPDATE linked_shelves SET sync_error=$1 WHERE category_id=$2',
        [err.message, categoryId])
      throw err
    }
  }

  async function syncAll() {
    const { rows } = await pool.query('SELECT category_id FROM linked_shelves')
    for (const r of rows) {
      await syncOne(r.category_id).catch(() => {})
    }
  }

  // ── Writing through to the hub ────────────────────────────────────────────
  // Queued locally if the hub is unreachable, so a dropped connection delays
  // the post rather than losing it.

  async function queue(categoryId, op, payload) {
    await pool.query('INSERT INTO outbox (category_id, op, payload) VALUES ($1,$2,$3)',
      [categoryId, op, JSON.stringify(payload)])
  }

  async function postCard(categoryId, card) {
    const { rows: ls } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!ls[0]) throw new Error('not a linked shelf')
    const hubUrl = ls[0].hub_url || await getHubUrl()

    const { rows: tab } = card.subcategory_id
      ? await pool.query('SELECT hub_tab_id FROM subcategories WHERE id=$1', [card.subcategory_id])
      : { rows: [] }

    const payload = {
      shelf_id: ls[0].hub_shelf_id,
      tab_id: tab[0]?.hub_tab_id || null,
      type: card.type || 'link',
      url: card.url,
      title: card.title,
      description: card.description,
      thumbnail_url: card.thumbnail_url,
      media_id: card.youtube_id || null,
      notes: card.notes || null,
      metadata: card.metadata || {},
      category: card.category || null
    }

    try {
      return await call(hubUrl, 'POST', '/cards', payload)
    } catch (err) {
      await queue(categoryId, 'create', payload)
      err.queued = true
      throw err
    }
  }

  async function deleteCard(card) {
    if (!card.hub_card_id) return
    try {
      await callFor(card.category_id, 'DELETE', `/cards/${card.hub_card_id}`)
    } catch (err) {
      await queue(card.category_id, 'delete', { hub_card_id: card.hub_card_id })
    }
  }

  async function postTab(categoryId, tab) {
    const { rows: ls } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!ls[0]) throw new Error('not a linked shelf')
    // Tabs are owner-controlled on the hub (see syncOne) — a member's local tab
    // has nowhere to go and would just 403 forever.
    if (!ls[0].is_owner) return null
    const hubUrl = ls[0].hub_url || await getHubUrl()

    const payload = { shelf_id: ls[0].hub_shelf_id, name: tab.name, sort_order: tab.sort_order || 0 }
    try {
      return await call(hubUrl, 'POST', `/shelves/${ls[0].hub_shelf_id}/tabs`, payload)
    } catch (err) {
      await queue(categoryId, 'tab_create', payload)
      err.queued = true
      throw err
    }
  }

  async function postGuide(categoryId, guide) {
    const { rows: ls } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!ls[0]) throw new Error('not a linked shelf')
    const hubUrl = ls[0].hub_url || await getHubUrl()

    const payload = {
      shelf_id: ls[0].hub_shelf_id,
      title: guide.title, source: guide.source, filename: guide.filename,
      chapters: guide.chapters, tagline: guide.tagline, category: guide.category, html: guide.html
    }
    try {
      return await call(hubUrl, 'POST', '/guides', payload)
    } catch (err) {
      await queue(categoryId, 'guide_create', payload)
      err.queued = true
      throw err
    }
  }

  async function deleteGuideRemote(guide) {
    if (!guide.hub_guide_id) return
    try {
      await callFor(guide.category_id, 'DELETE', `/guides/${guide.hub_guide_id}`)
    } catch (err) {
      await queue(guide.category_id, 'guide_delete', { hub_guide_id: guide.hub_guide_id })
    }
  }

  // ── Realtime: shelf chat + activity ────────────────────────────────────────
  // One persistent Socket.IO connection to the hub, authenticated the same way
  // as every REST call — this instance's own token. Rooms are joined lazily
  // (only shelves someone's actually got a chat panel open for), and every
  // live event is also upserted into the local mirror so chat.js's own
  // subscribers (see `events`) and a plain page reload see the same thing.
  const events = new EventEmitter()
  let socket = null

  // hub_shelf_id is only unique within one hub, so an incoming socket event
  // (always from the one hub this socket is connected to) has to be matched
  // against a shelf actually pinned there — otherwise an id collision with a
  // shelf on a different hub could misattribute the event.
  async function categoryIdFor(hubShelfId, hubUrl) {
    const { rows } = await pool.query(
      'SELECT category_id FROM linked_shelves WHERE hub_shelf_id=$1 AND COALESCE(hub_url, $2) = $2',
      [hubShelfId, hubUrl]
    )
    return rows[0]?.category_id || null
  }

  // A reply's reply_to_id from the hub is a HUB message id; the local mirror
  // needs the LOCAL row it maps to. Null if that original was never synced
  // here (deleted, or a very unlucky race) — the reply just loses its quote.
  async function resolveLocalReplyId(hubMessageId) {
    const { rows } = await pool.query('SELECT id FROM shelf_messages WHERE hub_message_id=$1', [hubMessageId])
    return rows[0]?.id || null
  }

  // The quoted preview a reply's bubble renders — same shape chat.js's own
  // GET /messages subquery builds, needed here too since a message can reach
  // the frontend via the live socket or the catch-up pull instead of a POST
  // response, and neither of those has the joined preview otherwise.
  async function resolveReplyPreview(localReplyToId) {
    if (!localReplyToId) return null
    const { rows } = await pool.query(
      `SELECT rm.id, rm.hub_user_id, rm.body, hu.username
         FROM shelf_messages rm LEFT JOIN hub_users hu ON hu.id = rm.hub_user_id
        WHERE rm.id=$1`,
      [localReplyToId]
    )
    return rows[0] || null
  }

  // Full-replace rather than diff — the hub always hands over the complete
  // current set for a message, and a toggle can just as easily be a removal.
  async function mirrorReactions(messageId, reactions) {
    if (!reactions) return
    await pool.query('DELETE FROM shelf_message_reactions WHERE message_id=$1', [messageId])
    for (const r of reactions) {
      await pool.query(
        'INSERT INTO shelf_message_reactions (message_id, hub_user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [messageId, r.user_id, r.emoji]
      )
    }
  }

  async function ensureSocket() {
    if (socket) return socket
    const hubUrl = await getHubUrl()
    socket = ioClient(hubUrl, { auth: (cb) => getIdentityFor(hubUrl).then(id => cb({ token: id?.token })) })

    socket.on('message:new', async (m) => {
      const categoryId = await categoryIdFor(m.shelf_id, hubUrl)
      if (!categoryId) return
      const replyToId = m.reply_to_id ? await resolveLocalReplyId(m.reply_to_id) : null
      const { rows } = await pool.query(
        `INSERT INTO shelf_messages (category_id, hub_message_id, hub_user_id, body, created_at, reply_to_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (hub_message_id) WHERE hub_message_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [categoryId, m.id, m.user_id, m.body, m.created_at, replyToId]
      )
      if (rows[0]) {
        const reply_to = await resolveReplyPreview(replyToId)
        events.emit('message', { categoryId, row: { ...rows[0], username: m.username, reply_to } })
      }
    })

    socket.on('activity:new', async (a) => {
      const categoryId = await categoryIdFor(a.shelf_id, hubUrl)
      if (!categoryId) return
      const { rows } = await pool.query(
        `INSERT INTO shelf_activity (category_id, hub_activity_id, hub_user_id, kind, summary, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (hub_activity_id) WHERE hub_activity_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [categoryId, a.id, a.user_id, a.kind, a.summary, a.created_at]
      )
      events.emit('activity', { categoryId, row: rows[0] ? { ...rows[0], username: a.username } : { ...a, username: a.username } })
    })

    socket.on('reaction:update', async ({ message_id, reactions }) => {
      const { rows } = await pool.query('SELECT id, category_id FROM shelf_messages WHERE hub_message_id=$1', [message_id])
      const row = rows[0]
      if (!row) return
      await mirrorReactions(row.id, reactions)
      // Same field name (hub_user_id) as chat.js's own-toggle response, so the
      // frontend never has to know which path a reaction update came from.
      const out = reactions.map(r => ({ emoji: r.emoji, hub_user_id: r.user_id }))
      events.emit('reaction', { categoryId: row.category_id, messageId: row.id, reactions: out })
    })

    return socket
  }

  // Live push only exists for shelves on the instance-wide default hub — the
  // one socket connects to exactly one server. A shelf pinned elsewhere still
  // syncs fully, just via syncOne's 30s poll instead of instantly; deliberate
  // scope cut, not a bug (a multi-socket, one-per-hub setup is the fast-follow
  // if this needs to be instant everywhere).
  async function joinShelfRoom(categoryId) {
    const shelf = await linkedShelf(categoryId)
    if (!shelf) return
    const defaultUrl = await getHubUrl()
    if ((shelf.hub_url || defaultUrl) !== defaultUrl) return
    ;(await ensureSocket()).emit('shelf:join', shelf.hub_shelf_id)
  }

  // Called after the sharing hub setting changes — the cached socket (if any)
  // was talking to the OLD hub, so it has to go. The next joinShelfRoom() call
  // reconnects fresh against whatever getHubUrl() resolves to now.
  function reconnect() {
    if (socket) {
      socket.disconnect()
      socket = null
    }
  }

  // replyToHubMessageId is the HUB id of the message being replied to — the
  // caller (chat.js) resolves the local reply_to_id it was given to that
  // before calling in, since only the hub side can validate/store it.
  async function postMessage(categoryId, body, replyToHubMessageId) {
    const shelf = await linkedShelf(categoryId)
    if (!shelf) throw new Error('not a linked shelf')
    const hubUrl = shelf.hub_url || await getHubUrl()
    const payload = { shelf_id: shelf.hub_shelf_id, body, reply_to_id: replyToHubMessageId || undefined }
    try {
      return await call(hubUrl, 'POST', '/messages', payload)
    } catch (err) {
      await queue(categoryId, 'message_create', payload)
      err.queued = true
      throw err
    }
  }

  // No outbox queuing here, unlike postMessage/postActivity — a reaction that
  // fails to land while the hub's briefly unreachable just doesn't toggle;
  // the person sees that immediately and can tap it again, no durability needed.
  async function postReaction(categoryId, hubMessageId, emoji) {
    const shelf = await linkedShelf(categoryId)
    if (!shelf) throw new Error('not a linked shelf')
    return callFor(categoryId, 'POST', `/messages/${hubMessageId}/reactions`, { emoji })
  }

  async function postActivity(categoryId, kind, summary) {
    const shelf = await linkedShelf(categoryId)
    if (!shelf) throw new Error('not a linked shelf')
    const hubUrl = shelf.hub_url || await getHubUrl()
    try {
      return await call(hubUrl, 'POST', '/activity', { shelf_id: shelf.hub_shelf_id, kind, summary })
    } catch (err) {
      await queue(categoryId, 'activity_create', { shelf_id: shelf.hub_shelf_id, kind, summary })
      err.queued = true
      throw err
    }
  }

  async function updateCard(card, patch) {
    if (!card.hub_card_id) return
    try {
      await callFor(card.category_id, 'PATCH', `/cards/${card.hub_card_id}`, patch)
    } catch (err) {
      await queue(card.category_id, 'update', { hub_card_id: card.hub_card_id, ...patch })
    }
  }

  async function flushOutbox() {
    const { rows } = await pool.query('SELECT * FROM outbox ORDER BY id LIMIT 50')
    for (const item of rows) {
      try {
        if (item.op === 'create') await callFor(item.category_id, 'POST', '/cards', item.payload)
        if (item.op === 'delete') await callFor(item.category_id, 'DELETE', `/cards/${item.payload.hub_card_id}`)
        if (item.op === 'update') {
          const { hub_card_id, ...patch } = item.payload
          await callFor(item.category_id, 'PATCH', `/cards/${hub_card_id}`, patch)
        }
        if (item.op === 'tab_create') await callFor(item.category_id, 'POST', `/shelves/${item.payload.shelf_id}/tabs`, item.payload)
        if (item.op === 'guide_create') await callFor(item.category_id, 'POST', '/guides', item.payload)
        if (item.op === 'guide_delete') await callFor(item.category_id, 'DELETE', `/guides/${item.payload.hub_guide_id}`)
        if (item.op === 'message_create') await callFor(item.category_id, 'POST', '/messages', item.payload)
        if (item.op === 'activity_create') await callFor(item.category_id, 'POST', '/activity', item.payload)
        await pool.query('DELETE FROM outbox WHERE id=$1', [item.id])
      } catch (err) {
        await pool.query('UPDATE outbox SET attempts=attempts+1, last_error=$1 WHERE id=$2',
          [err.message, item.id])
        // A 4xx will never succeed on retry; drop it rather than blocking the queue forever.
        if (err.status >= 400 && err.status < 500 && item.attempts >= 2) {
          await pool.query('DELETE FROM outbox WHERE id=$1', [item.id])
        }
        break
      }
    }
  }

  async function invite(categoryId, opts = {}) {
    const { rows: ls } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!ls[0]) throw new Error('shelf is not published')
    const hubUrl = ls[0].hub_url || await getHubUrl()
    return call(hubUrl, 'POST', `/shelves/${ls[0].hub_shelf_id}/invite`, opts)
  }

  async function members(categoryId) {
    const { rows: ls } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!ls[0]) return []
    const hubUrl = ls[0].hub_url || await getHubUrl()
    return call(hubUrl, 'GET', `/shelves/${ls[0].hub_shelf_id}/members`)
  }

  // Renaming has to reach every hub this instance holds an identity on, or
  // other instances keep showing the old name on everything posted there —
  // unlike a token, a username genuinely should stay the same person
  // everywhere, so this is the one identity field that fans out.
  async function setUsername(username) {
    const { rows } = await pool.query('SELECT hub_url FROM hub_identities')
    for (const { hub_url } of rows) {
      try {
        await call(hub_url, 'PUT', '/me', { username })
        await pool.query('UPDATE hub_identities SET username=$1 WHERE hub_url=$2', [username, hub_url])
      } catch { /* that hub's unreachable right now; its name goes stale for a tick */ }
    }
    await setSetting('hub_username', username)
  }

  // ── Drive access ──────────────────────────────────────────────────────────
  // A member trades its hub token for a short-lived, single-shelf ticket. The
  // owner's server redeems the ticket to learn who is asking, so the two
  // instances never hand each other a credential that outlives one request.

  async function ticketFor(categoryId) {
    const { rows } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!rows[0]) throw new Error('not a linked shelf')
    const hubUrl = rows[0].hub_url || await getHubUrl()
    const out = await call(hubUrl, 'POST', `/shelves/${rows[0].hub_shelf_id}/ticket`)
    // The hub knows the current origin even if our last sync predates it.
    const origin = out.origin || rows[0].origin
    if (!origin) throw new Error("that shelf's owner hasn't published a drive address")
    return { ...out, origin, hubShelfId: rows[0].hub_shelf_id }
  }

  // The caller (drive.js's ticketGate) already knows which hub a ticket came
  // from — it looked up the shelf locally by hub_shelf_id before redeeming —
  // so unlike everything else here it passes hubUrl in explicitly rather than
  // this resolving it, since there's no local categoryId to resolve it from.
  const redeemTicket = (hubUrl, ticket) => call(hubUrl, 'GET', `/tickets/${encodeURIComponent(ticket)}`)

  async function linkedShelf(categoryId) {
    const { rows } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    return rows[0] || null
  }

  function startLoop(intervalMs = 30000) {
    const tick = async () => {
      await flushOutbox().catch(() => {})
      await syncAll().catch(() => {})
    }
    tick()
    const t = setInterval(tick, intervalMs)
    t.unref?.()
    return t
  }

  return {
    getHubUrl, reconnect,
    publish, link, syncOne, postCard, deleteCard, updateCard,
    postTab, postGuide, deleteGuideRemote,
    postMessage, postActivity, postReaction, joinShelfRoom, events,
    invite, members, linkedShelf, setUsername, startLoop,
    ticketFor, redeemTicket,
    // hubUrl defaults to the instance-wide default — pass a specific shelf's
    // hub_url when the caller is comparing against a hub_user_id scoped to
    // that shelf (a person's id is only meaningful within one hub).
    identity: async (hubUrl) => {
      const id = await getIdentityFor(hubUrl || await getHubUrl())
      return {
        token: id?.token || null,
        user_id: id?.user_id != null ? String(id.user_id) : null,
        username: id?.username || null
      }
    }
  }
}
