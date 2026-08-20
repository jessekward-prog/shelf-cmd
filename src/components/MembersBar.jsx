import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

// Lucide "users" — marks anything that more than one person can see
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

export default function MembersBar({ shelfId, isAdmin, meId, onInvite, refreshKey }) {
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
            <div style={{ padding: '4px 16px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {members.map(m => (
                <span key={m.id} style={{ fontSize: 11, color: m.id === meId ? 'var(--s-accent)' : 'var(--s-text-2)' }}>
                  {m.username}{m.is_admin ? ' · owner' : ''}{m.id === meId ? ' · you' : ''}
                </span>
              ))}

              {isAdmin && (
                <button
                  onClick={() => onInvite(shelfId)}
                  style={{
                    alignSelf: 'flex-start', marginTop: 4, background: 'none', border: 'none',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 10,
                    letterSpacing: '0.14em', color: 'var(--s-accent)'
                  }}
                >
                  + INVITE SOMEONE
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
