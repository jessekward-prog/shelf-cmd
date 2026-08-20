import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import * as api from '../api.js'

export default function InviteModal({ shelfId, shelfName, onClose, onShared }) {
  const [code, setCode] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.getInvite(shelfId)
      .then(({ code }) => { setCode(code); onShared?.(shelfId) })
      .catch(() => setError('could not create a code — try again'))
  }, [shelfId])

  const copy = () => {
    navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        className="w-full max-w-md rounded-xl p-5"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--s-accent)' }}>
          invite someone to “{shelfName}”
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--s-text-3)', lineHeight: 1.5 }}>
          Send them this code, along with this shelf's web address. They tap{' '}
          <span style={{ color: 'var(--s-text-2)' }}>“i have an invite code”</span> on the pin
          screen the first time, or <span style={{ color: 'var(--s-text-2)' }}>+ join</span> if
          they already have an account here. For now the shelf lives on your instance — they
          read and post through your address, not their own.
        </p>

        {error ? (
          <p className="text-xs" style={{ color: '#c0392b' }}>{error}</p>
        ) : (
          <button
            onClick={copy}
            disabled={!code}
            className="w-full py-4 rounded-lg mb-4"
            style={{
              background: 'var(--s-bg)',
              border: '1px solid var(--s-accent)',
              color: 'var(--s-accent)',
              fontFamily: 'inherit', fontSize: 30, letterSpacing: '0.4em',
              cursor: code ? 'pointer' : 'default'
            }}
          >
            {code || '······'}
          </button>
        )}

        <p className="text-xs mb-4 text-center" style={{ color: copied ? 'var(--s-accent)' : 'var(--s-text-3)' }}>
          {copied ? 'copied to clipboard' : code ? 'tap the code to copy it' : ''}
        </p>

        <p className="text-xs mb-4" style={{ color: 'var(--s-text-3)', lineHeight: 1.5 }}>
          This code stays valid, so anyone you send it to can join. Members are listed
          in the <span style={{ color: 'var(--s-text-2)' }}>members</span> bar on the tab.
        </p>

        <button
          onClick={onClose}
          className="w-full py-2 rounded-lg text-sm"
          style={{ border: '1px solid var(--s-border)', color: 'var(--s-text-2)' }}
        >
          done
        </button>
      </motion.div>
    </motion.div>
  )
}
