/* Deals — "is this same thing cheaper somewhere else, and what's like it?"
 *
 * Two different questions, answered by two deliberately different mechanisms:
 *
 *   exact    match on a GTIN (UPC/EAN) or brand+model. An identifier match is a
 *            fact, so no model is asked to judge it.
 *   similar  match on a compressed search query, then the model re-ranks what
 *            came back and throws out accessories that merely share keywords.
 *
 * THE RULE THAT MATTERS: the model never produces a price or a URL. Every row a
 * user sees was fetched from a real page and carries the URL it came from. A
 * local model asked to "go find prices" will cheerfully invent them — one has
 * faked an entire web_search call before now — so retrieval is always
 * pre-fetched here and the model's only job is ordering and filtering rows we
 * already hold. If a source returns nothing, the answer is nothing.
 */

/* Plain Playwright on purpose. index.js scrapes with playwright-extra + the
 * stealth plugin, but every source listed below serves a plain headless browser
 * real results (verified), so nothing here depends on defeating bot detection.
 * A site that turns an automated browser away is treated as a site that said
 * no: it gets dropped from SOURCES rather than disguised. See the note there
 * about eBay. */
import { chromium } from 'playwright'
import { EventEmitter } from 'events'

/* Progress is reported, never simulated. Every event emitted below corresponds
 * to a step the lookup is actually performing at that moment. A ~40s silent
 * button is indistinguishable from a hang, but a staged animation on a timer
 * would be worse than silence: it would keep cheerfully advancing after the
 * job had already died. Consumers get the truth or nothing. */
export const progress = new EventEmitter()
const step = (cardId, data) => { if (cardId) progress.emit('step', { cardId, ...data }) }

const LM_URL = () => process.env.LM_STUDIO_URL || 'http://localhost:1234'

function lmHeaders() {
  const key = process.env.LM_STUDIO_API_KEY || ''
  return { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) }
}

/* Politeness. These are other people's servers and this runs in the background,
 * so a steady trickle is both kinder and much less likely to trip bot detection
 * than a burst. Tune here, not in the crawler. (Same reasoning as partscout.) */
