// Collaborative posts run their AI pass here, in the poster's own browser, against
// the poster's own endpoint and key. The key is never sent to the shelf server.
import * as api from './api.js'

const KEY = 'shelf_ai'

export function getAI() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}

export function saveAI(cfg) {
  localStorage.setItem(KEY, JSON.stringify(cfg))
}

export const hasAI = () => !!getAI().url?.trim()

async function complete(messages, { maxTokens = 300, temperature = 0.5 } = {}) {
  const { url, key, model } = getAI()
  const res = await fetch(`${url.trim().replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify({
      model: model?.trim() || undefined,
      messages,
      max_tokens: maxTokens,
      temperature
    })
  })
  if (!res.ok) throw new Error(`your AI endpoint returned ${res.status}`)
  const data = await res.json()
  const msg = data.choices?.[0]?.message
  return (msg?.content?.trim() || msg?.reasoning_content?.trim() || '')
}

// Collaborators point this at whatever model they like, and reasoning models leak their
// scratchpad into `content` (or burn the whole budget before answering). Rather than trust
// it, throw away anything that doesn't look like the 1-2 sentences we asked for.
// ponytail: a marker/length heuristic, not a parser — a model that reasons without any of
// these tells still gets through. Upgrade path is per-provider reasoning fields.
const REASONING_TELLS = /^\s*(<think>|thinking process|let me think|okay,? (so )?(the user|i need)|first,? i)/i

export function usableDescription(text) {
  const stripped = (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (!stripped || REASONING_TELLS.test(stripped) || stripped.length > 400) return null
  return stripped
}

export async function testAI() {
  const reply = await complete([{ role: 'user', content: 'Reply with the single word: ok' }], { maxTokens: 8 })
  if (!reply) throw new Error('endpoint replied with nothing')
  return reply
}

// Runs the full scrape + describe + plan pass, then hands back a ready-to-post card.
// Nothing reaches the shelf until this resolves, so collaborators only ever see finished cards.
export async function buildCard(url, onStep = () => {}) {
  onStep('reading the page')
  const p = await api.prepare(url)

  let thumbnail_url = p.thumbnail_url
  if (!thumbnail_url && p.image_candidates.length) {
    onStep('picking an image')
    try {
      const answer = await complete([
        { role: 'system', content: 'You pick the main product image from a numbered list. Reply with only the number.' },
        { role: 'user', content: `Page: ${p.title || url}\n\n${p.image_candidates.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n\nWhich is the main photo?` }
      ], { maxTokens: 5, temperature: 0 })
      const idx = parseInt(answer) - 1
      thumbnail_url = p.image_candidates[idx] || p.image_candidates[0]
    } catch {
      thumbnail_url = p.image_candidates[0]
    }
  }

  onStep('writing a description')
  let description = p.og_description
  try {
    const written = await complete([
      { role: 'system', content: "You write short, punchy card descriptions (1-2 sentences max). No fluff. Just what it is and why it's worth saving. Answer directly with the description and nothing else." },
      { role: 'user', content: `Write a card description for: "${p.title || p.og_description}"\nURL: ${url}` }
    ], { maxTokens: 200, temperature: 0.7 })
    description = usableDescription(written) || p.og_description
  } catch (err) {
    if (!description) throw err
  }

  let plan_raw = null, plan_tools = []
  if (p.transcript) {
    onStep('building a plan from the transcript')
    try {
      plan_raw = await complete([
        { role: 'system', content: 'You are a technical assistant. You read tutorial transcripts and produce clean, actionable step-by-step plans. Output numbered markdown steps only — no preamble, no intro sentence, no sign-off.' },
        { role: 'user', content: `Tutorial: "${p.title || url}"\n\nTRANSCRIPT:\n${p.transcript}\n\n---\nRead this transcript carefully. Flag any steps that seem outdated, ambiguous, or potentially wrong — note corrections inline with [NOTE: ...]. Then output a numbered action plan someone (or an AI coding assistant like Claude Code) could follow right now to replicate this tutorial.` }
      ], { maxTokens: 1200, temperature: 0.4 })

      if (plan_raw) {
        onStep('finding links for the tools it mentions')
        const text = await complete([
          { role: 'user', content: `Read this plan and list every tool, software, or app someone would need to download or find online. Output one name per line, nothing else:\n\n${plan_raw}` }
        ], { maxTokens: 600, temperature: 0.3 })
        plan_tools = text
          .split('\n')
          .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
          .filter(l => l.length > 1 && l.length < 60)
          .slice(0, 10)
      }
    } catch { /* a missing plan shouldn't cost you the link */ }
  }

  onStep('posting')
  return {
    prepared: true,
    url,
    type: p.type,
    youtube_id: p.youtube_id,
    title: p.title,
    description,
    thumbnail_url,
    metadata: p.metadata,
    plan_raw,
    plan_tools
  }
}
