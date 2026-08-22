import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

function host(u) { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u || '' } }

export default function GuidesView({ onGenerate, refreshKey }) {
  const [guides, setGuides] = useState(null) // null = loading
  const [busyId, setBusyId] = useState(null)
  const [confirmId, setConfirmId] = useState(null)

  useEffect(() => {
    api.getGuides().then(setGuides).catch(() => setGuides([]))
  }, [refreshKey])

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

  const btn = {
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
    border: '1px solid var(--s-border)', color: 'var(--s-text-2)', background: 'transparent',
    transition: 'border-color 0.15s, color 0.15s', cursor: 'pointer'
  }

  return (
    <div className="px-4 pb-24" style={{ maxWidth: '42rem', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, color: 'var(--s-text-0)', fontWeight: 500 }}>Guides</div>
          <div style={{ fontSize: 11, color: 'var(--s-text-3)', letterSpacing: '0.04em', marginTop: 2 }}>
            Every guide you generate is saved here.
          </div>
        </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <AnimatePresence initial={false}>
            {guides.map(g => (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                style={{
                  background: 'var(--s-surface)', border: '1px solid var(--s-border)',
                  borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate" style={{ fontSize: 14, color: 'var(--s-text-0)', fontWeight: 500 }}>{g.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--s-text-3)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {g.source
                        ? <a href={g.source} target="_blank" rel="noreferrer" style={{ color: 'var(--s-text-2)', textDecoration: 'none' }}>{host(g.source)}</a>
                        : null}
                      <span>· {g.chapters} chapter{g.chapters === 1 ? '' : 's'}</span>
                      <span>· {new Date(g.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button style={btn} disabled={busyId === g.id} onClick={() => openGuide(g.id)}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--s-accent)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--s-border)'}>
                    {busyId === g.id ? 'opening…' : 'open'}
                  </button>
                  <a href={api.guideDownloadUrl(g.id)} download
                    style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--s-accent)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--s-border)'}>
                    download
                  </a>
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
                      style={{ padding: 6, borderRadius: 4, color: 'var(--s-text-3)', transition: 'color 0.15s', background: 'transparent' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#c0392b'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--s-text-3)'}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
