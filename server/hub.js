// Talking to shelf-hub, the always-online middle man that federated shelf-cmd
// instances share collab shelves through.
//
// Two rules shape everything here:
//   1. This instance authenticates to the hub as its own owner. There is no
//      separate instance credential — the box IS the person's server.
//   2. Every linked shelf is mirrored in full into the local database. The hub
//      is authoritative for ordering, but it holds no unique data, so a shelf
//      keeps rendering when the hub is down and can be rebuilt from any member.

const HUB_URL = (process.env.HUB_URL || 'https://shelf-hub-production.up.railway.app').replace(/\/+$/, '')

export function hubConfigured() {
  return !!HUB_URL
}

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

  const hubToken = () => getSetting('hub_token')

  async function call(method, path, body, token) {
    const auth = token ?? await hubToken()
    const res = await fetch(HUB_URL + path, {
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

  async function rememberIdentity({ token, user }) {
    if (!token) return
    await setSetting('hub_token', token)
    if (user?.id) await setSetting('hub_user_id', String(user.id))
    if (user?.username) await setSetting('hub_username', user.username)
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

    const existing = await hubToken()
    const payload = {
      name: cat[0].name,
      icon: cat[0].icon,
      tabs: tabs.map(t => ({ local_id: String(t.id), name: t.name, sort_order: t.sort_order })),
      cards: cards.map(c => ({
        tab_local_id: c.subcategory_id ? String(c.subcategory_id) : null,
        type: c.type, url: c.url, title: c.title, description: c.description,
        thumbnail_url: c.thumbnail_url, media_id: c.youtube_id, notes: c.notes,
        metadata: c.metadata || {}
      }))
    }
    if (!existing) payload.username = username?.trim() || 'shelf owner'

    const out = await call('POST', '/shelves', payload)
    await rememberIdentity(out)

    await pool.query('UPDATE categories SET is_collab=TRUE WHERE id=$1', [categoryId])
    await pool.query(
      `INSERT INTO linked_shelves (category_id, hub_shelf_id, last_seq, is_owner, synced_at)
       VALUES ($1,$2,$3,TRUE,NOW())
       ON CONFLICT (category_id) DO UPDATE SET hub_shelf_id=$2, last_seq=$3, is_owner=TRUE, synced_at=NOW()`,
      [categoryId, out.shelf.id, out.shelf.seq]
    )
    for (const [localId, hubTabId] of Object.entries(out.shelf.tab_map || {})) {
      await pool.query('UPDATE subcategories SET hub_tab_id=$1 WHERE id=$2', [hubTabId, Number(localId)])
    }
    // The hub assigned ids to the backfilled cards; adopt them so the puller
    // recognises our own rows instead of duplicating them on the next tick.
    await adoptBackfilled(categoryId, out.shelf.id)
    return out.shelf
  }

  async function adoptBackfilled(categoryId, hubShelfId) {
    const { cards } = await call('GET', `/shelves/${hubShelfId}/cards?since=0`)
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
    const existing = await hubToken()
    const out = await call('POST', '/join', {
      code,
      ...(existing ? {} : { username: username?.trim() || 'shelf owner' })
    })
    await rememberIdentity(out)

    const { rows: already } = await pool.query(
      'SELECT category_id FROM linked_shelves WHERE hub_shelf_id=$1', [out.shelf.id]
    )
    if (already[0]) return { category_id: already[0].category_id, already_linked: true }

    const { rows: cat } = await pool.query(
      'INSERT INTO categories (name, icon, is_collab) VALUES ($1,$2,TRUE) RETURNING *',
      [out.shelf.name, out.shelf.icon || '📁']
    )
    await pool.query(
      'INSERT INTO linked_shelves (category_id, hub_shelf_id, last_seq, is_owner) VALUES ($1,$2,0,FALSE)',
      [cat[0].id, out.shelf.id]
    )
    await syncOne(cat[0].id)
    return { category_id: cat[0].id, already_linked: false }
  }

  // ── Pulling the changefeed ────────────────────────────────────────────────

  async function syncOne(categoryId) {
    const { rows: ls } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!ls[0]) return
    const shelf = ls[0]

    try {
      // Tabs and the shelf name are owner-controlled and live on the hub
      const meta = await call('GET', `/shelves/${shelf.hub_shelf_id}`)
      await pool.query('UPDATE categories SET name=$1, icon=COALESCE($2, icon) WHERE id=$3',
        [meta.name, meta.icon, categoryId])
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
        const people = await call('GET', `/shelves/${shelf.hub_shelf_id}/members`)
        for (const p of people) {
          await pool.query(
            'INSERT INTO hub_users (id, username) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET username=$2',
            [p.id, p.username]
          )
        }
      } catch { /* names go stale for a tick; cards still sync */ }

      const { cards, seq } = await call('GET', `/shelves/${shelf.hub_shelf_id}/cards?since=${shelf.last_seq}`)
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
                              description, thumbnail_url, youtube_id, notes, metadata, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ready')
           ON CONFLICT (hub_card_id) WHERE hub_card_id IS NOT NULL
           DO UPDATE SET subcategory_id=$2, hub_user_id=$4, title=$7, description=$8,
                         thumbnail_url=$9, notes=$11, metadata=$12`,
          [categoryId, tab[0]?.id || null, c.id, c.user_id, c.type, c.url, c.title, c.description,
           c.thumbnail_url, c.media_id, c.notes, JSON.stringify(c.metadata || {})]
        )
      }

      await pool.query(
        'UPDATE linked_shelves SET last_seq=$1, synced_at=NOW(), sync_error=NULL WHERE category_id=$2',
        [Math.max(Number(seq), Number(shelf.last_seq)), categoryId]
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
      metadata: card.metadata || {}
    }

    try {
      return await call('POST', '/cards', payload)
    } catch (err) {
      await queue(categoryId, 'create', payload)
      err.queued = true
      throw err
    }
  }

  async function deleteCard(card) {
    if (!card.hub_card_id) return
    try {
      await call('DELETE', `/cards/${card.hub_card_id}`)
    } catch (err) {
      await queue(card.category_id, 'delete', { hub_card_id: card.hub_card_id })
    }
  }

  async function updateCard(card, patch) {
    if (!card.hub_card_id) return
    try {
      await call('PATCH', `/cards/${card.hub_card_id}`, patch)
    } catch (err) {
      await queue(card.category_id, 'update', { hub_card_id: card.hub_card_id, ...patch })
    }
  }

  async function flushOutbox() {
    const { rows } = await pool.query('SELECT * FROM outbox ORDER BY id LIMIT 50')
    for (const item of rows) {
      try {
        if (item.op === 'create') await call('POST', '/cards', item.payload)
        if (item.op === 'delete') await call('DELETE', `/cards/${item.payload.hub_card_id}`)
        if (item.op === 'update') {
          const { hub_card_id, ...patch } = item.payload
          await call('PATCH', `/cards/${hub_card_id}`, patch)
        }
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
    return call('POST', `/shelves/${ls[0].hub_shelf_id}/invite`, opts)
  }

  async function members(categoryId) {
    const { rows: ls } = await pool.query('SELECT * FROM linked_shelves WHERE category_id=$1', [categoryId])
    if (!ls[0]) return []
    return call('GET', `/shelves/${ls[0].hub_shelf_id}/members`)
  }

  // Renaming has to reach the hub or other instances keep showing the old name
  // on everything this person has ever posted to a shared shelf.
  async function setUsername(username) {
    if (!await hubToken()) return
    await call('PUT', '/me', { username })
    await setSetting('hub_username', username)
  }

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
    url: HUB_URL,
    publish, link, syncOne, syncAll, postCard, deleteCard, updateCard,
    flushOutbox, invite, members, linkedShelf, setUsername, startLoop,
    identity: async () => ({
      token: await hubToken(),
      user_id: await getSetting('hub_user_id'),
      username: await getSetting('hub_username')
    })
  }
}
