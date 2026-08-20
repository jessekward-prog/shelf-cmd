import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { applyTheme, applyIntensity, applyFont, applyOverlay, getSavedIntensity, getSavedFont, getSavedOverlay } from '../themes.js'
import * as api from '../api.js'

const field = {
  width: 240, padding: '10px 12px', borderRadius: 8, textAlign: 'center',
  background: 'var(--s-surface)', border: '1px solid var(--s-border)',
  color: 'var(--s-text-1)', fontFamily: 'inherit', fontSize: 14, outline: 'none'
}

export default function JoinGate({ onJoined, onBack }) {
  useEffect(() => {
    applyTheme('cmd')
    applyIntensity(getSavedIntensity(), 'cmd')
    applyFont(getSavedFont())
    applyOverlay(getSavedOverlay())
  }, [])

  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const ready = code.length === 6 && username.trim().length > 0

  const submit = async (e) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      onJoined(await api.join(code, username.trim()))
    } catch (err) {
      setError(err.message.includes('404') ? 'that code does not match a shelf' : 'could not join — try again')
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh', background: 'var(--s-bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 28, padding: 24
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <img src="/logo.png" alt="ShelfStation" style={{ width: 120, height: 'auto', borderRadius: 8 }} />
        <span style={{ color: 'var(--s-accent)', fontSize: 13, letterSpacing: '0.35em' }}>SHELFSTATION</span>
      </div>

      <span style={{ color: 'var(--s-text-3)', fontSize: 13, letterSpacing: '0.15em' }}>join a shelf</span>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <input
          autoFocus
          inputMode="numeric"
          placeholder="6-digit code"
          value={code}
          onChange={(e) => { setError(''); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)) }}
          style={{ ...field, letterSpacing: '0.4em', fontSize: 18 }}
        />
        <input
          placeholder="pick a username"
          value={username}
          onChange={(e) => { setError(''); setUsername(e.target.value.slice(0, 32)) }}
          style={field}
        />
        <motion.button
          type="submit"
          disabled={!ready || busy}
          whileTap={{ scale: 0.96 }}
          style={{
            width: 240, padding: '10px 0', borderRadius: 8, border: 'none',
            background: 'var(--s-accent)', color: 'var(--s-bg)',
            fontFamily: 'inherit', fontSize: 13, letterSpacing: '0.15em',
            cursor: ready && !busy ? 'pointer' : 'default',
            opacity: ready && !busy ? 1 : 0.4
          }}
        >
          {busy ? 'joining…' : 'join'}
        </motion.button>
      </form>

      <button
        onClick={onBack}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          color: 'var(--s-text-3)', fontSize: 11, letterSpacing: '0.14em'
        }}
      >
        back to pin
      </button>

      <AnimatePresence>
        {error && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ color: '#c0392b', fontSize: 12, letterSpacing: '0.1em', position: 'absolute', bottom: 48 }}
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
