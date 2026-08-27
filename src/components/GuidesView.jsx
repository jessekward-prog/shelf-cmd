import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

function host(u) { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u || '' } }

// PlayStation face-button colors, kept subtle (low-alpha) so they tint rather
// than fight the active ShelfStation theme. Mirrors server/guide.js CATEGORIES.
// Exported so any other view sorting content into the same five buckets (e.g.
// cards) reuses this one taxonomy instead of drifting into a second one.
export const CATEGORIES = [
  { id: 'speed',     label: 'Speed',     color: '#4f8fe0' }, // ✕ blue
  { id: 'tools',     label: 'Tools',     color: '#e0564f' }, // ○ red
  { id: 'thinking',  label: 'Thinking',  color: '#3fb37f' }, // △ green
  { id: 'design',    label: 'Design',    color: '#e0559c' }, // □ pink
  { id: 'reference', label: 'Reference', color: '#8f8f8f' }, // neutral
]
export const CATEGORY_COLOR = Object.fromEntries(CATEGORIES.map(c => [c.id, c.color]))

export function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 14 }}>
      {CATEGORIES.map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
          <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--s-text-3)' }}>{c.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function GuidesView({ onGenerate, refreshKey, categoryId }) {
  const [guides, setGuides] = useState(null) // null = loading
  const [busyId, setBusyId] = useState(null)
  const [savedId, setSavedId] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const load = () => api.getGuides(categoryId).then(setGuides).catch(() => setGuides([]))
  useEffect(() => { load() }, [refreshKey, categoryId])

  // Backfills any guide missing a blurb/category (older cards, or one a
  // collaborator generated before this shipped), then reloads the list — which
  // also pulls in anything a collaborator added that this client hasn't seen.
  const refresh = async () => {
    setSyncing(true)
    try { await api.backfillGuides() } catch { /* best-effort */ }
    await load()
    setSyncing(false)
  }

  // The list omits the HTML, so open/download fetch the full guide on demand.
  const withHtml = async (id, use) => {
    setBusyId(id)
    try {
      const g = await api.getGuide(id)
      const url = URL.createObjectURL(new Blob([g.html], { type: 'text/html' }))
      use(url, g)
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch { /* ignore */ } finally { setBusyId(null) }
  }
  const openGuide = (id) => withHtml(id, (url) => window.open(url, '_blank'))
  const removeGuide = async (id) => {
    setConfirmId(null)
    setGuides(prev => prev.filter(x => x.id !== id))
    await api.deleteGuide(id).catch(() => {})
  }
  const saveGuide = async (id) => {
    try {
      await api.saveGuide(id)
      setSavedId(id)
      setTimeout(() => setSavedId(null), 2000)
    } catch { /* ignore */ }
  }

  const btn = {
    padding: '5px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit',
    border: '1px solid var(--s-border)', color: 'var(--s-text-2)', background: 'transparent',
    transition: 'border-color 0.15s, color 0.15s', cursor: 'pointer', whiteSpace: 'nowrap'
  }

  return (
    <div className="px-4 pb-24" style={{ maxWidth: '52rem', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, color: 'var(--s-text-0)', fontWeight: 500 }}>Guides</div>
          <div style={{ fontSize: 11, color: 'var(--s-text-3)', letterSpacing: '0.04em', marginTop: 2 }}>
            {categoryId
              ? 'Every guide made in this shelf lives here. Save a copy to your home tab any time.'
              : 'Every guide you generate is saved here.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={refresh}
            disabled={syncing}
            title="Backfill missing blurbs and pull in anything new"
            style={{
              padding: '7px 10px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
              border: '1px solid var(--s-border)', color: 'var(--s-text-2)', background: 'transparent',
              display: 'flex', alignItems: 'center', opacity: syncing ? 0.5 : 1
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ width: 14, height: 14, animation: syncing ? 'spin 0.8s linear infinite' : 'none' }}>
              <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
            </svg>
          </button>
          <button
            onClick={onGenerate}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
              background: 'var(--s-accent)', color: 'var(--s-bg)', fontWeight: 500
            }}
          >
            + New guide
          </button>
        </div>
      </div>

      <Legend />

      {guides === null ? (
        <div style={{ textAlign: 'center', paddingTop: 48, color: 'var(--s-text-3)', fontSize: 12, letterSpacing: '0.1em' }}>
          loading…
        </div>
      ) : guides.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 48, color: 'var(--s-text-3)', fontSize: 12, letterSpacing: '0.1em', lineHeight: 2 }}>
          no guides yet<br />
          <span style={{ fontSize: 11 }}>generate one from a repo or page URL</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <AnimatePresence initial={false}>
            {guides.map(g => {
              const color = CATEGORY_COLOR[g.category] || CATEGORY_COLOR.reference
              return (
                <motion.div
                  key={g.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="aspect-[4/3]"
                  style={{
                    background: 'var(--s-surface)', border: `1px solid ${color}55`,
                    borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column',
                    justifyContent: 'space-between', gap: 6, minWidth: 0
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <div className="truncate" style={{ fontSize: 13, color: 'var(--s-text-0)', fontWeight: 500 }}>{g.title}</div>
                    </div>
                    {g.tagline ? (
                      <div className="line-clamp-3" style={{ fontSize: 11, color: 'var(--s-text-2)', marginTop: 5, lineHeight: 1.45 }}>
                        {g.tagline}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontSize: 10, color: 'var(--s-text-3)', marginBottom: 6 }}>
                      {g.source ? host(g.source) : ''} · {g.chapters} ch
                      {g.mode && g.mode !== 'man' ? ` · ${g.mode}` : ''} · {new Date(g.created_at).toLocaleDateString()}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button style={btn} disabled={busyId === g.id} onClick={() => openGuide(g.id)}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--s-accent)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--s-border)'}>
                        {busyId === g.id ? '…' : 'open'}
                      </button>
                      <a href={api.guideDownloadUrl(g.id)} download
                        style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--s-accent)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--s-border)'}>
                        download
                      </a>
                      {categoryId ? (
                        <button style={{ ...btn, color: savedId === g.id ? 'var(--s-accent)' : btn.color }}
                          onClick={() => saveGuide(g.id)}
                          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--s-accent)'}
                          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--s-border)'}>
                          {savedId === g.id ? 'saved' : 'save'}
                        </button>
                      ) : null}
                      <div style={{ flex: 1 }} />
                      {confirmId === g.id ? (
                        <button
                          onClick={() => removeGuide(g.id)}
                          style={{ ...btn, border: 'none', background: 'rgba(180,40,0,0.9)', color: '#fff' }}
                        >
                          delete?
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmId(g.id)}
                          title="Delete"
                          style={{ padding: 5, borderRadius: 4, color: 'var(--s-text-3)', transition: 'color 0.15s', background: 'transparent', flexShrink: 0 }}
                          onMouseEnter={e => e.currentTarget.style.color = '#c0392b'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--s-text-3)'}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
