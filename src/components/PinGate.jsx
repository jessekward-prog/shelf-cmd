import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getSavedTheme, applyTheme, getSavedIntensity, applyIntensity, getSavedFont, applyFont, getSavedOverlay, applyOverlay } from '../themes.js'
import * as api from '../api.js'
import JoinGate from './JoinGate.jsx'

const AUTH_KEY = 'shelf_authed'
const PIN_LENGTH = 4

function hashPin(pin) {
  let h = 0
  for (let i = 0; i < pin.length; i++) {
    h = ((h << 5) - h + pin.charCodeAt(i)) | 0
  }
  return String(h >>> 0)
}

function Dot({ filled }) {
  return (
    <div style={{
      width: 14, height: 14, borderRadius: '50%',
      border: '2px solid var(--s-accent)',
      background: filled ? 'var(--s-accent)' : 'transparent',
      transition: 'background 0.15s'
    }} />
  )
}

function NumPad({ onDigit, onBack }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫']
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, width: 240 }}>
      {keys.map((k, i) => {
        if (!k) return <div key={i} />
        return (
          <motion.button
            key={k}
            whileTap={{ scale: 0.88 }}
            onClick={() => k === '⌫' ? onBack() : onDigit(k)}
            style={{
              height: 64, borderRadius: 8,
              background: k === '⌫' ? 'transparent' : 'var(--s-surface)',
              border: k === '⌫' ? 'none' : '1px solid var(--s-border)',
              color: 'var(--s-accent)',
              fontSize: k === '⌫' ? 22 : 24,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            {k}
          </motion.button>
        )
      })}
    </div>
  )
}

export default function PinGate({ children }) {
  // Apply saved theme before first paint so login screen is already themed
  useEffect(() => {
    applyTheme('cmd')
    applyIntensity(getSavedIntensity(), 'cmd')
    applyFont(getSavedFont())
    applyOverlay(getSavedOverlay())
  }, [])

  const [mode, setMode] = useState(null) // null | 'setup' | 'confirm' | 'enter' | 'join'
  const [digits, setDigits] = useState('')
  const [firstPin, setFirstPin] = useState('')
  const [error, setError] = useState('')
  const [me, setMe] = useState(null)

  const askForPin = useCallback(() => {
    fetch('/api/pin')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(({ set }) => setMode(set ? 'enter' : 'setup'))
      .catch(() => setError('server unreachable — reload to retry'))
  }, [])

  useEffect(() => {
    if (!api.getToken()) return askForPin()
    api.getMe()
      .then(user => {
        // Collaborators have no PIN — their token is the whole credential
        if (!user.is_admin || sessionStorage.getItem(AUTH_KEY) === '1') setMe(user)
        else askForPin()
      })
      .catch(() => { api.clearToken(); askForPin() })
  }, [askForPin])

  const finishPin = async ({ token }) => {
    api.setToken(token)
    sessionStorage.setItem(AUTH_KEY, '1')
    setMe(await api.getMe())
  }

  const handleDigit = useCallback((d) => {
    setError('')
    setDigits(prev => prev.length < PIN_LENGTH ? prev + d : prev)
  }, [])

  const handleBack = useCallback(() => {
    setError('')
    setDigits(prev => prev.slice(0, -1))
  }, [])

  useEffect(() => {
    if (digits.length < PIN_LENGTH) return

    if (mode === 'setup') {
      setFirstPin(digits)
      setDigits('')
      setMode('confirm')
      return
    }

    if (mode === 'confirm') {
      if (digits !== firstPin) {
        setError("PINs don't match")
        setDigits('')
        setFirstPin('')
        setMode('setup')
        return
      }
      fetch('/api/pin/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: hashPin(digits) })
      })
        .then(r => r.json())
        .then(finishPin)
      return
    }

    if (mode === 'enter') {
      fetch('/api/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: hashPin(digits) })
      })
        .then(r => r.json())
        .then(result => {
          if (result.ok) return finishPin(result)
          setError('Wrong PIN')
          setDigits('')
        })
    }
  }, [digits, mode, firstPin])

  if (me) return children(me)

  if (mode === 'join') return (
    <JoinGate
      onBack={() => { setError(''); askForPin() }}
      onJoined={(user) => { api.setToken(user.token); setMe(user) }}
    />
  )

  if (!mode) return (
    <div style={{ minHeight: '100dvh', background: 'var(--s-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {error
        ? <span style={{ color: '#c0392b', fontSize: 12, letterSpacing: '0.1em', textAlign: 'center', padding: 24 }}>{error}</span>
        : <span style={{ color: 'var(--s-border)', fontSize: 13, letterSpacing: '0.2em' }}>...</span>
      }
    </div>
  )

  const title =
    mode === 'setup' ? 'choose a pin' :
    mode === 'confirm' ? 'confirm pin' :
    'enter pin'

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--s-bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 40, padding: 24, position: 'relative'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <img src="/logo.png" alt="ShelfStation" style={{ width: 120, height: 'auto', borderRadius: 8 }} />
        <span style={{ color: 'var(--s-accent)', fontSize: 13, letterSpacing: '0.35em', fontFamily: 'inherit' }}>
          SHELFSTATION
        </span>
      </div>

      <span style={{ color: 'var(--s-text-3)', fontSize: 13, letterSpacing: '0.15em' }}>
        {title}
      </span>

      <div style={{ display: 'flex', gap: 16 }}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <Dot key={i} filled={i < digits.length} />
        ))}
      </div>

      <NumPad onDigit={handleDigit} onBack={handleBack} />

      <button
        onClick={() => { setError(''); setDigits(''); setMode('join') }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          color: 'var(--s-text-3)', fontSize: 11, letterSpacing: '0.14em'
        }}
      >
        i have an invite code
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
