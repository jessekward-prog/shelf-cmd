// Generate a standalone HTML user guide from a repo (or any) URL.
//
// We gather source material (GitHub API for a repo, a plain fetch + tag-strip for
// anything else), the configured model writes the chapters as a small delimited
// format, and we pour those chapters into a fixed styled shell. The model only
// writes words — the design lives here, so output always looks the same no matter
// which model wrote it. The shell wears ShelfStation's retro amber-CRT terminal
// skin: warm-black ground, amber glow, VT323 + JetBrains Mono, scanlines, flicker.

const GITHUB_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?]+)/i

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
}

// ── Self-contained deps (so this module drops into any shelf-cmd) ────────────
// Talks to the same OpenAI-compatible endpoint shelf-cmd already uses for plans.

function lmHeaders() {
  const key = process.env.LM_STUDIO_API_KEY
  return { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) }
}

async function lmComplete(messages, { maxTokens = 800, temperature = 0.4, timeout = 180000, model } = {}) {
  const lmUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234'
  const res = await fetch(`${lmUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: lmHeaders(),
    body: JSON.stringify({
      model: model || process.env.LM_STUDIO_MODEL || undefined,
      messages,
      // maxTokens null/0 → omit the cap so a long guide can finish; the timeout bounds it.
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      temperature
    }),
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new Error(`LM Studio ${res.status}`)
  const data = await res.json()
  const msg = data.choices?.[0]?.message
  return (msg?.content?.trim() || msg?.reasoning_content?.trim() || '')
}

// Reasoning models leak a <think> scratchpad and template tokens — strip them.
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

async function ensureTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS guides (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT,
    filename TEXT,
    chapters INT NOT NULL DEFAULT 0,
    html TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`)
  await pool.query('ALTER TABLE guides ADD COLUMN IF NOT EXISTS tagline TEXT')
  await pool.query('ALTER TABLE guides ADD COLUMN IF NOT EXISTS category TEXT')
  // NULL = a personal guide on the home Workspace tab. Set = generated (or
  // saved) into a specific shelf's own Guides tab.
  await pool.query('ALTER TABLE guides ADD COLUMN IF NOT EXISTS category_id INT REFERENCES categories(id) ON DELETE CASCADE')
}

// ── Source material ──────────────────────────────────────────────────────────

async function fetchGitHub(owner, repo) {
  repo = repo.replace(/\.git$/, '')
  const headers = { 'User-Agent': 'shelf-cmd', Accept: 'application/vnd.github+json' }
  const get = (path, accept) =>
    fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      headers: accept ? { ...headers, Accept: accept } : headers,
      signal: AbortSignal.timeout(12000)
    })

  const meta = await get('').then(r => (r.ok ? r.json() : null)).catch(() => null)
  if (!meta) throw Object.assign(new Error('repo not found or private'), { status: 404 })

  let readme = ''
  try {
    const r = await get('/readme', 'application/vnd.github.raw')
    if (r.ok) readme = await r.text()
  } catch { /* no readme — the guide leans on metadata */ }

  let files = []
  try {
    const t = await get('/contents').then(r => (r.ok ? r.json() : []))
    if (Array.isArray(t)) files = t.map(f => f.name + (f.type === 'dir' ? '/' : ''))
  } catch { /* structure is a nice-to-have */ }

  return { meta, readme, files, source: `https://github.com/${owner}/${repo}` }
}

async function fetchGeneric(url) {
  let html = ''
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; shelf-cmd guide bot)' },
      redirect: 'follow', signal: AbortSignal.timeout(12000)
    })
    if (r.ok) html = await r.text()
  } catch { /* fall through to whatever we have */ }
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim()
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) throw new Error('could not read that page')
  return { meta: { name: title, description: '' }, readme: text.slice(0, 12000), files: [], source: url }
}

function digestOf(src) {
  const m = src.meta || {}
  const head = []
  if (m.full_name || m.name) head.push(`Name: ${m.full_name || m.name}`)
  if (m.description) head.push(`Description: ${m.description}`)
  if (m.language) head.push(`Primary language: ${m.language}`)
  if (m.homepage) head.push(`Homepage: ${m.homepage}`)
  if (m.topics && m.topics.length) head.push(`Topics: ${m.topics.join(', ')}`)
  if (src.files && src.files.length) head.push(`Top-level files: ${src.files.slice(0, 40).join(', ')}`)
  head.push(`Source: ${src.source}`)
  return `${head.join('\n')}\n\n--- README / PAGE TEXT ---\n${(src.readme || '(none provided)').slice(0, 14000)}`
}