const PACING = {
  betweenSourcesMs: 2500,
  renderWaitMs: 3500,
  navTimeoutMs: 25000,
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const money = (s) => {
  const n = parseFloat(String(s).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/* ── Sources ───────────────────────────────────────────────────────────────
 * Each source turns a query string into a URL, then turns a rendered page into
 * rows. Adding a retailer means adding one entry here and nothing else.
 * `extract` runs inside the browser via page.evaluate, so it must be entirely
 * self-contained — it cannot close over anything in this module.
 *
 * Who is NOT here, and why (probed 2026-09-15, don't re-litigate without
 * re-probing): Kogan sits behind DataDome and hard-403s a headless browser.
 * Catch is shut down and serves a 403 maintenance page. MyDeal is gone —
 * the domain 301s to Big W Marketplace. Google Shopping bounces to its
 * "unusual traffic" captcha on the very first request.
 *
 * eBay is the deliberate omission. Its search 403s roughly two thirds of
 * requests from an automated browser — that is the site declining automated
 * access, and the fix is not to disguise the browser. eBay publishes a free
 * Browse API that answers exactly the question this module asks, including an
 * exact `gtin=` lookup. Add eBay here as an API-backed source once a developer
 * key exists; do not add it as a scraper.
 */
export const SOURCES = [
  {
    name: 'Amazon AU',
    currency: 'AUD',
    url: (q) => `https://www.amazon.com.au/s?k=${encodeURIComponent(q)}`,
    extract: () => [...document.querySelectorAll('[data-component-type="s-search-result"]')].map(el => {
      const a = el.querySelector('h2 a') || el.querySelector('a.a-link-normal[href*="/dp/"]')
      return {
        title: el.querySelector('h2')?.innerText?.trim(),
        url: a ? new URL(a.getAttribute('href'), location.origin).href.split('?')[0] : null,
        price: el.querySelector('.a-price .a-offscreen')?.textContent,
        image: el.querySelector('img.s-image')?.src || null,
        sku: el.getAttribute('data-asin') || null,
      }
    }),
  },
  {
    // Narrow catalog — genuinely stocks monitors and electronics, but has no PC
    // components or housewares, so it returns keyword noise for those. The rank
    // step is what keeps that noise out of the card.
    name: 'Officeworks',
    currency: 'AUD',
    scroll: 2,
    url: (q) => `https://www.officeworks.com.au/shop/officeworks/search?q=${encodeURIComponent(q)}`,
    extract: () => [...document.querySelectorAll('[data-ref^="product-tile-"]')].map(el => {
      const a = el.querySelector('a[href*="/shop/officeworks/p/"]')
      return {
        title: el.querySelector('[data-ref^="product-name-"]')?.textContent?.trim(),
        url: a ? new URL(a.getAttribute('href'), location.origin).href : null,
        price: (el.textContent.match(/\$([0-9,]+\.[0-9]{2})/) || [])[1],
        image: el.querySelector('img')?.src || null,
        sku: (el.getAttribute('data-ref') || '').replace('product-tile-', '') || null,
      }
    }),
  },
]

/* ── Search ─────────────────────────────────────────────────────────────── */

// One browser for the whole run, pages visited one at a time. Launching
// chromium is the expensive part (~1s); re-launching it per source would
// triple the cost of a lookup for no benefit.
async function search(query, sources, perSource, ctx = {}) {
  if (!query || !sources.length) return []
  const browser = await chromium.launch({ headless: true })
  const out = []
  try {
    const browserCtx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-AU',
      extraHTTPHeaders: { 'Accept-Language': 'en-AU,en;q=0.9' },
    })
    for (const src of sources) {
      step(ctx.cardId, { step: 'search', kind: ctx.kind, source: src.name })
      const page = await browserCtx.newPage()
      try {
        await page.goto(src.url(query), { waitUntil: 'domcontentloaded', timeout: PACING.navTimeoutMs })
        await page.waitForTimeout(PACING.renderWaitMs)
        // Some grids only build their tiles as you come down the page.
        for (let i = 0; i < (src.scroll || 0); i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2))
          await page.waitForTimeout(1200)
        }
        const rows = await page.evaluate(src.extract)
        for (const r of (rows || []).slice(0, perSource)) {
          const price = money(r.price)
          if (!r.title || !r.url || !price) continue   // a row without a real price is not a deal
          // Sponsored/brand slots render a bare brand name ("Prechen",
          // "Thermaltake") where a product title should be — different markup,
          // same selector. A real product title is never one or two words.
          if (r.title.trim().split(/\s+/).length < 3) continue
          out.push({ ...r, price, source: src.name, currency: src.currency || 'AUD' })
        }
      } catch (err) {
        console.error(`deals: ${src.name} failed —`, err.message)
      } finally {
        await page.close().catch(() => {})
      }
      await sleep(PACING.betweenSourcesMs)
    }
  } finally {
    await browser.close().catch(() => {})
  }
  return out
}

/* ── The model's two jobs, both bounded ─────────────────────────────────── */

/* Budget note, measured not guessed: the default model here (gemma-4-e2b) is a
 * reasoning model, and it spends ~330 hidden tokens thinking before it emits a
 * 5-token answer. Below ~400 max_tokens it returns finish_reason "length" with
 * an EMPTY content string — the whole budget went to reasoning_content — and
 * every caller silently takes its fallback path while looking like it worked.
 * So these budgets are deliberately far larger than the answers need. Cost is
 * ~1.6s per call, which is fine for a background action.
 *
 * We still read `content` only, never `reasoning_content` — the scratchpad is
 * not an answer, and the rest of this codebase holds the same line. */
