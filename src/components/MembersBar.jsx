import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

// Lucide "users" — the invite/members action. Reserved for actual actions
// (invite someone, open the members list) — use LinkIcon below for a shelf's
// passive "this is shared" status, so the two never look identical side by
// side the way they did before this got split out.
export function CollabIcon({ size = 11, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

// Lucide "link" — a shelf's passive "this is shared" status marker.
export function LinkIcon({ size = 11, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }} aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

export default function MembersBar({ shelfId, onInvite, refreshKey }) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState([])

  useEffect(() => {
    setMembers([])
    api.getMembers(shelfId).then(setMembers).catch(() => {})
  }, [shelfId, refreshKey])

  useEffect(() => { setOpen(false) }, [shelfId])

  return (
    <div style={{ borderTop: '1px solid var(--s-surface-2)', borderBottom: '1px solid var(--s-surface-2)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 16px', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.16em',
          color: open ? 'var(--s-accent)' : 'var(--s-text-3)'
        }}
      >
        <CollabIcon size={10} />
        MEMBERS
        <span style={{ color: 'var(--s-text-3)' }}>{members.length ? `· ${members.length}` : ''}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }} style={{ marginLeft: 'auto', fontSize: 9 }}>
          ▾
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '4px 16px 8px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {members.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: m.is_me ? 'var(--s-accent)' : 'var(--s-text-2)' }}>
                    {m.username}
                  </span>
                  {(m.is_owner || m.is_me) && (
                    <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {m.is_owner && (
                        <span style={{
                          fontSize: 9, letterSpacing: '0.08em', padding: '1px 5px', borderRadius: 3,
                          background: 'var(--s-surface-2)', color: 'var(--s-text-3)'
                        }}>
                          OWNER
                        </span>
                      )}
                      {m.is_me && (
                        <span style={{
                          fontSize: 9, letterSpacing: '0.08em', padding: '1px 5px', borderRadius: 3,
                          background: 'var(--s-accent-faint)', color: 'var(--s-accent)'
                        }}>
                          YOU
                        </span>
                      )}
                    </span>
                  )}
                </div>
              ))}

              <button
                  onClick={() => onInvite(shelfId)}
                  style={{
                    alignSelf: 'flex-start', marginTop: 6, paddingTop: 7, width: '100%', textAlign: 'left',
                    background: 'none', border: 'none', borderTop: '1px solid var(--s-surface-2)',
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 10, letterSpacing: '0.14em', color: 'var(--s-accent)'
                  }}
                >
                  + INVITE SOMEONE
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