// ── Model → chapters ─────────────────────────────────────────────────────────

// Five fixed buckets a guide gets auto-sorted into — kept in sync with the
// legend colors in GuidesView.jsx (PlayStation face-button colors).
const CATEGORIES = ['speed', 'thinking', 'design', 'tools', 'reference']

async function writeChapters(digest, fallbackName) {
  const system =
    'You write a clear, practical end-user guide for a software project using only the ' +
    'README and metadata provided. Reply with ONLY the guide in the exact delimited ' +
    'format requested — no preamble, no meta-commentary, no thinking out loud. Take ' +
    'reasonable liberties to fill small gaps, but never invent commands or facts that ' +
    'contradict the source.'
  const user =
    `Write the guide for this project.\n\n${digest}\n\n---\n` +
    'OUTPUT FORMAT — follow it exactly and output nothing before or after:\n\n' +
    '@@TITLE: <short product name>\n' +
    '@@TAGLINE: <one to two plain sentences: what it is, and what it could help someone do>\n' +
    '@@CATEGORY: <exactly one of: speed, thinking, design, tools, reference — ' +
    'speed = performance/CLI/low-level utilities, thinking = AI/algorithms/data/logic, ' +
    'design = UI/CSS/visual/creative, tools = general dev libraries/frameworks/infra, ' +
    'reference = docs/curated lists/learning material>\n' +
    // Placeholders spelled out rather than <angle-bracketed>: a small model
    // copies a bare "<body>" line into the chapter verbatim.
    '@@CHAPTER: the chapter title\nthe chapter text\n' +
    '@@CHAPTER: the next chapter title\nits chapter text\n\n' +
    'Body rules: use short paragraphs. Use "### " for a sub-heading inside a chapter. ' +
    'Use "- " for bullet lists and "1. " for ordered steps. Put shell commands or config ' +
    'inside triple-backtick code fences. Start a line with "NOTE:", "WARN:", or "DANGER:" ' +
    'for a callout. You may use markdown "| col | col |" tables. Write 4 to 7 chapters ' +
    'covering, as the material allows: what it is and who it is for; getting started / ' +
    'installation; configuration; using the main features; and troubleshooting or tips. ' +
    'Begin your reply directly with @@TITLE.'

  // A whole guide is a big generation — run it on a fast model. Defaults to the
  // plan model (usually the quick one) unless a dedicated guide model is set.
  const model = process.env.LM_STUDIO_GUIDE_MODEL || process.env.LM_STUDIO_PLAN_MODEL || undefined
  const raw = stripReasoning(await lmComplete(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { maxTokens: null, temperature: 0.5, timeout: 240000, model }
  ))
  return parseChapters(raw, fallbackName)
}

function parseChapters(raw, fallbackName) {
  let title = '', tagline = '', category = ''
  const chapters = []
  let cur = null
  for (const line of String(raw).split('\n')) {
    const t = line.match(/^@@TITLE:\s*(.*)$/)
    const g = line.match(/^@@TAGLINE:\s*(.*)$/)
    const k = line.match(/^@@CATEGORY:\s*(.*)$/)
    const c = line.match(/^@@CHAPTER:\s*(.*)$/)
    if (t) { title = t[1].trim(); continue }
    if (g) { tagline = g[1].trim(); continue }
    if (k) { category = k[1].trim().toLowerCase(); continue }
    if (c) { cur = { title: c[1].trim(), body: [] }; chapters.push(cur); continue }
    if (cur) cur.body.push(line)
  }
  if (!CATEGORIES.includes(category)) category = 'reference'
  return {
    title: title || fallbackName || 'User Guide',
    tagline,
    category,
    chapters: chapters
      .map(ch => ({ title: ch.title, body: ch.body.join('\n').trim() }))
      .filter(ch => ch.title)
  }
}

