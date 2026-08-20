import { useState } from 'react'
import { motion } from 'framer-motion'
import * as api from '../api.js'

export default function JoinModal({ onClose, onLinked }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (code.length !== 6 || busy) return
    setBusy(true)
    setError('')
    try {
      const { category_id } = await api.linkShelf(code)
      onLinked(category_id)
    } catch (err) {
      setError(
        err.message.includes('404') ? 'that code does not match a shelf'
        : err.message.includes('502') ? "couldn't reach the hub — try again shortly"
        : 'could not link that shelf — try again'
      )
      setBusy(false)
    }
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
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--s-accent)' }}>link a shared shelf</p>
        <p className="text-xs mb-4" style={{ color: 'var(--s-text-3)', lineHeight: 1.5 }}>
          Paste the 6-digit code someone sent you. Their shelf appears here beside your own
          and stays in sync both ways — they never see the rest of your shelves.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            autoFocus
            inputMode="numeric"
            placeholder="000000"
            value={code}
            onChange={(e) => { setError(''); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)) }}
            className="w-full py-3 rounded-lg text-center"
            style={{
              background: 'var(--s-bg)', border: '1px solid var(--s-border)',
              color: 'var(--s-text-1)', outline: 'none',
              fontFamily: 'inherit', fontSize: 24, letterSpacing: '0.4em'
            }}
          />

          {error && <p className="text-xs" style={{ color: '#c0392b' }}>{error}</p>}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm"
              style={{ border: '1px solid var(--s-border)', color: 'var(--s-text-2)' }}
            >
              cancel
            </button>
            <motion.button
              type="submit"
              disabled={code.length !== 6 || busy}
              whileTap={{ scale: 0.96 }}
              className="flex-1 py-2 rounded-lg text-sm font-medium"
              style={{
                background: 'var(--s-accent)',
                color: 'var(--s-bg)',
                opacity: code.length === 6 && !busy ? 1 : 0.4
              }}
            >
              {busy ? 'linking…' : 'link'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
