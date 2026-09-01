import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { THEMES, FONTS, applyTheme, applyIntensity, applyFont, applyOverlay, getSavedIntensity, getSavedFont, getSavedOverlay } from '../themes.js'
import * as api from '../api.js'

const CRT_THEMES   = THEMES.filter(t => t.group === 'crt')
const CLEAN_THEMES = THEMES.filter(t => t.group === 'clean')

export default function ThemePicker({ current, onChange, user, onRenamed, placement = 'up' }) {
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
              initial={{ opacity: 0, y: placement === 'down' ? -6 : 6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: placement === 'down' ? -4 : 4, scale: 0.95 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'absolute', right: 0, zIndex: 50,
                ...(placement === 'down' ? { top: 28 } : { bottom: 28 }),
                background: 'var(--s-surface)',
                border: '1px solid var(--s-border)',
                borderRadius: 10, padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 4,
                minWidth: 214, maxHeight: '70vh', overflowY: 'auto'
              }}
            >
              {/* Who you are, and whose AI account pays for your collab posts */}
              <Identity user={user} onRenamed={onRenamed} />

              <div style={{ borderTop: '1px solid var(--s-surface-2)', margin: '6px 0 2px' }} />

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

const inputStyle = {
  width: '100%', padding: '5px 7px', borderRadius: 4,
  background: 'var(--s-bg)', border: '1px solid var(--s-border)',
  color: 'var(--s-text-1)', fontFamily: 'inherit', fontSize: 11, outline: 'none'
}

const labelStyle = { fontSize: 10, color: 'var(--s-text-3)', letterSpacing: '0.12em' }

// Every local runner worth listing speaks the same OpenAI-compatible shape
// (/v1/models, /v1/chat/completions) at its own default port, so a base URL
// for any of them just drops straight in here — nothing else in the backend
// needs to know or care which one it's talking to.
const LM_PRESETS = [
  { label: 'LM Studio', port: 1234 },
  { label: 'Ollama', port: 11434 },
  { label: 'text-generation-webui', port: 5000 }
]

// The AI this instance runs everything through — scraping, descriptions, plans,
// guides, the legend classifier. Listed straight off the endpoint, so you pick a
// model you actually have loaded instead of guessing at an id in a .env.
function ServerModel() {
  const [lm, setLm] = useState(null)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')

  useEffect(() => {
    if (open && !lm) api.getLm().then(setLm).catch(err => setLm({ models: [], error: err.message }))
  }, [open, lm])

  useEffect(() => { if (lm?.error) setEditingUrl(true) }, [lm?.error])

  const pick = async (model) => {
    const { selected } = await api.setLmModel(model)
    setLm(prev => ({ ...prev, selected }))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const saveUrl = async (url) => {
    if (!url.trim()) return
    const updated = await api.setLmConnection(url.trim(), apiKeyInput.trim())
    setEditingUrl(false)
    setApiKeyInput('')
    setLm({ ...updated, models: [], selected: '' })
    api.getLm().then(setLm)
  }

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left', ...labelStyle,
          color: lm?.selected ? 'var(--s-accent)' : 'var(--s-text-3)'
        }}
      >
        {open ? '− ' : '+ '}MY AI
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 9, color: 'var(--s-text-3)', lineHeight: 1.4 }}>
            {lm ? lm.url : 'loading…'} — used by scrape, plans, guides and the legend.
            {lm && !editingUrl && (
              <>
                {' '}
                <button
                  onClick={() => { setUrlInput(lm.url); setEditingUrl(true) }}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--s-text-2)', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9 }}
                >change</button>
              </>
            )}
          </span>

          {lm?.error && (
            <span style={{ fontSize: 9, color: 'var(--s-text-2)', lineHeight: 1.4 }}>
              can't reach it: {lm.error}
              {/401/.test(lm.error) && ' — this endpoint wants an API key (below), not just a URL.'}
            </span>
          )}

          {editingUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 9, color: 'var(--s-text-3)', lineHeight: 1.4 }}>
                Pick what you're running locally, or type its address. If this instance runs in Docker,
                `localhost` means the container, not your PC — use <code>host.docker.internal</code> to reach
                the host machine instead (falls back to the host's real LAN IP if that name doesn't resolve).
              </span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {LM_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => setUrlInput(`http://host.docker.internal:${p.port}`)}
                    style={{
                      fontSize: 9, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                      background: 'var(--s-surface-2)', border: '1px solid var(--s-border)', color: 'var(--s-text-2)'
                    }}
                  >{p.label}</button>
                ))}
              </div>
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveUrl(urlInput)}
                placeholder="http://host.docker.internal:1234"
                style={inputStyle}
              />
              <input
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveUrl(urlInput)}
                type="password"
                placeholder={lm?.apiKeySet ? 'API key (leave blank to keep current)' : 'API key (only if it needs one)'}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  onClick={() => saveUrl(urlInput)}
                  style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, background: 'var(--s-accent)', color: 'var(--s-bg)', cursor: 'pointer' }}
                >save</button>
                {lm && !lm.error && (
                  <button
                    onClick={() => setEditingUrl(false)}
                    style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, background: 'none', border: '1px solid var(--s-border)', color: 'var(--s-text-3)', cursor: 'pointer' }}
                  >cancel</button>
                )}
              </div>
            </div>
          ) : lm && !lm.error && (
            <select
              value={lm.selected || ''}
              onChange={(e) => pick(e.target.value)}
              style={inputStyle}
            >
              <option value="">{lm.env_default ? `default (${lm.env_default})` : 'endpoint default'}</option>
              {lm.models.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          )}
          {saved && <span style={{ fontSize: 9, color: 'var(--s-accent)' }}>model set</span>}
        </div>
      )}
    </>
  )
}

function Identity({ user, onRenamed }) {
  const [name, setName] = useState(user.username)
  const [saved, setSaved] = useState(false)

  const commitName = async () => {
    const next = name.trim()
    if (!next || next === user.username) return
    onRenamed(await api.setUsername(next))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div style={{ padding: '2px 8px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...labelStyle, padding: '2px 0' }}>YOU</span>

      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 32))}
        onBlur={commitName}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="username"
        style={inputStyle}
      />
      {saved && <span style={{ fontSize: 9, color: 'var(--s-accent)' }}>name updated everywhere</span>}

      {user.is_admin && <ServerModel />}
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