// A cheap, capped call for guides that already have chapters and only need a
// tagline/category backfilled — small max_tokens so it can't run away and
// crash the local model the way an uncapped full-guide generation can.
async function writeBlurb(digest) {
  const system =
    'You summarize a software project in one place. Reply with ONLY the two lines requested — no preamble.'
  const user =
    `${digest}\n\n---\n` +
    'Reply with exactly these two lines and nothing else:\n' +
    '@@TAGLINE: <one to two plain sentences: what it is, and what it could help someone do>\n' +
    '@@CATEGORY: <exactly one of: speed, thinking, design, tools, reference — ' +
    'speed = performance/CLI/low-level utilities, thinking = AI/algorithms/data/logic, ' +
    'design = UI/CSS/visual/creative, tools = general dev libraries/frameworks/infra, ' +
    'reference = docs/curated lists/learning material>'

  const model = process.env.LM_STUDIO_GUIDE_MODEL || process.env.LM_STUDIO_PLAN_MODEL || undefined
  const raw = stripReasoning(await lmComplete(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    // The local model can burn hundreds of tokens on hidden reasoning before it
    // ever reaches the two-line answer — too low a cap starves it mid-thought.
    { maxTokens: 700, temperature: 0.4, timeout: 60000, model }
  ))
  let tagline = '', category = ''
  for (const line of raw.split('\n')) {
    const g = line.match(/^@@TAGLINE:\s*(.*)$/)
    const k = line.match(/^@@CATEGORY:\s*(.*)$/)
    if (g) tagline = g[1].trim()
    if (k) category = k[1].trim().toLowerCase()
  }
  if (!CATEGORIES.includes(category)) category = 'reference'
  return { tagline, category }
}

// ── Markdown-lite → the shell's component set ────────────────────────────────

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => `<a href="${esc(u)}" target="_blank" rel="noreferrer">${t}</a>`)
}

function renderCode(lang, lines) {
  const label = (lang || 'shell').toLowerCase()
  const code = lines.map(l => {
    const e = esc(l)
    return /^\s*(#|\/\/)/.test(l) ? `<span class="c">${e}</span>` : e
  }).join('\n')
  return `<div class="term"><div class="term-bar"><span class="td"></span><span class="td"></span><span class="td"></span><span class="term-name">${esc(label)}</span></div><pre><code>${code}</code></pre></div>`
}

function isTable(chunk) {
  return chunk.length >= 2 && chunk[0].includes('|') && /^\s*\|?[\s:|-]*-[-\s:|]*\|?\s*$/.test(chunk[1])
}
function splitRow(l) { return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim()) }
function renderTable(chunk) {
  const rows = chunk.filter(l => l.trim())
  const th = splitRow(rows[0]).map(c => `<th>${inline(c)}</th>`).join('')
  const trs = rows.slice(2).map(r => `<tr>${splitRow(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`
}

function renderCallout(chunk) {
  const kw = chunk[0].trim().match(/^(NOTE|INFO|TIP|WARN|WARNING|DANGER|CAUTION):/i)[1].toUpperCase()
  const kind = /^(WARN|WARNING)/.test(kw) ? 'warn' : /^(DANGER|CAUTION)/.test(kw) ? 'danger' : /^TIP/.test(kw) ? 'tip' : 'note'
  const glyph = kind === 'warn' ? '&#9888;' : kind === 'danger' ? '&#10007;' : kind === 'tip' ? '&#9733;' : '&#8250;'
  const title = kind === 'warn' ? 'Heads up' : kind === 'danger' ? 'Warning' : kind === 'tip' ? 'Tip' : 'Note'
  const text = chunk.join(' ').replace(/^\s*(NOTE|INFO|TIP|WARN|WARNING|DANGER|CAUTION):\s*/i, '')
  return `<div class="notice ${kind}"><div class="notice-tag"><span class="g">${glyph}</span>${title}</div><div class="notice-body">${inline(text)}</div></div>`
}

function renderBlock(chunk) {
  const first = (chunk[0] || '').trim()
  if (/^(NOTE|INFO|TIP|WARN|WARNING|DANGER|CAUTION):/i.test(first)) return renderCallout(chunk)
  if (isTable(chunk)) return renderTable(chunk)
  if (chunk.every(l => /^\s*[-*]\s+/.test(l))) {
    return `<ul>${chunk.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`
  }
  if (chunk.length > 1 && chunk.every(l => /^\s*\d+[.)]\s+/.test(l))) {
    return `<ol class="steps">${chunk.map(l => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`
  }
  return `<p>${inline(chunk.join(' '))}</p>`
}