async function ask(system, user, maxTokens) {
  try {
    const res = await fetch(`${LM_URL()}/v1/chat/completions`, {
      method: 'POST',
      headers: lmHeaders(),
      body: JSON.stringify({
        model: process.env.LM_STUDIO_MODEL || undefined,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxTokens,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const choice = data.choices?.[0]
    const content = choice?.message?.content?.trim()
    if (!content && choice?.finish_reason === 'length') {
      console.error('deals: model used its entire token budget on reasoning and returned no answer — raise max_tokens or load an instruct model')
    }
    return content || null
  } catch {
    return null
  }
}

// A product title is written for a listing page, not a search box: it's stuffed
// with specs and keywords that make an exact-phrase search return nothing.
// Compress it to the few words a person would actually type.
export async function compressQuery(title) {
  if (!title) return ''
  const answer = await ask(
    'You turn a long product listing title into a short search query. Reply with ONLY the query: 3 to 6 words, the brand and the product type and its key size or model. No punctuation, no explanation.',
    `Listing title: "${title}"\n\nSearch query:`,
    500
  )
  const cleaned = (answer || '').replace(/^["']|["']$/g, '').replace(/[\n\r]/g, ' ').trim()
  // Fall back to the first few words of the title rather than failing the whole
  // lookup — a mediocre query still returns real rows.
  if (!cleaned || cleaned.length > 90) return title.split(/\s+/).slice(0, 6).join(' ')
  return cleaned
}

// The model sees ONLY rows we already fetched, and may only answer with their
// indices. It cannot introduce a product, a price, or a link.
export async function rankResults(cardTitle, rows) {
  if (rows.length <= 1) return rows
  const list = rows.map((r, i) => `${i + 1}. ${r.title} — $${r.price} (${r.source})`).join('\n')
  const answer = await ask(
    'You decide which search results are the SAME KIND OF PRODUCT as a reference item. Accessories, spare parts, cables, cases and bundles are NOT the same kind of product. Reply with ONLY the matching numbers, comma separated, best match first. No other text.',
    `Reference item: "${cardTitle}"\n\nResults:\n${list}\n\nWhich numbers are the same kind of product?`,
    700
  )
  if (!answer) return rows
  const picked = [...answer.matchAll(/\d+/g)]
    .map(m => rows[parseInt(m[0], 10) - 1])
    .filter(Boolean)
  const seen = new Set()
  const ordered = picked.filter(r => !seen.has(r.url) && seen.add(r.url))
  return ordered.length ? ordered : rows
}

/* ── Orchestration ──────────────────────────────────────────────────────── */

// An identifier match is exact by construction: if a listing comes back for a
// GTIN search, it IS that product. Brand+model is the fallback and is close to
// exact in practice, but is marked separately so the UI can be honest about it.
function exactQueries(ids = {}) {
  const qs = []
  if (ids.gtin) qs.push({ q: ids.gtin, basis: 'gtin' })
  if (ids.brand && ids.model) qs.push({ q: `${ids.brand} ${ids.model}`, basis: 'model' })
  else if (ids.mpn) qs.push({ q: ids.mpn, basis: 'mpn' })
  return qs
}

export async function findDeals(card, { sources = SOURCES, perSource = 6 } = {}) {
  const ids = card.metadata?.identifiers || {}
  const ownPrice = money(card.metadata?.price)
  const usable = sources.filter(s => s.enabled !== false)
  const cardId = card.id

  const exact = []
  for (const { q, basis } of exactQueries(ids)) {
    const rows = await search(q, usable, 3, { cardId, kind: 'exact' })
    for (const r of rows) exact.push({ ...r, basis })
    if (exact.length) break   // a GTIN hit is definitive; don't also fuzzy-match
  }

  step(cardId, { step: 'query' })
  const query = await compressQuery(card.title)
  const found = await search(query, usable, perSource, { cardId, kind: 'similar' })
  // Anything already returned as an exact match shouldn't repeat as "similar".
  const exactUrls = new Set(exact.map(r => r.url))
  const candidates = found.filter(r => !exactUrls.has(r.url))
  step(cardId, { step: 'rank', count: candidates.length })
  const similar = await rankResults(card.title, candidates)
  step(cardId, { step: 'done' })

  const cheaper = ownPrice ? exact.filter(r => r.price < ownPrice) : exact

  return {
    checked_at: new Date().toISOString(),
    query,
    own_price: ownPrice,
    exact: exact.slice(0, 6),
    cheaper: cheaper.slice(0, 3),
    similar: similar.slice(0, 6),
    sources_tried: usable.map(s => s.name),
  }
}
