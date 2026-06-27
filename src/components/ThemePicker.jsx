import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { THEMES, FONTS, applyTheme, applyIntensity, applyFont, applyOverlay, getSavedIntensity, getSavedFont, getSavedOverlay } from '../themes.js'

const CRT_THEMES   = THEMES.filter(t => t.group === 'crt')
const CLEAN_THEMES = THEMES.filter(t => t.group === 'clean')

export default function ThemePicker({ current, onChange }) {
  const [open, setOpen] = useState(false)
  const [intensity, setIntensity] = useState(getSavedIntensity)
  const [currentFont, setCurrentFont] = useState(getSavedFont)
  const [overlay, setOverlay] = useState(getSavedOverlay)

  const pick = (id) => {
    applyTheme(id)
    applyIntensity(intensity, id)
    onChange(id)
  }

  const handleIntensity = (e) => {
    const v = Number(e.target.value)
    setIntensity(v)
    applyIntensity(v, current)
  }

  const pickFont = (id) => {
    applyFont(id)
    setCurrentFont(id)
  }

  const handleOverlay = (e) => {
    const v = Number(e.target.value)
    setOverlay(v)
    applyOverlay(v)
  }

  const swatch = THEMES.find(t => t.id === current)?.swatch || '#e8840a'

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="theme"
        style={{
          width: 20, height: 20, borderRadius: '50%',
          background: swatch,
          border: '2px solid var(--s-border)',
          boxShadow: open ? `0 0 8px ${swatch}88` : 'none',
          transition: 'box-shadow 0.2s',
          flexShrink: 0
        }}
      />

      <AnimatePresence>
        {open && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'absolute', right: 0, top: 28, zIndex: 50,
                background: 'var(--s-surface)',
                border: '1px solid var(--s-border)',
                borderRadius: 10, padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 4,
                minWidth: 148
              }}
            >
              {/* CRT group */}
              <span style={{ fontSize: 10, color: 'var(--s-text-3)', letterSpacing: '0.12em', padding: '2px 8px 4px' }}>CRT</span>
              {CRT_THEMES.map(t => <ThemeRow key={t.id} t={t} current={current} onPick={pick} />)}

              {/* Clean group */}
              <div style={{ borderTop: '1px solid var(--s-surface-2)', margin: '4px 0' }} />
              <span style={{ fontSize: 10, color: 'var(--s-text-3)', letterSpacing: '0.12em', padding: '2px 8px 4px' }}>CLEAN</span>
              {CLEAN_THEMES.map(t => <ThemeRow key={t.id} t={t} current={current} onPick={pick} />)}

              {/* Font picker */}
              <div style={{ borderTop: '1px solid var(--s-surface-2)', margin: '4px 0' }} />
              <div style={{ padding: '4px 8px 2px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--s-text-3)', letterSpacing: '0.12em', padding: '2px 0 2px' }}>FONT</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {FONTS.map(f => (
                    <button
                      key={f.id}
                      onClick={() => pickFont(f.id)}
                      style={{
                        flex: 1, padding: '5px 2px',
                        fontFamily: f.family,
                        fontSize: f.id === 'vt323' ? 14 : 10,
                        fontWeight: f.id === 'orbitron' ? 700 : 400,
                        background: currentFont === f.id ? 'var(--s-surface-2)' : 'transparent',
                        border: '1px solid var(--s-border)',
                        borderRadius: 4, cursor: 'pointer',
                        color: currentFont === f.id ? 'var(--s-accent)' : 'var(--s-text-2)',
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sliders */}
              <div style={{ borderTop: '1px solid var(--s-surface-2)', margin: '4px 0 2px' }} />
              <div style={{ padding: '4px 8px 2px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Slider label="INTENSITY" value={intensity} min={10} max={100} accentColor={swatch} onChange={handleIntensity} />
                <Slider label="OVERLAY"   value={overlay}   min={0}  max={100} accentColor={swatch} onChange={handleOverlay} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function Slider({ label, value, min, max, accentColor, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--s-text-3)', letterSpacing: '0.12em' }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--s-text-2)' }}>{value}%</span>
      </div>
      <input
        type="range" min={min} max={max} value={value} onChange={onChange}
        style={{ width: '100%', accentColor, cursor: 'pointer', height: 4 }}
      />
    </div>
  )
}

function ThemeRow({ t, current, onPick }) {
  return (
    <button
      onClick={() => onPick(t.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: current === t.id ? 'var(--s-surface-2)' : 'transparent',
        border: 'none', borderRadius: 6,
        padding: '5px 8px', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 12,
        color: current === t.id ? 'var(--s-accent)' : 'var(--s-text-2)',
        textAlign: 'left', width: '100%'
      }}
    >
      <span style={{
        width: 12, height: 12, borderRadius: '50%',
        background: t.swatch, flexShrink: 0,
        border: t.swatch === '#ffffff' ? '1px solid #444' : 'none',
        boxShadow: current === t.id ? `0 0 6px ${t.swatch}` : 'none'
      }} />
      {t.name}
    </button>
  )
}