function renderBody(md) {
  const lines = String(md).split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim()
      const code = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++
      out.push(renderCode(lang, code))
      continue
    }
    if (line.trim() === '') { i++; continue }
    const hx = line.match(/^\s*(#{2,})\s+(.*)$/)
    if (hx) {
      const text = hx[2].trim()
      out.push(hx[1].length >= 4 ? `<h4>${inline(text)}</h4>` : `<h3>${inline(text)}</h3>`)
      i++
      continue
    }
    const chunk = []
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*```/.test(lines[i]) && !/^\s*#{2,}\s+/.test(lines[i])) {
      chunk.push(lines[i]); i++
    }
    out.push(renderBlock(chunk))
  }
  return out.join('\n')
}

// ── The shell ────────────────────────────────────────────────────────────────

function neofetch(title, src) {
  const m = src.meta || {}
  let host = src.source
  try { host = new URL(src.source).hostname.replace(/^www\./, '') } catch {}
  const rows = []
  rows.push(['host', 'shelfstation'])
  rows.push(['source', host])
  if (m.language) rows.push(['lang', m.language])
  if (m.stargazers_count != null) rows.push(['stars', String(m.stargazers_count)])
  if (m.topics && m.topics.length) rows.push(['topics', m.topics.slice(0, 3).join(' ')])
  if (src.files && src.files.length) rows.push(['files', String(src.files.length) + ' at root'])
  rows.push(['guide', 'generated ' + new Date().toISOString().slice(0, 10)])
  const glyph = (title.trim()[0] || '#').toUpperCase()
  const line = rows.map(r => `<span class="k">${esc(r[0])}</span> <span class="v">${esc(r[1])}</span>`).join('\n')
  return `<div class="term hero-term">
    <div class="term-bar"><span class="td"></span><span class="td"></span><span class="td"></span><span class="term-name">shelf.station — readout</span></div>
    <div class="neo"><div class="neo-glyph">${esc(glyph)}</div><pre class="neo-body">${line}</pre></div>
  </div>`
}

function renderHtml({ title, tagline, source, badges, chapters, meta, files }) {
  const n2 = i => String(i + 1).padStart(2, '0')
  let host = source
  try { host = new URL(source).hostname.replace(/^www\./, '') } catch {}

  const parts = String(title).trim().split(/\s+/)
  const wordmark = parts.length > 1
    ? `<span class="a">${esc(parts[0])}</span><span class="b">${esc(' ' + parts.slice(1).join(' '))}</span>`
    : `<span class="a">${esc(title)}</span>`

  const badgeHtml = ['GUIDE', ...(badges || [])].filter(Boolean).slice(0, 6)
    .map(b => `<span class="tag">${esc(String(b).toUpperCase())}</span>`).join('')

  const sections = chapters.map((ch, i) =>
    `<section id="ch${i}" class="channel reveal">
      <div class="channel-label"><span class="sq"></span>Channel ${n2(i)} &middot; ${esc(String(ch.title).toUpperCase())}</div>
      <h2>${esc(ch.title)}</h2>
      <div class="rule"></div>
      ${renderBody(ch.body)}
    </section>`).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} Guide</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=VT323&display=swap" rel="stylesheet">
<script>document.documentElement.className='js';</script>
<style>${SHELL_CSS}</style>
</head>
<body>
<div class="crt" aria-hidden="true"></div>
<div class="page">
  <header class="hero">
    <div class="hero-main">
      <div class="eyebrow">// generated guide</div>
      <h1 class="wordmark" style="font-size:clamp(34px,9vw,${Math.max(40, Math.min(96, Math.round(867 / Math.max(6, title.length))))}px)">${wordmark}<span class="cursor" aria-hidden="true"></span></h1>
      <div class="tags">${badgeHtml}</div>
      ${tagline ? `<p class="lede">${esc(tagline)}</p>` : ''}
      <div class="bootline">boot://${esc(host)} &middot; guide ready</div>
    </div>
    ${neofetch(title, { meta: meta || {}, source, files: files || [] })}
  </header>
  <main class="doc">
    ${sections}
    <footer>
      <span>ShelfStation &middot; guide generated from ${esc(host)}</span>
      <a href="${esc(source)}" target="_blank" rel="noreferrer">${esc(source)}</a>
    </footer>
  </main>
</div>
<script>${SHELL_JS}</script>
</body>
</html>`
}

// ── Endpoint ─────────────────────────────────────────────────────────────────

export function mountGuide({ app, pool, adminOnly, adminOrToken }) {
  // Protect the routes with the host's auth middleware when provided; the routes
  // are otherwise open, so pass your admin/auth guard in a multi-user setup.
  const guard = adminOnly || ((req, res, next) => next())
  // Downloads are a plain link, not a fetch, so they need the ?t= guard.
  const linkGuard = adminOrToken || guard
  ensureTable(pool).catch(e => console.error('guides table:', e.message))

  app.post('/api/guide', guard, async (req, res) => {
    try {
      const url = String(req.body.url || '').trim()
      if (!/^https?:\/\/\S+$/.test(url)) return res.status(400).json({ error: 'a full http(s) URL is required' })
      // Present = generated into that shelf's own Guides tab. Absent = the personal home tab.
      const categoryId = req.body.category_id ? Number(req.body.category_id) : null

      const gh = url.match(GITHUB_RE)
      const src = gh ? await fetchGitHub(gh[1], gh[2]) : await fetchGeneric(url)
      const fallbackName = src.meta?.name || src.meta?.full_name || 'User Guide'

      const guide = await writeChapters(digestOf(src), fallbackName)
      if (!guide.chapters.length) return res.status(502).json({ error: 'the model returned nothing usable — try again' })

      const html = renderHtml({
        title: guide.title, tagline: guide.tagline, source: src.source,
        badges: badgesOf(src), chapters: guide.chapters,
        meta: src.meta || {}, files: src.files || []
      })
      const s = (guide.title || 'guide').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'guide'
      const filename = `${s}-guide.html`

      // Keep every guide so it shows up in the Workspace; a save failure must not
      // lose the guide the user just waited on, so it's best-effort.
      let id = null
      try {
        const { rows } = await pool.query(
          'INSERT INTO guides (title, source, filename, chapters, html, tagline, category, category_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [guide.title, src.source, filename, guide.chapters.length, html, guide.tagline, guide.category, categoryId]
        )
        id = rows[0].id
      } catch (e) { console.error('guide save:', e.message) }

      res.json({ id, title: guide.title, tagline: guide.tagline, category: guide.category, filename, chapters: guide.chapters.length, html })
    } catch (err) {
      console.error('guide error:', err.message)
      res.status(err.status === 404 ? 404 : 500).json({ error: err.status === 404 ? 'repo not found (or private)' : err.message })
    }
  })

  // The list stays light — the full HTML is only fetched when a guide is opened.
  // No ?category_id → the personal home tab. With it → that shelf's own guides.
  app.get('/api/guides', guard, async (req, res) => {
    const catId = req.query.category_id ? Number(req.query.category_id) : null
    const { rows } = await pool.query(
      `SELECT id, title, tagline, category, source, filename, chapters, created_at FROM guides
       WHERE category_id ${catId ? '= $1' : 'IS NULL'} ORDER BY created_at DESC`,
      catId ? [catId] : []
    )
    res.json(rows)
  })

  // Copies a shelf guide onto the caller's personal home Guides tab.
  app.post('/api/guides/:id/save', guard, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM guides WHERE id=$1', [req.params.id])
    const g = rows[0]
    if (!g) return res.status(404).json({ error: 'not found' })
    const { rows: inserted } = await pool.query(
      `INSERT INTO guides (title, source, filename, chapters, html, tagline, category, category_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL) RETURNING id`,
      [g.title, g.source, g.filename, g.chapters, g.html, g.tagline, g.category]
    )
    res.json({ id: inserted[0].id })
  })

  // Backfills tagline/category on guides that predate those columns (or that a
  // collaborator generated from another client that missed a schema update),
  // then the caller re-fetches the list — which also surfaces anything a
  // collaborator added that this client hadn't seen yet.
  app.post('/api/guides/backfill', guard, async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, title, source FROM guides WHERE tagline IS NULL OR tagline = '' OR category IS NULL OR category = ''"
    )
    let updated = 0
    for (const row of rows) {
      try {
        const gh = (row.source || '').match(GITHUB_RE)
        const src = gh ? await fetchGitHub(gh[1], gh[2]) : await fetchGeneric(row.source)
        const { tagline, category } = await writeBlurb(digestOf(src))
        if (!tagline) continue
        await pool.query('UPDATE guides SET tagline=$1, category=$2 WHERE id=$3', [tagline, category, row.id])
        updated++
      } catch (e) { console.error('guide backfill:', row.id, e.message) }
    }
    res.json({ checked: rows.length, updated })
  })

  app.get('/api/guides/:id', guard, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM guides WHERE id=$1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json(rows[0])
  })

  // Served as a real download rather than a client-side blob: an <a download>
  // built after an await has lost its user activation, and browsers drop that
  // silently as an "automatic" download.
  app.get('/api/guides/:id/download', linkGuard, async (req, res) => {
    const { rows } = await pool.query('SELECT filename, html FROM guides WHERE id=$1', [req.params.id])
    if (!rows[0]) return res.status(404).send('not found')
    const name = (rows[0].filename || 'guide.html').replace(/[^\w.-]/g, '')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.send(rows[0].html)
  })

  app.delete('/api/guides/:id', guard, async (req, res) => {
    await pool.query('DELETE FROM guides WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  })
}

function badgesOf(src) {
  const m = src.meta || {}
  const out = []
  if (m.language) out.push(m.language)
  ;(m.topics || []).slice(0, 4).forEach(t => out.push(t))
  out.push('self-hosted')
  return out
}

// ── Assets ───────────────────────────────────────────────────────────────────
// ShelfStation's retro amber-CRT terminal skin: warm-black ground, amber glow,
// VT323 + JetBrains Mono, scanlines + vignette + flicker, blinking cursor.
// Single dark world by design. Motion degrades to visible without JS.

const SHELL_CSS = `
  :root {
    --bg:#0e0a00; --bg-deep:#080600; --surface:#160f00; --surface-2:#1f1600; --panel:#120c00;
    --border:#3d2e00; --border-2:#5a4400;
    --amber:#e8840a; --amber-lit:#f0b458; --amber-bright:#ffab40;
    --text:#f0b458; --text-2:#c8a060; --text-3:#8a6a1a;
    --cyan:#38bdf8; --green:#7bd88f; --red:#ff8a80; --red-bg:#2a1215;
    --glow:0 0 26px rgba(232,132,10,.45), 0 0 60px rgba(232,132,10,.14);
    --radius:4px;
    --mono:'JetBrains Mono',ui-monospace,'Cascadia Code',Menlo,monospace;
    --crt:'VT323','JetBrains Mono',monospace;
  }
  *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; scroll-padding-top:24px; }
  body { background:var(--bg); color:var(--text-2); font-family:var(--mono); font-size:15px; line-height:1.72;
    -webkit-font-smoothing:antialiased;
    background-image: radial-gradient(ellipse 120% 90% at 50% -10%, rgba(232,132,10,.06), transparent 60%); }
  .crt { position:fixed; inset:0; z-index:60; pointer-events:none;
    background:
      repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 1px, transparent 1px 3px),
      radial-gradient(ellipse 120% 120% at 50% 30%, transparent 58%, rgba(0,0,0,.5));
    animation:flicker 6s infinite steps(1); }
  @keyframes flicker { 0%,100%{opacity:.9} 92%{opacity:.9} 93%{opacity:.72} 94%{opacity:.92} 96%{opacity:.82} 97%{opacity:.94} }
  @keyframes blink { 0%,48%{opacity:1} 49%,100%{opacity:0} }
  @media (prefers-reduced-motion: reduce) { .crt { animation:none; } .cursor { animation:none; } }

  .page { max-width:1080px; margin:0 auto; padding:0 clamp(20px,5vw,44px); position:relative; z-index:1; }
  a { color:var(--amber-lit); text-decoration:none; border-bottom:1px solid rgba(232,132,10,.35); transition:color .15s,border-color .15s; }
  a:hover { color:var(--amber-bright); border-bottom-color:var(--amber); }
  strong { color:var(--amber-lit); font-weight:700; }
  code { font-family:var(--mono); font-size:.86em; background:var(--surface-2); border:1px solid var(--border);
    color:var(--amber-lit); padding:1px 6px; border-radius:3px; }

  /* ── Hero ── */
  .hero { display:grid; grid-template-columns:1.1fr .9fr; gap:clamp(24px,4vw,48px); align-items:center;
    min-height:78vh; padding:clamp(40px,8vh,90px) 0 clamp(30px,5vh,60px); }
  .hero > * { min-width:0; }
  @media (max-width:820px){ .hero { grid-template-columns:1fr; min-height:auto; } }
  .eyebrow { font-family:var(--crt); font-size:20px; letter-spacing:.24em; text-transform:uppercase; color:var(--amber); opacity:.8; margin-bottom:14px; }
  .wordmark { font-family:var(--mono); font-weight:700; font-size:clamp(46px,9vw,96px); line-height:.92; letter-spacing:-.03em; display:flex; align-items:baseline; flex-wrap:wrap; overflow-wrap:anywhere; }
  .wordmark .a { color:var(--amber-bright); text-shadow:var(--glow); }
  .wordmark .b { color:var(--text-3); }
  .cursor { display:inline-block; width:.5ch; height:.82em; background:var(--amber); margin-left:.12em; box-shadow:var(--glow); animation:blink 1.1s steps(1) infinite; }
  .tags { display:flex; flex-wrap:wrap; gap:8px; margin:22px 0 0; }
  .tag { font-family:var(--mono); font-size:10.5px; letter-spacing:.14em; color:var(--text-2); border:1px solid var(--border-2);
    padding:4px 10px; border-radius:2px; background:rgba(232,132,10,.04); }
  .lede { max-width:52ch; margin:22px 0 0; color:var(--text-2); font-size:16px; line-height:1.7; }
  .bootline { font-family:var(--crt); font-size:19px; letter-spacing:.06em; color:var(--text-3); margin-top:26px; }

  /* ── Terminal panels ── */
  .term { background:var(--panel); border:1px solid var(--border); border-radius:6px; margin:18px 0 24px; overflow:hidden;
    box-shadow:0 30px 60px -40px rgba(0,0,0,.9); }
  .term-bar { display:flex; align-items:center; gap:7px; padding:9px 13px; background:var(--surface); border-bottom:1px solid var(--border); }
  .term-bar .td { width:9px; height:9px; border-radius:50%; background:var(--border-2); }
  .term-bar .td:first-child { background:#7a3b12; } .term-bar .td:nth-child(2){ background:#7a5a12; } .term-bar .td:nth-child(3){ background:#3d5a12; }
  .term-name { margin-left:8px; font-family:var(--crt); font-size:16px; letter-spacing:.1em; text-transform:uppercase; color:var(--text-3); }
  .term pre { margin:0; padding:16px 18px; overflow-x:auto; font-family:var(--mono); font-size:13px; line-height:1.68; color:var(--amber-lit); }
  .term pre code { background:none; border:0; padding:0; color:inherit; font-size:inherit; }
  .term .c { color:var(--text-3); }
  .hero-term { margin:0; }
  .neo { display:grid; grid-template-columns:auto minmax(0,1fr); gap:0 22px; padding:22px 22px 26px; align-items:center; }
  .neo-glyph { font-family:var(--crt); font-size:120px; line-height:.8; color:var(--amber); text-shadow:var(--glow); }
  .neo-body { font-family:var(--crt); font-size:19px; line-height:1.35; color:var(--text-2); white-space:pre; }
  .neo-body .k { color:var(--amber); } .neo-body .v { color:var(--text-2); }
  @media (max-width:520px){ .neo-glyph { font-size:76px; } .neo-body { font-size:16px; } }

  /* ── Channels / sections ── */
  .doc { padding-bottom:120px; }
  .channel { padding-top:56px; margin-bottom:20px; scroll-margin-top:24px; }
  .channel-label { display:inline-flex; align-items:center; gap:9px; font-size:11px; font-weight:500; letter-spacing:.18em;
    text-transform:uppercase; color:var(--amber); margin-bottom:12px; }
  .channel-label .sq { width:8px; height:8px; background:var(--amber); box-shadow:var(--glow); }
  h2 { font-family:var(--mono); font-weight:700; font-size:clamp(26px,4.4vw,38px); letter-spacing:-.02em; color:var(--amber-lit); line-height:1.12; }
  .rule { height:1px; background:linear-gradient(90deg, var(--border-2), transparent); margin:18px 0 30px; }
  h3 { font-family:var(--mono); font-weight:700; font-size:17px; color:var(--amber-lit); margin:34px 0 12px; }
  h4 { font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-3); margin:26px 0 10px; }
  p { margin:0 0 16px; color:var(--text-2); } p:last-child { margin-bottom:0; }
  ul,ol { margin:0 0 18px; padding:0; list-style:none; }
  ul li { position:relative; padding-left:22px; margin:7px 0; color:var(--text-2); }
  ul li::before { content:'\\203A'; position:absolute; left:4px; top:-1px; color:var(--amber); font-weight:700; }
  ol.steps { display:flex; flex-direction:column; gap:9px; counter-reset:step; margin-bottom:24px; }
  ol.steps > li { counter-increment:step; position:relative; padding:13px 16px 13px 54px; background:var(--surface);
    border:1px solid var(--border); border-radius:var(--radius); color:var(--text-2); }
  ol.steps > li::before { content:counter(step,decimal-leading-zero); position:absolute; left:14px; top:12px; width:28px; height:24px;
    display:flex; align-items:center; justify-content:center; font-family:var(--crt); font-size:17px; color:var(--amber);
    border:1px solid var(--border-2); border-radius:3px; background:var(--bg-deep); }

  /* ── Notices ── */
  .notice { border:1px solid var(--border); border-left-width:3px; background:var(--surface); border-radius:0 var(--radius) var(--radius) 0;
    padding:14px 18px; margin:18px 0 24px; }
  .notice-tag { font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--amber); margin-bottom:5px; display:flex; align-items:center; gap:8px; }
  .notice-tag .g { font-size:13px; }
  .notice-body { color:var(--text-2); font-size:14px; line-height:1.65; }
  .notice.note { border-left-color:var(--amber); }
  .notice.tip { border-left-color:var(--cyan); } .notice.tip .notice-tag { color:var(--cyan); }
  .notice.warn { border-left-color:var(--amber-bright); } .notice.warn .notice-tag { color:var(--amber-bright); }
  .notice.danger { border-left-color:var(--red); background:var(--red-bg); } .notice.danger .notice-tag { color:var(--red); }

  /* ── Tables ── */
  .table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius); margin:18px 0 24px; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { text-align:left; padding:10px 15px; background:var(--surface); color:var(--text-3); font-size:11px; letter-spacing:.08em;
    text-transform:uppercase; border-bottom:1px solid var(--border); }
  td { padding:11px 15px; border-bottom:1px solid var(--border); color:var(--text-2); vertical-align:top; }
  tr:last-child td { border-bottom:none; } tr:hover td { background:rgba(232,132,10,.03); }

  footer { border-top:1px solid var(--border); margin-top:70px; padding:28px 0 0; display:flex; justify-content:space-between;
    flex-wrap:wrap; gap:10px; font-size:12px; color:var(--text-3); font-family:var(--crt); letter-spacing:.04em; }
  footer, footer * { font-size:16px; } footer a { border:none; color:var(--text-3); } footer a:hover { color:var(--amber); }

  /* ── Motion ── */
  .js .reveal { opacity:0; transform:translateY(18px); }
  .js .reveal.in { opacity:1; transform:none; transition:opacity .6s ease, transform .6s cubic-bezier(.2,.7,.2,1); }
  @media (prefers-reduced-motion: reduce) { .js .reveal, .js .reveal.in { opacity:1; transform:none; transition:none; } }
`

const SHELL_JS = `
  (function () {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var reveals = [].slice.call(document.querySelectorAll('.reveal'));
    function show(el) { el.classList.add('in'); }
    if (!('IntersectionObserver' in window) || reduce) { reveals.forEach(show); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    reveals.forEach(function (el) {
      var r = el.getBoundingClientRect();
      // Anything already on screen at load (incl. an #anchor landing) shows now;
      // only genuinely below-the-fold sections wait to animate in on scroll.
      if (r.top < window.innerHeight && r.bottom > 0) show(el);
      else io.observe(el);
    });
    // Belt-and-braces: never leave content hidden if the observer misfires.
    setTimeout(function () { reveals.forEach(function (el) { if (!el.classList.contains('in')) { var r = el.getBoundingClientRect(); if (r.top < window.innerHeight) show(el); } }); }, 1200);
  })();
`
