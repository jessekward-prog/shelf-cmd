import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

function EnvelopeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" />
    </svg>
  )
}

const ACTIVITY_ICON = {
  card_added: '＋', card_removed: '－', file_added: '＋', file_removed: '－',
  guide_added: '＋', guide_removed: '－'
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const lastSeenKey = (catId) => `shelf_chat_lastseen_${catId}`

// A fixed amber border — not var(--s-accent) — is the only thing that doesn't
// follow the active theme. It's what makes the panel read as "the chat" at a
// glance; everything inside it still uses the theme's own colors normally.
const AMBER_BORDER = 'rgba(232,132,10,0.55)'
// Both the notch and the panel sit on this same bottom anchor, clearing the
// mobile bottom nav. The panel's height is fixed rather than spanning up to
// the topbar — a card, not a full-height drawer.
const RAIL_BOTTOM = 'calc(3.5rem + env(safe-area-inset-bottom) + 20px)'
// Rail and panel share one height so the panel fills the rail exactly,
// rather than the rail poking out past the panel's top and bottom.
const PANEL_HEIGHT = 'min(850px, 85vh)'
const RAIL_HEIGHT = PANEL_HEIGHT
// The notch's one fixed spot — same whether the panel's open or closed.
const NOTCH_BOTTOM = `calc(${RAIL_BOTTOM} - 8px)`
// The notch pokes up into the panel's bottom-right corner by this much —
// the send/ask forms need at least this much bottom clearance so their
// buttons don't sit underneath it.
const NOTCH_OVERLAP = 20

// Floating per-shelf chat: "man" is member-to-member messages, "machine" is an
// auto-generated activity log. Mounted once per shelf at the App level (not
// inside CardGrid/DrivePage/GuidesView) so it survives switching between a
// shelf's CARDS/DRIVE/GUIDES tabs — only a shelf switch remounts it.
export default function ShelfChat({ categoryId, isLinked }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('man')
  const [messages, setMessages] = useState([])
  const [activity, setActivity] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [qaLog, setQaLog] = useState([])
  const [lastSeen, setLastSeen] = useState(() => localStorage.getItem(lastSeenKey(categoryId)) || new Date(0).toISOString())
  const listRef = useRef(null)
  const esRef = useRef(null)

  useEffect(() => {
    api.getMessages(categoryId).then(setMessages).catch(() => setMessages([]))
    api.getActivity(categoryId).then(setActivity).catch(() => setActivity([]))

    const es = new EventSource(api.chatStreamUrl(categoryId))
    es.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
    })
    es.addEventListener('activity', (e) => {
      const a = JSON.parse(e.data)
      setActivity(prev => prev.some(x => x.id === a.id) ? prev : [a, ...prev])
    })
    esRef.current = es
    return () => es.close()
  }, [categoryId])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, qaLog, tab, open])

  const markSeen = useCallback(() => {
    const now = new Date().toISOString()
    localStorage.setItem(lastSeenKey(categoryId), now)
    setLastSeen(now)
  }, [categoryId])

  const unseen = activity.filter(a => a.created_at > lastSeen).length +
    messages.filter(m => m.created_at > lastSeen).length

  const openPanel = () => {
    setOpen(true)
    if (tab === 'whatsnew') markSeen()
  }
  const switchTab = (t) => { setTab(t); if (t === 'whatsnew') markSeen() }

  const send = async (e) => {
    e.preventDefault()
    const body = input.trim()
    if (!body || sending) return
    setInput('')
    setSending(true)
    try { await api.sendMessage(categoryId, body) } catch { /* queued or failed — it'll show up once synced */ }
    setSending(false)
  }

  const ask = async (e) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || asking) return
    const id = Date.now()
    setQuestion('')
    setAsking(true)
    setQaLog(prev => [...prev, { id, question: q, answer: null }])
    try {
      const { answer } = await api.askMachine(categoryId, q)
      setQaLog(prev => prev.map(x => x.id === id ? { ...x, answer } : x))
    } catch (err) {
      setQaLog(prev => prev.map(x => x.id === id ? { ...x, answer: `couldn't reach the machine — ${err.message}` } : x))
    }
    setAsking(false)
  }

  return (
    <>
      {/* A persistent rail flush to the edge — always there, not just when the
          panel's open — so the panel reads as dragging out FROM it. */}
      <div
        className="fixed z-30"
        style={{
          right: 0, bottom: `calc(${RAIL_BOTTOM} + 10px)`, height: RAIL_HEIGHT, width: 2,
          background: AMBER_BORDER, pointerEvents: 'none'
        }}
      />

      {/* One fixed notch, same spot whether open or closed — it doesn't move
          with the panel, it just toggles it. z-50 keeps it above the panel
          so it's still there to click closed once open. */}
      <motion.button
        onClick={() => (open ? setOpen(false) : openPanel())}
        whileTap={{ scale: 0.92 }}
        className="fixed z-50 flex items-center justify-center"
        style={{
          right: 0, bottom: NOTCH_BOTTOM,
          width: 36, height: 36, background: 'var(--s-surface)', color: 'var(--s-text-0)',
          border: `2px solid ${AMBER_BORDER}`, borderRight: 'none',
          borderRadius: '8px 0 0 8px',
          boxShadow: '-4px 4px 16px rgba(0,0,0,0.4)'
        }}
        title="Shelf chat"
      >
        <EnvelopeIcon />
        {!open && unseen > 0 && (
          <span style={{
            position: 'absolute', top: -4, left: -2, width: 15, height: 15, borderRadius: '50%',
            background: '#c0392b', color: '#fff', fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--s-bg)'
          }}>
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ type: 'spring', damping: 26, stiffness: 340 }}
            className="fixed z-40"
            style={{
              right: 0, bottom: `calc(${RAIL_BOTTOM} + 10px)`, height: PANEL_HEIGHT,
              width: 'min(340px, calc(100vw - 20px))'
            }}
          >
            <div className="flex flex-col overflow-hidden h-full" style={{
              background: 'var(--s-surface)', border: `1px solid ${AMBER_BORDER}`,
              borderRadius: '14px 0 0 14px',
              // A shadow that hugs the panel and tapers off within ~2cm, rather
              // than a full-screen dim — makes the panel pop without darkening
              // the rest of the page.
              boxShadow: '0 0 85px 30px rgba(0,0,0,0.82), 0 24px 48px -12px rgba(0,0,0,0.8)'
            }}>
            <div className="flex" style={{ borderBottom: '1px solid var(--s-border)' }}>
              {[['man', 'man'], ['machine', 'machine'], ['whatsnew', "what's new"]].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => switchTab(id)}
                  style={{
                    flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: tab === id ? 'var(--s-accent)' : 'var(--s-text-3)',
                    borderBottom: tab === id ? '2px solid var(--s-accent)' : '2px solid transparent',
                    background: 'transparent'
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'man' ? (
              !isLinked ? (
                <div className="flex-1 flex items-center justify-center px-6 text-center" style={{ color: 'var(--s-text-3)', fontSize: 12 }}>
                  Share this shelf to chat with whoever joins it.
                </div>
              ) : (
                <>
                  <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {messages.length === 0 && (
                      <div style={{ textAlign: 'center', color: 'var(--s-text-3)', fontSize: 11, marginTop: 20 }}>no messages yet</div>
                    )}
                    {messages.map(m => (
                      <div key={m.id} style={{ maxWidth: '85%', alignSelf: 'flex-start' }}>
                        <div style={{ fontSize: 10, color: 'var(--s-text-3)', marginBottom: 2 }}>
                          {m.username || 'someone'} · {timeAgo(m.created_at)}
                        </div>
                        <div style={{
                          background: 'var(--s-surface-2)', border: '1px solid var(--s-border)',
                          padding: '7px 10px', fontSize: 13, color: 'var(--s-text-0)',
                          wordBreak: 'break-word'
                        }}>
                          {m.body}
                        </div>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={send} className="flex gap-2 p-2" style={{ borderTop: '1px solid var(--s-border)', paddingBottom: NOTCH_OVERLAP }}>
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="message this shelf…"
                      style={{
                        flex: 1, background: 'var(--s-bg)', border: '1px solid var(--s-border)',
                        padding: '7px 10px', fontSize: 13, color: 'var(--s-text-0)', outline: 'none'
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || sending}
                      style={{
                        padding: '7px 14px', fontSize: 12, fontWeight: 500,
                        background: 'var(--s-accent)', color: 'var(--s-bg)', opacity: input.trim() ? 1 : 0.4
                      }}
                    >
                      send
                    </button>
                  </form>
                </>
              )
            ) : tab === 'machine' ? (
              <>
                <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {qaLog.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--s-text-3)', fontSize: 11, marginTop: 20 }}>
                      ask about this shelf's history — "what cards were added last week?"
                    </div>
                  )}
                  {qaLog.map(qa => (
                    <div key={qa.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ maxWidth: '85%', alignSelf: 'flex-end' }}>
                        <div style={{
                          background: 'var(--s-accent)', color: 'var(--s-bg)',
                          padding: '7px 10px', fontSize: 13, wordBreak: 'break-word'
                        }}>
                          {qa.question}
                        </div>
                      </div>
                      <div style={{ maxWidth: '85%', alignSelf: 'flex-start' }}>
                        {qa.answer === null ? (
                          <div style={{ color: 'var(--s-text-3)', fontSize: 12, padding: '2px 2px' }}>thinking…</div>
                        ) : (
                          <div style={{
                            background: 'var(--s-surface-2)', border: '1px solid var(--s-border)',
                            padding: '7px 10px', fontSize: 13, color: 'var(--s-text-0)',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                          }}>
                            {qa.answer}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={ask} className="flex gap-2 p-2" style={{ borderTop: '1px solid var(--s-border)', paddingBottom: NOTCH_OVERLAP }}>
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="ask the machine…"
                    style={{
                      flex: 1, background: 'var(--s-bg)', border: '1px solid var(--s-border)',
                      padding: '7px 10px', fontSize: 13, color: 'var(--s-text-0)', outline: 'none'
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!question.trim() || asking}
                    style={{
                      padding: '7px 14px', fontSize: 12, fontWeight: 500,
                      background: 'var(--s-accent)', color: 'var(--s-bg)', opacity: question.trim() ? 1 : 0.4
                    }}
                  >
                    ask
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto px-3 py-3" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activity.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--s-text-3)', fontSize: 11, marginTop: 20 }}>nothing's happened here yet</div>
                )}
                {activity.map(a => (
                  <div key={a.id} style={{
                    display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 8px',
                    background: a.created_at > lastSeen ? 'var(--s-accent-faint)' : 'transparent'
                  }}>
                    <span style={{ fontSize: 13, color: 'var(--s-accent)', flexShrink: 0, width: 14, textAlign: 'center' }}>
                      {ACTIVITY_ICON[a.kind] || '•'}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--s-text-1)' }}>{a.summary}</div>
                      <div style={{ fontSize: 10, color: 'var(--s-text-3)', marginTop: 1 }}>{timeAgo(a.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
